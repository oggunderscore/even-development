import { describe, expect, it } from 'vitest'
import { BODY_ROWS, PredictiveView } from './predictive'
import type { Prediction, Translation } from './protocol'

const q = (id: number, english: string, extra: Partial<Translation> = {}): Translation => ({ id, dir: 'listen', japanese: 'ホットですか', romaji: 'hotto desu ka', english, ...extra })
const choice: Prediction = {
  kind: 'choice',
  options: [
    { gloss: 'Hot, please', ja: 'ホットでお願いします', romaji: 'hotto de onegaishimasu' },
    { gloss: 'Iced, please', ja: 'アイスでお願いします', romaji: 'aisu de onegaishimasu' },
    { gloss: 'Neither', ja: '結構です', romaji: 'kekkou desu' },
  ],
}
const single: Prediction = { kind: 'single', options: [{ gloss: 'Thank you', ja: 'ありがとうございます', romaji: 'arigatou gozaimasu' }] }

const view = () => new PredictiveView({ kana: false })

describe('PredictiveView rows', () => {
  it('starts with a waiting message', () => {
    expect(view().rows().join(' ')).toMatch(/Waiting/)
  })

  it('shows the question, then "thinking", then the options with a cursor', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    expect(v.rows()).toEqual(['JP: Hot or iced?', '', 'thinking...'])
    v.predictions(1, choice)
    expect(v.rows()).toEqual([
      'JP: Hot or iced?',
      '▶ 1 Hot, please',
      '     hotto de onegaishimasu',
      '  2 Iced, please',
      '     aisu de onegaishimasu',
      '  3 Neither',
      '     kekkou desu',
    ])
  })

  it('a single reply is not numbered', () => {
    const v = view()
    v.heard(q(1, 'Thank you for coming.'), true)
    v.predictions(1, single)
    expect(v.rows()).toEqual(['JP: Thank you for coming.', '▶ Thank you', '     arigatou gozaimasu'])
  })

  it('never exceeds the row budget, even with a long question and wrapping romaji, and keeps the cursor option visible', () => {
    const v = view()
    v.heard(q(1, 'Thank you very much for visiting our restaurant today, we hope that everything was to your liking and that you will come again soon'), true)
    const long: Prediction = {
      kind: 'choice',
      options: [1, 2, 3].map((n) => ({ gloss: `Option number ${n} is described here`, ja: 'はい', romaji: `watashi wa kore o onegaishimasu to omoimasu ${n}` })),
    }
    v.predictions(1, long)
    for (let i = 0; i < 3; i++) {
      expect(v.rows().length).toBeLessThanOrEqual(BODY_ROWS)
      expect(v.rows().join('\n')).toMatch(/▶/)
      v.move('down')
    }
    expect(v.rows()[0]).toMatch(/^JP: Thank you very much/)
    expect(v.rows()[1]).toMatch(/\.\.$/) // the question was clipped to two rows
  })

  it('kana mode adds the Japanese line; off by default', () => {
    const v = new PredictiveView({ kana: true })
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    expect(v.rows()[0]).toBe('ホットですか')
    expect(view().rows()[0]).toBe('Waiting for them to speak.')
  })

  it('an unsure turn is marked and a failed prediction explains itself', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?', { unsure: true }), true)
    expect(v.rows()).toEqual(['JP: Hot or iced? (?)'])
    const w = view()
    w.heard(q(1, 'Hot or iced?'), true)
    w.failed('timeout')
    expect(w.rows().join(' ')).toMatch(/no suggestions: timeout/)
  })
})

describe('PredictiveView gestures', () => {
  it('swipe moves the cursor; it stops at the ends', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    expect(v.move('down')).toBe(true)
    expect(v.move('down')).toBe(true)
    expect(v.move('down')).toBe(false)
    expect(v.rows().find((r) => r.startsWith('▶'))).toBe('▶ 3 Neither')
    expect(v.move('up')).toBe(true)
    expect(v.rows().find((r) => r.startsWith('▶'))).toBe('▶ 2 Iced, please')
  })

  it('tap zooms into the highlighted option once, reporting it as chosen, and tap again zooms out', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    v.move('down')
    const first = v.tap()
    expect(first).toEqual({ changed: true, chose: choice.options[1] })
    expect(v.isFocused).toBe(true)
    expect(v.rows()).toEqual(['JP: Hot or iced?', '', 'Iced, please', 'aisu de onegaishimasu'])
    expect(v.tap()).toEqual({ changed: true })
    expect(v.isFocused).toBe(false)
    expect(v.rows().find((r) => r.startsWith('●'))).toBe('● 2 Iced, please')
  })

  it('swiping up past the first option reads earlier turns; tap returns to the live one', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    v.said(0)
    v.heard(q(2, 'Would you like milk?'), true)
    v.predictions(2, single)
    expect(v.isLive).toBe(true)
    expect(v.move('up')).toBe(true)
    expect(v.isLive).toBe(false)
    expect(v.rows()[0]).toBe('JP: Hot or iced?')
    expect(v.rows().find((r) => r.startsWith('●'))).toBe('● 1 Hot, please')
    expect(v.tap().changed).toBe(true)
    expect(v.isLive).toBe(true)
    expect(v.rows()[0]).toBe('JP: Would you like milk?')
  })
})

describe('PredictiveView conversation flow', () => {
  it('once the wearer answers, the next thing the other person says starts a new turn', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    v.said(1)
    expect(v.rows().find((r) => r.startsWith('●'))).toBe('● 2 Iced, please')
    v.hearing('ミルクは')
    expect(v.rows()[0]).toBe('JP: ミルクは...')
    v.heard(q(2, 'Milk?'), true)
    expect(v.rows()).toEqual(['JP: Milk?', '', 'thinking...'])
  })

  it('a second phrase before the wearer answers extends the same turn', () => {
    const v = view()
    v.heard(q(1, 'Welcome.'), true)
    v.heard(q(2, 'Hot or iced?'), true)
    expect(v.rows()[0]).toBe('JP: Welcome. Hot or iced?')
    v.predictions(2, choice)
    expect(v.rows().filter((r) => r.startsWith('▶'))).toHaveLength(1)
  })

  it('a new question long after the last one, with no answer in between, is a new turn', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true, 1_000)
    v.predictions(1, choice)
    v.heard(q(2, 'Would you like milk?'), true, 1_000 + 30_000)
    expect(v.rows()).toEqual(['JP: Would you like milk?', '', 'thinking...'])
    // …but the previous turn is still there to read
    v.predictions(2, single)
    expect(v.move('up')).toBe(true)
    expect(v.rows()[0]).toBe('JP: Hot or iced?')
  })

  it('a quick follow-up within the window still joins the same turn', () => {
    const v = view()
    v.heard(q(1, 'Welcome.'), true, 1_000)
    v.heard(q(2, 'Hot or iced?'), true, 1_000 + 4_000)
    expect(v.rows()[0]).toBe('JP: Welcome. Hot or iced?')
  })

  it('an answer to an earlier question does not mark the current turn\'s options', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    v.heard(q(2, 'Milk?'), true, Date.now() + 60_000) // far later: a new turn, while turn 1 stays unanswered
    v.predictions(2, choice)
    v.said(1, 1) // the wearer read option 2 of the FIRST question's set
    expect(v.rows().some((r) => r.startsWith('●'))).toBe(false)
    v.said(1, 2)
    expect(v.rows().find((r) => r.startsWith('●'))).toBe('● 2 Iced, please')
  })

  it('a late prediction for a turn that has since grown is dropped, not attached to the new one', () => {
    const v = view()
    v.heard(q(1, 'Welcome.'), true)
    v.heard(q(2, 'Hot or iced?'), true)
    v.predictions(1, single) // answers only the first phrase; the turn already moved on
    expect(v.rows().join(' ')).not.toMatch(/Thank you/)
    v.predictions(2, choice)
    expect(v.rows().join(' ')).toMatch(/Hot, please/)
  })

  it('an unsure phrase joins the turn without stealing the prediction target', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.heard(q(2, 'uh huh', { unsure: true }), false)
    v.predictions(1, choice)
    expect(v.rows().join(' ')).toMatch(/Hot, please/)
  })

  it('a prediction for a turn that has been answered or replaced is ignored', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.said(0) // nothing to say yet: no prediction, so ignored
    v.predictions(1, choice)
    v.said(0)
    v.predictions(1, single)
    expect(v.rows().join(' ')).not.toMatch(/Thank you/)
  })

  it('the wearer answering in free English shows their romaji', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), true)
    v.predictions(1, choice)
    v.heard({ id: 2, dir: 'speak', english: 'Iced, but with no sugar', japanese: '砂糖なしのアイスで', romaji: 'satou nashi no aisu de' }, false)
    expect(v.rows()).toEqual(['JP: Hot or iced?', '', 'you: Iced, but with no sugar', 'satou nashi no aisu de'])
  })

  it('the wearer\'s own Japanese is dropped without leaving a stray turn behind', () => {
    const v = view()
    v.hearing('アイスでお')
    expect(v.hasContent).toBe(true)
    v.selfSpoke()
    expect(v.hasContent).toBe(false)
    v.hearing('アイス')
    v.hearing('')
    expect(v.hasContent).toBe(false)
  })

  it('plain translations without predictions (predictive mode but unsure / no LLM) just show the question', () => {
    const v = view()
    v.heard(q(1, 'Hot or iced?'), false)
    expect(v.rows()).toEqual(['JP: Hot or iced?'])
  })
})
