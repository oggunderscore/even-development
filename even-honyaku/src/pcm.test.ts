import { describe, expect, it } from 'vitest'
import { toBytes } from './pcm'

describe('toBytes', () => {
  it('passes a Uint8Array through unchanged', () => {
    const a = new Uint8Array([1, 2, 3])
    expect(toBytes(a)).toBe(a)
  })
  it('converts number[]', () => {
    expect(Array.from(toBytes([0, 255, 7])!)).toEqual([0, 255, 7])
  })
  it('decodes base64 strings', () => {
    expect(Array.from(toBytes(btoa(String.fromCharCode(1, 2, 250)))!)).toEqual([1, 2, 250])
  })
  it('returns null for anything else', () => {
    expect(toBytes(undefined)).toBeNull()
    expect(toBytes({})).toBeNull()
  })
})
