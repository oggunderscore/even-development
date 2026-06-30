// Mock Flipper bridge for SIMULATOR TESTING ONLY (no phone/Flipper needed).
// Speaks the same ws://127.0.0.1:9876/ws protocol as the Android bridge and
// streams a synthetic, interactive Flipper main-menu frame so text mode (glyph
// matching) can be exercised in the simulator. up/down move the highlight.
//
// Renders the menu with the real Flipper secondary font (haxrcorp4089) from
// src/font-data.ts, with the selected row inverted (filled bar, text as holes)
// exactly like the firmware - so the matcher's inversion handling is exercised.
//
// Usage: node scripts/mock-flipper.mjs

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

// --- load font data ---
const txt = fs.readFileSync(new URL('../src/font-data.ts', import.meta.url), 'utf8')
const marker = 'export const FONTS: Record<string, BdfFont> = '
const FONTS = JSON.parse(txt.slice(txt.indexOf(marker) + marker.length))
const FONT = FONTS.haxrcorp4089
const gbit = (gl, gr, c) => (gl.rows[gr] >> (gl.rowBits - 1 - c)) & 1

const W = 128, H = 64
const ITEMS = ['Sub-GHz', 'RFID', 'NFC', 'Infrared', 'GPIO', 'iButton', 'Bad USB', 'U2F', 'Settings']
let sel = 0
let scroll = 0
const VIS = 5

function setPx(buf, x, y, v) {
  if (x < 0 || x >= W || y < 0 || y >= H) return
  const i = y * (W / 8) + (x >> 3)
  const m = 0x80 >> (x & 7)
  if (v) buf[i] |= m
  else buf[i] &= ~m
}
function drawText(buf, str, x, baseline, value) {
  let pen = x
  for (const ch of str) {
    const gl = FONT.glyphs[ch.charCodeAt(0)]
    if (!gl) { pen += Math.round(FONT.bbw * 0.5); continue }
    const top = baseline - gl.yo - gl.h
    for (let gr = 0; gr < gl.h; gr++)
      for (let c = 0; c < gl.w; c++)
        if (gbit(gl, gr, c)) setPx(buf, pen + gl.xo + c, top + gr, value)
    pen += gl.dw
  }
}
function renderFrame() {
  if (sel < scroll) scroll = sel
  if (sel >= scroll + VIS) scroll = sel - VIS + 1
  const buf = Buffer.alloc((W * H) / 8)
  for (let i = 0; i < VIS; i++) {
    const it = scroll + i
    if (it >= ITEMS.length) break
    const baseline = 10 + i * 12
    if (it === sel) {
      // filled selection bar, then punch the text out as holes (inverted)
      for (let y = baseline - 9; y <= baseline + 2; y++) for (let x = 0; x < W; x++) setPx(buf, x, y, 1)
      drawText(buf, ITEMS[it], 3, baseline, 0)
    } else {
      drawText(buf, ITEMS[it], 3, baseline, 1)
    }
  }
  return buf
}

// --- websocket (raw, no deps) ---
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
function encodeText(str) {
  const p = Buffer.from(str, 'utf8')
  const l = p.length
  const h = l < 126 ? Buffer.from([0x81, l]) : (() => { const b = Buffer.alloc(4); b[0] = 0x81; b[1] = 126; b.writeUInt16BE(l, 2); return b })()
  return Buffer.concat([h, p])
}
let seq = 0
function frameMsg() {
  seq++
  return encodeText(JSON.stringify({ type: 'frame', w: W, h: H, bpp: 1, seq, data: renderFrame().toString('base64') }))
}
const server = createServer()
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`)
  console.log('client connected')
  socket.write(encodeText(JSON.stringify({ type: 'status', state: 'connected', info: 'mock flipper' })))
  socket.write(frameMsg())

  let buf = Buffer.alloc(0)
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    // parse masked client text frames
    while (buf.length >= 2) {
      const len0 = buf[1] & 0x7f
      let off = 2, len = len0
      if (len0 === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4 }
      const masked = (buf[1] & 0x80) !== 0
      const need = off + (masked ? 4 : 0) + len
      if (buf.length < need) break
      const mask = masked ? buf.slice(off, off + 4) : null
      const payload = buf.slice(off + (masked ? 4 : 0), need)
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      buf = buf.slice(need)
      const opcode = buf.length >= 0 ? null : null
      void opcode
      let msg
      try { msg = JSON.parse(payload.toString()) } catch { continue }
      if (msg.type === 'button') {
        if (msg.action === 'short' || msg.action === 'press') {
          if (msg.key === 'down') sel = Math.min(ITEMS.length - 1, sel + 1)
          else if (msg.key === 'up') sel = Math.max(0, sel - 1)
          else if (msg.key === 'ok') console.log('OK on', ITEMS[sel])
          console.log('button', msg.key, '-> sel', ITEMS[sel])
          try { socket.write(frameMsg()) } catch {}
        }
      } else if (msg.type === 'ready') {
        // credit-based pacing: only resend if the screen changed (seq-based).
        // Here we simply don't spam - frames are pushed on button changes.
      } else if (msg.type === 'connect') {
        try { socket.write(frameMsg()) } catch {}
      }
    }
  })
  socket.on('error', () => {})
})
server.listen(9876, '127.0.0.1', () => console.log('mock Flipper bridge: ws://127.0.0.1:9876/ws  (up/down to navigate)'))
