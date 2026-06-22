#!/usr/bin/env node
// Mock bridge for local testing — no node-pty, no macOS required.
// Simulates PTY output so you can test the G2 display pipeline on any OS.
//
// Usage: node mock-bridge.js
//   WS       ws://localhost:8765  (G2 app connects here)
//   Discover http://localhost:8767/discover

const { WebSocketServer } = require('./node_modules/ws')
const http = require('http')

const WS_PORT   = 8765
const DISC_PORT = 8767

// ── Discovery HTTP server ──────────────────────────────────────────────────────
const discServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({
    wsUrl:    `ws://localhost:${WS_PORT}`,
    mdnsUrl:  `ws://localhost:${WS_PORT}`,
    hostname: 'localhost',
    ip:       '127.0.0.1',
  }))
})
discServer.listen(DISC_PORT, () =>
  console.log(`[discover] http://localhost:${DISC_PORT}/discover`))

// ── WebSocket server ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT })
console.log(`[ws]       ws://localhost:${WS_PORT}`)
console.log('\nMock bridge ready. Set BRIDGE_HOSTNAME = \'localhost\' in G2 src/main.ts\n')

wss.on('connection', (ws) => {
  console.log('[ws] G2 connected')

  // Track per-connection intervals so we can clear them on disconnect
  const intervals = []

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }

    const { type, sessionId } = msg

    if (type === 'spawn') {
      console.log(`[ws] spawn  session=${sessionId}`)
      send(ws, sessionId, '\r\nWelcome to mock shell\r\n')
      send(ws, sessionId, 'user@mock:~$ ')

      // Simulate periodic output so you can test scroll / ring buffer
      let count = 0
      const iv = setInterval(() => {
        count++
        send(ws, sessionId, `[${count}] mock output line — testing scroll & ring buffer\r\n`)
        send(ws, sessionId, 'user@mock:~$ ')
      }, 4_000)
      intervals.push(iv)
    }

    if (type === 'ssh') {
      const { host, user } = msg
      console.log(`[ws] ssh    session=${sessionId}  ${user}@${host}`)
      send(ws, sessionId, `\r\nConnecting to ${user}@${host}...\r\n`)
      setTimeout(() => {
        send(ws, sessionId, `Welcome to mock SSH (${host})\r\n`)
        send(ws, sessionId, `${user}@${host}:~$ `)
      }, 500)
    }

    if (type === 'input') {
      const cmd = (msg.data || '').trim()
      console.log(`[ws] input  session=${sessionId}  cmd=${cmd}`)
      // Simulate a few realistic responses
      let out
      if (cmd === 'ls' || cmd === 'ls -la') {
        out = 'total 48\r\ndrwxr-xr-x  8 user staff  256 May 31 12:00 .\r\ndrwxr-xr-x 24 user staff  768 May 31 11:00 ..\r\n-rw-r--r--  1 user staff 4096 May 31 12:00 README.md\r\ndrwxr-xr-x  4 user staff  128 May 31 12:00 src\r\n'
      } else if (cmd === 'pwd') {
        out = '/home/user\r\n'
      } else if (cmd === 'whoami') {
        out = 'user\r\n'
      } else if (cmd === 'uptime') {
        out = ' 12:00:00 up 3 days, 4:20, 2 users, load average: 0.10, 0.08, 0.05\r\n'
      } else if (cmd === 'exit' || cmd === 'logout') {
        out = 'logout\r\nConnection to mock closed.\r\n'
      } else if (cmd === '') {
        out = ''
      } else {
        out = `${cmd}: simulated output\r\n`
      }
      if (out) send(ws, sessionId, out)
      if (cmd !== 'exit' && cmd !== 'logout') {
        send(ws, sessionId, 'user@mock:~$ ')
      }
    }
  })

  ws.on('close', () => {
    console.log('[ws] G2 disconnected')
    intervals.forEach(clearInterval)
  })
})

function send(ws, sessionId, data) {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify({ type: 'output', sessionId, data }))
  }
}
