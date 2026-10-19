import { describe, expect, it } from 'vitest'
import type { ReplyOption } from '../protocol'
import { ECHO_CERTAIN, ECHO_LIKELY } from './voice'
import { EchoMatcher, loose, similarity } from './echo'

const yes: ReplyOption = { gloss: 'Yes, please', ja: 'はい、お願いします。', romaji: 'hai, onegaishimasu.' }
const no: ReplyOption = { gloss: 'No, thank you', ja: 'いいえ、大丈夫です。', romaji: 'iie, daijoubu desu.' }
const thanks: ReplyOption = { gloss: 'Thank you', ja: 'ありがとうございます。', romaji: 'arigatou gozaimasu.' }

describe('loose', () => {
  it('makes kana, romaji and punctuation comparable', () => {
    expect(loose('Hai, onegaishimasu.')).toBe('haionegaishimasu')
    expect(loose('はい、おねがいします。')).toBe('haionegaishimasu')
    expect(loose('ハイ')).toBe('hai')
    expect(loose('お願い')).toBe('o願i')
  })
})

describe('similarity', () => {
  it('identical text in different scripts is 1', () => {
    expect(similarity('はい、お願いします', 'hai, onegaishimasu')).toBeLessThan(1) // kanji vs. romaji can't be unified…
    expect(similarity('はい、おねがいします', 'hai, onegaishimasu')).toBe(1)
  })
  it('a slightly different transcript still scores high, an unrelated one low', () => {
    expect(similarity('はいお願いします', yes.ja)).toBeGreaterThan(0.85)
    expect(similarity('はい おねがいします ね', yes.romaji)).toBeGreaterThan(0.75)
    expect(similarity('これはいくらですか', yes.ja)).toBeLessThan(0.3)
  })
  it('a longer sentence that merely contains the suggestion is not the wearer reading it', () => {
    expect(similarity('ありがとうございますまたいらしてくださいね', thanks.ja)).toBeLessThan(ECHO_CERTAIN)
    expect(similarity('ありがとうございます', thanks.ja)).toBe(1)
    expect(similarity('ありがとうございますね', thanks.ja)).toBeGreaterThan(0.85) // a small extra word still matches
  })
  it('reading only part of a suggestion still matches, and a merged longer transcript does not', () => {
    expect(similarity('お願いします', yes.ja)).toBeGreaterThanOrEqual(0.72)
    expect(similarity('hai onegaishimasu to omoimasu kedo mou sukoshi kangaetemo ii desu ka', yes.romaji)).toBeLessThan(0.72)
  })
  it('very short text only matches exactly', () => {
    expect(similarity('はい', 'hai')).toBe(1)
    expect(similarity('はい', 'iie')).toBe(0)
    expect(similarity('a', 'a')).toBe(0)
  })
})

describe('EchoMatcher', () => {
  it('finds which suggestion the wearer is reading, in Japanese script', () => {
    const m = new EchoMatcher()
    m.remember(7, [yes, no])
    const hit = m.match('いいえ、大丈夫です', 'ja')!
    expect(hit).toMatchObject({ turnId: 7, index: 1 })
    expect(hit.score).toBeGreaterThanOrEqual(ECHO_CERTAIN)
  })

  it('a near-phonetic English transcript of a read-aloud romaji line scores as a likely echo', () => {
    const m = new EchoMatcher()
    m.remember(7, [yes, no])
    const hit = m.match('hi onegai shi mas', 'en')!
    expect(hit.index).toBe(0)
    expect(hit.score).toBeGreaterThanOrEqual(ECHO_LIKELY)
  })

  it('ordinary English the wearer says freely does not match', () => {
    const m = new EchoMatcher()
    m.remember(7, [yes, no])
    expect(m.match('where is the nearest station', 'en')?.score ?? 0).toBeLessThan(ECHO_LIKELY)
  })

  it('unrelated Japanese from the other person does not match', () => {
    const m = new EchoMatcher()
    m.remember(7, [yes, thanks])
    expect(m.match('お飲み物は何になさいますか', 'ja')?.score ?? 0).toBeLessThan(ECHO_LIKELY)
  })

  it('forgets suggestions after two minutes and keeps only the newest sets', () => {
    const m = new EchoMatcher()
    m.remember(1, [yes], 1_000)
    expect(m.match('はい、お願いします', 'ja', 1_000 + 119_000)).not.toBeNull()
    expect(m.match('はい、お願いします', 'ja', 1_000 + 121_000)).toBeNull()
    for (let i = 2; i <= 6; i++) m.remember(i, [no], 5_000)
    expect(m.match('はい、お願いします', 'ja', 5_000)?.turnId).not.toBe(1)
  })
})
