import { describe, expect, it } from 'vitest'
import { parseJson, stripMacrons } from './translate'

describe('stripMacrons', () => {
  it('doubles long vowels so the G2 font never drops a glyph', () => {
    expect(stripMacrons('arigatō')).toBe('arigatou')
    expect(stripMacrons('kyūkō')).toBe('kyuukou')
    expect(stripMacrons('Ōsaka')).toBe('Ousaka')
    expect(stripMacrons('onēsan')).toBe('oneesan')
  })
  it('leaves plain ASCII alone', () => {
    expect(stripMacrons('kore wa ikura desu ka?')).toBe('kore wa ikura desu ka?')
  })
  it('output is ASCII-only', () => {
    expect(stripMacrons('Tōkyō é ñ')).toMatch(/^[\x20-\x7e]*$/)
  })
})

describe('parseJson', () => {
  it('parses bare JSON', () => {
    expect(parseJson('{"ja":"こんにちは","romaji":"konnichiwa"}')).toEqual({ ja: 'こんにちは', romaji: 'konnichiwa' })
  })
  it('tolerates code fences and chatter around the object', () => {
    expect(parseJson('Sure!\n```json\n{"en":"hi","romaji":"yaa"}\n```')).toEqual({ en: 'hi', romaji: 'yaa' })
  })
  it('throws when there is no object', () => {
    expect(() => parseJson('no json here')).toThrow(/no JSON/)
  })
})
