// Honyaku proxy (optional "server mode"): the app normally talks to Deepgram and the translation provider
// directly from the phone; this runs the same engine (src/core) behind a WebSocket for people who'd rather host
// it — e.g. to avoid browser CORS limits or to keep the 17 MB romaji dictionary off the phone.
//
// Each user brings their own API keys: the app's first message is {config} (access token + keys), held only in
// that connection's memory. Nothing else is accepted until it arrives, and keys are never logged or stored.
//
//   client → {config} → {start,mode} → binary PCM… (continuous)  → {end}?
//   server → partial… → final… → done (after an explicit end)
//
// mode "auto": always-on, English + Japanese detected per utterance (restarted automatically if Deepgram drops).
// mode "talk": wearer holds the button — English only, always translated to Japanese romaji.

import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, ServerMsg } from '../../src/protocol'
import { Engine } from '../../src/core/engine'
import { runStartupChecks } from './diagnostics'
import { serverFallback, serverKeysAllowed } from './env'
import { log, warn } from './log'
import './romaji-node'

const PORT = Number(process.env['PORT'] ?? 8787)
const TOKEN = process.env['HONYAKU_TOKEN'] ?? ''
if (!TOKEN) console.warn('HONYAKU_TOKEN is empty — anyone who can reach this port can spend your API credits.')

const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '')
})
// Control messages are tiny; an oversized frame is never legitimate (audio chunks are ~3 KB).
const wss = new WebSocketServer({ server: http, maxPayload: 256 * 1024 })

let nextConn = 1
const AUTH_TIMEOUT_MS = 5000

wss.on('connection', (socket, req) => {
  const id = nextConn++
  const from = `${req.socket.remoteAddress} origin=${req.headers.origin ?? '-'}`
  log('conn', `#${id} open from ${from}`)
  new Conn(socket, id)
})

class Conn {
  /** The access token is checked on `config`; with no HONYAKU_TOKEN set the server is open. */
  private authed = !TOKEN
  private readonly engine: Engine

  constructor(private readonly socket: WebSocket, private readonly id: number) {
    this.engine = new Engine((msg) => this.send(msg), { fallback: serverFallback() }, this.tag)
    this.send({ type: 'ready' })
    const authTimer = TOKEN
      ? setTimeout(() => {
          if (!this.authed) {
            warn(this.tag, 'no valid config/token within 5s — closing')
            socket.close(4401, 'unauthorized')
          }
        }, AUTH_TIMEOUT_MS)
      : undefined
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        if (this.authed) this.engine.audio(data as Buffer)
      } else this.onClient(data.toString())
    })
    socket.on('close', (code, reason) => {
      log(this.tag, `closed (${code}${reason.length ? ` ${reason}` : ''})`)
      clearTimeout(authTimer)
      this.engine.close()
    })
    socket.on('error', (err) => warn(this.tag, `socket error: ${err.message}`))
  }

  private get tag() {
    return `conn#${this.id}`
  }

  private onClient(raw: string) {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      warn(this.tag, `ignoring non-JSON text frame: ${raw.slice(0, 60)}`)
      return
    }
    // Never log a whole message: `config` carries the user's keys.
    log(this.tag, `← ${msg.type}${'mode' in msg ? ` mode=${msg.mode}` : ''}${msg.type === 'text' ? ` "${msg.text}"` : ''}`)

    if (msg.type === 'config') {
      const { token, ...config } = msg.config ?? {}
      if (TOKEN && token !== TOKEN) {
        warn(this.tag, `REJECTED: token mismatch (client sent ${token ? `${token.length} chars` : 'nothing'}, server expects ${TOKEN.length}). Set the same access token in the app's Settings.`)
        this.socket.close(4401, 'unauthorized: token mismatch')
        return
      }
      this.authed = true
      this.engine.handle({ type: 'config', config })
      return
    }
    if (!this.authed) {
      this.send({ type: 'error', message: 'Not authenticated — send config with the access token first' })
      return
    }
    this.engine.handle(msg)
  }

  private send(msg: ServerMsg) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg))
  }
}

http.listen(PORT, () => {
  log('server', `honyaku server listening on :${PORT} (health: http://localhost:${PORT}/health)`)
  if (serverKeysAllowed()) log('server', "ALLOW_SERVER_KEYS is on: connections without their own keys use this server's .env keys (you will be billed)")
  else log('server', "users must bring their own API keys (set ALLOW_SERVER_KEYS=1 to fall back to this server's .env keys in dev)")
  void runStartupChecks(TOKEN)
})
