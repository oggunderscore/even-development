// MCP HTTP server — registers with Warp as an AI agent tool provider.
// Warp's agent can call g2_execute, g2_ssh, and g2_sessions to control
// the G2 terminal from inside Warp's natural-language agent mode.
//
// Register in ~/.warp/mcp.json:
//   { "servers": [{ "name": "G2 Bridge", "type": "url", "url": "http://localhost:8766/mcp" }] }

import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { PtyManager } from './pty'
import { makeLog } from './log'

const log = makeLog('mcp')

// Active MCP sessions: sessionId → transport
const transports = new Map<string, StreamableHTTPServerTransport>()

function buildMcpServer(ptys: PtyManager): McpServer {
  const server = new McpServer({
    name: 'warp-g2-bridge',
    version: '0.1.0',
  })

  // McpServer.tool() generic inference hits TS instantiation depth limit with optional zod
  // fields (modelcontextprotocol/typescript-sdk#451). Cast to any for registration only —
  // runtime behaviour is fully correct.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = server.tool.bind(server) as (...args: any[]) => void

  reg('g2_sessions', 'List all active G2 terminal sessions and their IDs', {},
    async () => {
      const list = ptys.list()
      log.info(`tool: g2_sessions → ${list.length} sessions`)
      const text = list.length > 0 ? list.join('\n') : '(no active sessions)'
      return { content: [{ type: 'text' as const, text }] }
    },
  )

  reg('g2_execute', 'Run a shell command in an active G2 terminal session',
    {
      command:   z.string().describe('Shell command to execute'),
      sessionId: z.string().optional().describe('Target session ID. Omit to use the first active session.'),
    },
    async ({ command, sessionId }: { command: string; sessionId?: string }) => {
      const id = sessionId ?? ptys.list()[0]
      log.info(`tool: g2_execute  id=${id ?? 'none'}  cmd="${command}"`)
      if (!id) {
        return { content: [{ type: 'text' as const, text: 'No active G2 sessions. Ask the user to connect the glasses first.' }] }
      }
      const ok = ptys.write(id, command)
      const text = ok
        ? `Sent to session ${id}: ${command}`
        : `Session ${id} not found — it may have exited`
      return { content: [{ type: 'text' as const, text }] }
    },
  )

  reg('g2_ssh', 'Open an SSH session on the G2 glasses terminal',
    {
      host:      z.string().describe('Hostname or IP address to SSH into'),
      user:      z.string().describe('SSH username'),
      sessionId: z.string().optional().describe('Session ID to use. Auto-generated if omitted.'),
    },
    async ({ host, user, sessionId }: { host: string; user: string; sessionId?: string }) => {
      const id = sessionId ?? `g2-mcp-${Date.now()}`
      log.info(`tool: g2_ssh  id=${id}  target=${user}@${host}`)
      ptys.spawnSsh(id, host, user)
      return {
        content: [{
          type: 'text' as const,
          text: `SSH session ${id} opened: ${user}@${host}. Use g2_execute with sessionId="${id}" to run commands.`,
        }],
      }
    },
  )

  return server
}

export function startMcpServer(port: number, ptys: PtyManager): void {
  const app = express()
  app.use(express.json())

  // POST — initialize or dispatch to existing session
  app.post('/mcp', async (req, res) => {
    const existingId = req.headers['mcp-session-id'] as string | undefined

    try {
      // Route to existing session
      if (existingId && transports.has(existingId)) {
        await transports.get(existingId)!.handleRequest(req, res, req.body)
        return
      }

      // New session — pre-generate ID so we can store it before handleRequest fires
      const newSessionId = randomUUID()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      transports.set(newSessionId, transport)
      transport.onclose = () => {
        transports.delete(newSessionId)
        log.info(`session closed  id=${newSessionId}`)
      }

      const server = buildMcpServer(ptys)
      await server.connect(transport)
      log.info(`session opened  id=${newSessionId}`)

      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      log.error('request error:', err)
      if (!res.headersSent) res.status(500).json({ error: String(err) })
    }
  })

  // GET — SSE stream for existing session (used by some MCP clients)
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    const transport = sessionId ? transports.get(sessionId) : undefined
    if (!transport) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    await transport.handleRequest(req, res)
  })

  // DELETE — close session
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (sessionId) {
      transports.get(sessionId)?.close()
      transports.delete(sessionId)
    }
    res.sendStatus(204)
  })

  app.listen(port, '0.0.0.0', () => {
    log.info(`listening on http://0.0.0.0:${port}/mcp`)
  })
}
