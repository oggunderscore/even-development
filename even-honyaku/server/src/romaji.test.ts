import { describe, expect, it } from 'vitest'
import { romanize } from '../../src/core/romaji'
import './romaji-node'

describe('romanize', () => {
  const cases: [string, string][] = [
    ['これはいくらですか？', 'kore wa ikura desu ka?'],
    ['ありがとうございます。', 'arigatou gozaimasu.'],
    ['私は東京へ行きたいです。', 'watashi wa toukyou e ikitai desu.'],
    ['コーヒーをください', 'koohii o kudasai'],
    ['昨日、友達と食べました', 'kinou, tomodachi to tabemashita'],
  ]
  it.each(cases)('%s → %s', async (ja, expected) => {
    expect(await romanize(ja)).toBe(expected)
  })
  it('is ASCII-only so the G2 font never drops a glyph', async () => {
    expect(await romanize('今日はいい天気ですね')).toMatch(/^[\x20-\x7e]*$/)
  })
})
