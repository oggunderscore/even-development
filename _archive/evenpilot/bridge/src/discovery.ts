// HTTP discovery endpoint — lets the G2 app find the bridge's current WS URL
// by querying a fixed mDNS hostname instead of a hardcoded IP.
//
// macOS broadcasts <ComputerName>.local via Bonjour automatically — no config needed.
// iOS WKWebView resolves .local names natively on the same Wi-Fi subnet.
//
// G2 app discovery flow:
//   1. Try last-working IP from local storage  (fast path, ~50 ms)
//   2. GET http://HOSTNAME.local:8767/discover  (mDNS path, ~200 ms)
//   3. Save new URL to local storage and connect

import express from 'express'
import * as os from 'os'

export const DISCOVERY_PORT = 8767

export interface DiscoveryPayload {
  wsUrl: string    // ws://192.168.x.x:8765   — current IP-based URL
  mdnsUrl: string  // ws://hostname.local:8765 — stable mDNS URL (also works)
  hostname: string // e.g. "kevins-macbook-pro"
  ip: string       // e.g. "192.168.1.47"
}

function currentLanIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return '127.0.0.1'
}

export function startDiscoveryServer(wsPort: number): void {
  const app = express()
  const hostname = os.hostname()

  // Permissive CORS — the G2 WebView origin is controlled by Even Hub, not us
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET')
    next()
  })

  app.get('/discover', (_req, res) => {
    const ip = currentLanIp()
    const payload: DiscoveryPayload = {
      wsUrl:   `ws://${ip}:${wsPort}`,
      mdnsUrl: `ws://${hostname}.local:${wsPort}`,
      hostname,
      ip,
    }
    res.json(payload)
  })

  app.listen(DISCOVERY_PORT, '0.0.0.0', () => {
    const ip = currentLanIp()
    console.log('\n── G2 Bridge ready ───────────────────────────────────────────')
    console.log(`  WebSocket  ws://${ip}:${wsPort}`)
    console.log(`  mDNS       ws://${hostname}.local:${wsPort}`)
    console.log(`  Discovery  http://${ip}:${DISCOVERY_PORT}/discover`)
    console.log(`\n  In G2 app src/main.ts set:  BRIDGE_HOSTNAME = '${hostname}'`)
    console.log('──────────────────────────────────────────────────────────────\n')
  })
}
