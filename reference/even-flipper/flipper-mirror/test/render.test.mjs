// Standalone render test - no test runner, no extra deps.
// Replicates upscale1bppToGray4 + hashFrame to validate the transform on
// known patterns. Run: `node test/render.test.mjs`.

import assert from 'node:assert/strict'

const SRC_W = 128
const SRC_H = 64
const DST_W = 256
const DST_H = 128
const DST_BYTES = (DST_W * DST_H) / 2

function upscale1bppToGray4(src, w = SRC_W, h = SRC_H) {
  if (w !== SRC_W || h !== SRC_H) throw new Error('size mismatch')
  const dst = new Uint8Array(DST_BYTES)
  const bytesPerSrcRow = w / 8
  const bytesPerDstRow = DST_W / 2
  for (let sy = 0; sy < h; sy++) {
    const srcRowOff = sy * bytesPerSrcRow
    const dstRow0 = sy * 2 * bytesPerDstRow
    const dstRow1 = (sy * 2 + 1) * bytesPerDstRow
    for (let sxByte = 0; sxByte < bytesPerSrcRow; sxByte++) {
      const byte = src[srcRowOff + sxByte]
      const dstByteOff = sxByte * 8
      for (let bit = 0; bit < 8; bit++) {
        const on = (byte >> (7 - bit)) & 1
        const nibblePair = on ? 0xff : 0x00
        dst[dstRow0 + dstByteOff + bit] = nibblePair
        dst[dstRow1 + dstByteOff + bit] = nibblePair
      }
    }
  }
  return dst
}

function hashFrame(buf) {
  let h = 0x811c9dc5
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Pixel readback helper.
// gray4 packed: each byte = high nibble (left pixel) << 4 | low nibble (right pixel).
function readPixel(dst, x, y) {
  const byteIdx = y * (DST_W / 2) + (x >> 1)
  const byte = dst[byteIdx]
  return (x & 1) === 0 ? (byte >> 4) & 0xf : byte & 0xf
}

// --- Test 1: all-zero input -> all-zero output ---
{
  const src = new Uint8Array(1024)
  const dst = upscale1bppToGray4(src)
  assert.equal(dst.length, DST_BYTES, 'dst length')
  for (let i = 0; i < dst.length; i++) assert.equal(dst[i], 0x00, `dst[${i}] should be 0`)
  console.log('PASS  zero input -> zero output')
}

// --- Test 2: all-ones input -> all 0xFF output ---
{
  const src = new Uint8Array(1024).fill(0xff)
  const dst = upscale1bppToGray4(src)
  for (let i = 0; i < dst.length; i++) assert.equal(dst[i], 0xff, `dst[${i}] should be 0xff`)
  console.log('PASS  full-on input -> full-on output')
}

// --- Test 3: single set pixel at (0,0) becomes a 2x2 block at (0,0)..(1,1) ---
{
  const src = new Uint8Array(1024)
  src[0] = 0x80 // top bit of byte 0 = pixel (0,0) on
  const dst = upscale1bppToGray4(src)
  // The 2x2 block must be lit:
  assert.equal(readPixel(dst, 0, 0), 0xf, '(0,0) on')
  assert.equal(readPixel(dst, 1, 0), 0xf, '(1,0) on')
  assert.equal(readPixel(dst, 0, 1), 0xf, '(0,1) on')
  assert.equal(readPixel(dst, 1, 1), 0xf, '(1,1) on')
  // Neighbors must be off:
  assert.equal(readPixel(dst, 2, 0), 0x0, '(2,0) off')
  assert.equal(readPixel(dst, 0, 2), 0x0, '(0,2) off')
  assert.equal(readPixel(dst, 2, 2), 0x0, '(2,2) off')
  // Bottom-right corner of the frame still off:
  assert.equal(readPixel(dst, DST_W - 1, DST_H - 1), 0x0, 'bottom-right off')
  console.log('PASS  single pixel at (0,0) upscales to 2x2 block')
}

// --- Test 4: single set pixel at (127, 63) (bottom-right) -> block at (254..255, 126..127) ---
{
  const src = new Uint8Array(1024)
  // Last byte holds pixels x=120..127 of row 63.
  src[1023] = 0x01 // bit 0 = pixel (127, 63)
  const dst = upscale1bppToGray4(src)
  for (const [x, y] of [
    [254, 126],
    [255, 126],
    [254, 127],
    [255, 127],
  ]) {
    assert.equal(readPixel(dst, x, y), 0xf, `(${x},${y}) on`)
  }
  // And a neighbor that should be off:
  assert.equal(readPixel(dst, 253, 127), 0x0, '(253,127) off')
  assert.equal(readPixel(dst, 255, 125), 0x0, '(255,125) off')
  console.log('PASS  single pixel at (127,63) upscales to bottom-right 2x2 block')
}

// --- Test 5: hashFrame stability and differentness ---
{
  const a = new Uint8Array(1024).fill(0xaa)
  const b = new Uint8Array(1024).fill(0xaa)
  const c = new Uint8Array(1024).fill(0xaa)
  c[500] = 0x55
  assert.equal(hashFrame(a), hashFrame(b), 'identical buffers hash equal')
  assert.notEqual(hashFrame(a), hashFrame(c), 'different buffers hash differently')
  // FNV-1a 32 bit canonical anchor: hash of empty input == offset basis.
  assert.equal(hashFrame(new Uint8Array(0)), 0x811c9dc5, 'empty hash == FNV offset basis')
  console.log('PASS  hashFrame stable + collision-free on test inputs')
}

console.log('\nAll render tests passed.')
