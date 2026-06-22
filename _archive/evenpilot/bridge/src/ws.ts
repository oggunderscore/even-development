// WebSocket server — accepts connections from the G2 glasses app.

import { WebSocketServer, WebSocket } from 'ws'
import type { PtyManager } from './pty'
import { warpNotify } from './osc'
import { makeLog } from './log'

const log = makeLog('ws')

interface SpawnMsg  { type: 'spawn'; sessionId: string }
interface SshMsg    { type: 'ssh';   sessionId: string; host: string; user: string }
interface InputMsg  { type: 'input'; sessionId: string; data: string }
type ClientMsg = SpawnMsg | SshMsg | InputMsg

export function startWsServer(port: number, ptys: PtyManager): WebSocketServer {
  const wss = new WebSocketServer({ port, host: '0.0.0.0' })
  log.info(`listening on ws://0.0.0.0:${port}`)

  wss.on('connection', (ws, req) => {
    const remote = req.socket.remoteAddress ?? 'unknown'
    log.info(`G2 connected  remote=${remote}`)

    const owned = new Set<string>()

    ws.on('message', (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        log.warn('invalid JSON from client')
        sendError(ws, 'Invalid JSON')
        return
      }

      const { type, sessionId } = msg
      if (!sessionId) { log.warn('missing sessionId'); sendError(ws, 'Missing sessionId'); return }

      if (type === 'spawn') {
        log.info(`spawn shell  session=${sessionId}`)
        owned.add(sessionId)
        ptys.spawn(sessionId)
        ptys.addListener(sessionId, (data) => sendOutput(ws, sessionId, data))
        warpNotify('G2 Terminal', 'Shell session started')
      }

      else if (type === 'ssh') {
        const { host, user } = msg as SshMsg
        log.info(`spawn ssh    session=${sessionId}  target=${user}@${host}`)
        owned.add(sessionId)
        ptys.spawnSsh(sessionId, host, user)
        ptys.addListener(sessionId, (data) => sendOutput(ws, sessionId, data))
        warpNotify('G2 SSH', `${user}@${host}`)
      }

      else if (type === 'input') {
        const { data } = msg as InputMsg
        const ok = ptys.write(sessionId, data)
        if (!ok) {
          log.warn(`input: session ${sessionId} not found`)
          sendError(ws, `Session not found: ${sessionId}`)
        } else {
          warpNotify('G2 cmd', data.slice(0, 60))
        }
      }
    })

    ws.on('close', (code, reason) => {
      log.info(`G2 disconnected  code=${code}  sessions=[${[...owned].join(', ')}]  reason=${reason.toString() || 'none'}`)
      for (const id of owned) ptys.kill(id)
      owned.clear()
    })

    ws.on('error', (err) => {
      log.error('socket error:', err.message)
    })
  })

  return wss
}

function sendOutput(ws: WebSocket, sessionId: string, data: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'output', sessionId, data }))
  }
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }))
  }
}
