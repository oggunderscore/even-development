/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// app.json is the single source of truth for the version (the dev portal, the .ehpk and the footer all show it).
const manifest = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8')) as { version: string }

// Script/markup hardening only. Outbound requests are deliberately NOT pinned here: the Even app already enforces
// the app.json network whitelist, and its bridge may use its own IPC transport that a connect-src would block.
// Production build only: the dev server needs inline scripts and a websocket for hot reload.
const csp = ["script-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'honyaku-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }],
})

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  plugins: [contentSecurityPolicy()],
  build: { target: 'esnext' }, // top-level await for waitForEvenAppBridge()
  test: { include: ['src/**/*.test.ts'] },
})
