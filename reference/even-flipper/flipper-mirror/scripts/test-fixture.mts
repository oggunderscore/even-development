// Run the matcher against a saved real frame, showing before/after pixels.
// Usage: node --experimental-strip-types scripts/test-fixture.mts fixtures/real-menu.bin
import fs from 'node:fs'
import { matchFrame, frameToGrid, W, H } from '../src/glyph-match.ts'

const path = process.argv[2] ?? 'fixtures/real-menu.bin'
const frame = new Uint8Array(fs.readFileSync(path))
function ascii(g: Uint8Array) {
  let s = ''
  for (let y = 0; y < H; y++) {
    let l = ''
    for (let x = 0; x < W; x++) l += g[y * W + x] ? '#' : ' '
    s += '|' + l.replace(/\s+$/, '') + '\n'
  }
  return s
}
console.log('=== RAW ===')
console.log(ascii(frameToGrid(frame)))
const m = matchFrame(frame)
console.log('=== RECOVERY (conf ' + m.confidence.toFixed(2) + ') ===')
for (const l of m.lines) console.log((l.highlighted ? '> ' : '  ') + JSON.stringify(l.text) + '  [' + l.font + ' y' + l.top + '-' + l.bottom + ']')
