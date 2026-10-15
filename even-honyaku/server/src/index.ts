// Honyaku proxy: G2 app ⇄ (Deepgram STT) ⇄ LLM (OpenRouter by default). Keeps API keys off the device.
//
//   client → {start,dir} → binary PCM… → {end}
//   server → partial… → final… → done

import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMsg, Direction, ServerMsg, Translation } from '../../src/protocol'
import { SttStream } from './stt'
import { translate } from './translate'

const PORT = Number(process.env['PORT'] ?? 8787)
const TOKEN = process.env['HONYAKU_TOKEN'] ?? ''
if (!TOKEN) console.warn('HONYAKU_TOKEN is empty — anyone who can reach this port can spend your API credits.')

const http = createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : '')
})
const wss = new WebSocketServer({ server: http })

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
    socket.close(4401, 'unauthorized')
    return
  }
  new Conn(socket)
})

class Conn {
  private stt: SttStream | null = null
  private dir: Direction = 'speak'
  private history: Translation[] = []
  private nextId = 1
  /** Translations are chained so results reach the glasses in speech order. */
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly socket: WebSocket) {
    this.send({ type: 'ready' })
    socket.on('message', (data, isBinary) => {
      if (isBinary) this.stt?.audio(data as Buffer)
      else this.onClient(data.toString())
    })
    socket.on('close', () => this.stt?.abort())
  }

  private onClient(raw: string) {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return
    }
    switch (msg.type) {
      case 'start':
        this.start(msg.dir)
        break
      case 'end':
        void this.end()
        break
      case 'text':
        this.enqueue(msg.dir, msg.text)
        break
    }
  }

  private start(dir: Direction) {
    this.stt?.abort()
    this.dir = dir
    this.stt = new SttStream(dir, {
      onPartial: (text) => this.send({ type: 'partial', dir, text }),
      onFinal: (text) => this.enqueue(dir, text),
      onError: (err) => this.send({ type: 'error', message: `speech-to-text: ${err.message}` }),
    })
  }

  private async end() {
    const stt = this.stt
    this.stt = null
    if (stt) await stt.finish()
    await this.pending
    this.send({ type: 'done' })
  }

  private enqueue(dir: Direction, text: string) {
    const id = this.nextId++
    this.pending = this.pending.then(async () => {
      try {
        const t = await translate(dir, text, this.history, id)
        this.history.push(t)
        if (this.history.length > 6) this.history.shift()
        this.send({ type: 'final', ...t })
      } catch (err) {
        this.send({ type: 'error', message: `translate: ${err instanceof Error ? err.message : String(err)}` })
      }
    })
  }

  private send(msg: ServerMsg) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg))
  }
}

http.listen(PORT, () => console.log(`honyaku server on :${PORT}`))
