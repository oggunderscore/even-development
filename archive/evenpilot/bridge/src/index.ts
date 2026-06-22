// warp-g2-bridge — entry point
//
// Starts three servers in the same process, sharing a single PtyManager:
//
//   WS        ws://0.0.0.0:8765   — G2 glasses connect here
//   MCP       http://0.0.0.0:8766 — Warp AI agent (add to ~/.warp/mcp.json)
//   Discovery http://0.0.0.0:8767 — G2 auto-discovers current IP via this
//
// Usage:
//   npm run dev    (tsx watch — live reload)
//   npm start      (compiled JS)
//
// Environment overrides:
//   G2_WS_PORT=8765  G2_MCP_PORT=8766  G2_DISC_PORT=8767

import { PtyManager } from './pty'
import { startWsServer } from './ws'
import { startMcpServer } from './mcp'
import { startDiscoveryServer } from './discovery'

const WS_PORT  = Number(process.env['G2_WS_PORT']  ?? 8765)
const MCP_PORT = Number(process.env['G2_MCP_PORT'] ?? 8766)

const ptys = new PtyManager()

const wss = startWsServer(WS_PORT, ptys)
startMcpServer(MCP_PORT, ptys)
startDiscoveryServer(WS_PORT)  // prints hostname + current IP on startup

// ── Graceful shutdown ──────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n[main] ${signal} received — shutting down`)
  ptys.killAll()
  wss.close(() => {
    console.log('[main] WebSocket server closed')
    process.exit(0)
  })
  // Force exit if wss.close stalls (e.g. a hung G2 connection)
  setTimeout(() => process.exit(0), 3_000).unref()
}

process.on('SIGINT',  () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled rejection:', reason)
})
