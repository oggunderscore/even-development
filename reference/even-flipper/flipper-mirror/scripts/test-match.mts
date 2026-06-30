// Offline matcher validation: render known lines into a 128x64 frame with the
// real font glyphs, then run the matcher and check recovery.
// Run: node --experimental-strip-types scripts/test-match.mts

import { matchFrame, renderTextToFrame, frameToGrid, W, H } from '../src/glyph-match.ts'

function asciiFrame(frame: Uint8Array): string {
  const g = frameToGrid(frame)
  let s = ''
  for (let y = 0; y < H; y++) {
    let line = ''
    for (let x = 0; x < W; x++) line += g[y * W + x] ? '#' : ' '
    s += line.replace(/\s+$/, '') + '\n'
  }
  return s
}

let pass = 0
let fail = 0
function check(label: string, got: string[], want: string[]) {
  const g = got.map((s) => s.trim()).filter(Boolean)
  const ok = JSON.stringify(g) === JSON.stringify(want)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) {
    console.log(`   want: ${JSON.stringify(want)}`)
    console.log(`   got:  ${JSON.stringify(g)}`)
  }
  ok ? pass++ : fail++
}

// 1. haxrcorp4089 menu (FontSecondary) - the dominant Flipper list font.
{
  const frame = renderTextToFrame([
    { text: 'Sub-GHz', font: 'haxrcorp4089', x: 2, baseline: 9 },
    { text: 'NFC', font: 'haxrcorp4089', x: 2, baseline: 21 },
    { text: 'Infrared', font: 'haxrcorp4089', x: 2, baseline: 33 },
    { text: 'Settings', font: 'haxrcorp4089', x: 2, baseline: 45 },
  ])
  const m = matchFrame(frame)
  console.log('--- haxrcorp menu ---')
  console.log(asciiFrame(frame))
  console.log('matched:', JSON.stringify(m.lines.map((l) => l.text)), 'conf', m.confidence.toFixed(2))
  check('haxrcorp menu', m.lines.map((l) => l.text), ['Sub-GHz', 'NFC', 'Infrared', 'Settings'])
}

// 2. helvB08 (FontPrimary) header line.
{
  const frame = renderTextToFrame([
    { text: 'Flipper', font: 'helvB08', x: 2, baseline: 10 },
    { text: 'Device Info', font: 'helvB08', x: 2, baseline: 26 },
  ])
  const m = matchFrame(frame)
  console.log('matched:', JSON.stringify(m.lines.map((l) => l.text)), 'conf', m.confidence.toFixed(2))
  check('helvB08 header', m.lines.map((l) => l.text), ['Flipper', 'Device Info'])
}

// 3. mixed digits/case (haxrcorp)
{
  const frame = renderTextToFrame([
    { text: 'Freq 433.92', font: 'haxrcorp4089', x: 2, baseline: 9 },
    { text: 'RSSI -67 dBm', font: 'haxrcorp4089', x: 2, baseline: 21 },
  ])
  const m = matchFrame(frame)
  console.log('matched:', JSON.stringify(m.lines.map((l) => l.text)), 'conf', m.confidence.toFixed(2))
  check('haxrcorp digits', m.lines.map((l) => l.text), ['Freq 433.92', 'RSSI -67 dBm'])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
