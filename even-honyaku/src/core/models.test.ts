import { describe, expect, it } from 'vitest'
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_MODELS, OPENROUTER_DEFAULT_MODEL, OPENROUTER_MODELS, LEGACY_OPENROUTER_DEFAULT_MODEL, activeModel, costPer1000Phrases, costText, findModel, modelLabel, priceText } from './models'

describe('model lists', () => {
  it('offer 5 to 10 OpenRouter models, with unique ids and sane prices', () => {
    expect(OPENROUTER_MODELS.length).toBeGreaterThanOrEqual(5)
    expect(OPENROUTER_MODELS.length).toBeLessThanOrEqual(10)
    expect(new Set(OPENROUTER_MODELS.map((m) => m.id)).size).toBe(OPENROUTER_MODELS.length)
    for (const m of [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS]) {
      expect(m.inPer1M).toBeGreaterThan(0)
      expect(m.outPer1M).toBeGreaterThan(0)
      expect(m.note.length).toBeGreaterThan(10)
    }
  })

  it('OpenRouter ids look like provider/model, Anthropic ids are bare model names', () => {
    for (const m of OPENROUTER_MODELS) expect(m.id).toMatch(/^[a-z0-9.-]+\/[\w.:-]+$/)
    for (const m of ANTHROPIC_MODELS) expect(m.id).toMatch(/^claude-[\w-]+$/)
  })

  it('the first entry is the default, and cheap: every listed model costs a fraction of a cent per phrase', () => {
    expect(OPENROUTER_DEFAULT_MODEL).toBe(OPENROUTER_MODELS[0]!.id)
    expect(ANTHROPIC_DEFAULT_MODEL).toBe(ANTHROPIC_MODELS[0]!.id)
    for (const m of OPENROUTER_MODELS) expect(costPer1000Phrases(m)).toBeLessThan(1) // under $1 per 1,000 phrases
  })

  it('the recommended default is among the cheapest: nothing in the top three costs more than 2.5x the cheapest', () => {
    const cheapest = Math.min(...OPENROUTER_MODELS.map(costPer1000Phrases))
    for (const m of OPENROUTER_MODELS.slice(0, 3)) expect(costPer1000Phrases(m)).toBeLessThanOrEqual(cheapest * 2.5)
  })
})

describe('labels', () => {
  it('shows rank and name, marks only the first as the recommended pick, and is short enough for a phone\'s closed select', () => {
    expect(modelLabel(OPENROUTER_MODELS[0]!, 1)).toBe('1. Claude Haiku 5.5 ★')
    expect(modelLabel(OPENROUTER_MODELS[3]!, 4)).toBe('4. GPT-4o mini')
    for (const [i, m] of OPENROUTER_MODELS.entries()) expect(modelLabel(m, i + 1).length).toBeLessThanOrEqual(30)
  })

  it('prices read as in / out per 1M tokens', () => {
    expect(priceText(OPENROUTER_MODELS[0]!)).toBe('$0.10 in / $0.50 out')
    expect(priceText(ANTHROPIC_MODELS[1]!)).toBe('$2 in / $10 out')
  })

  it('cost text is honest about being an estimate', () => {
    expect(costText(OPENROUTER_MODELS[0]!)).toMatch(/^about \$0\.0\d+ per 1,000 phrases/)
    expect(costText(ANTHROPIC_MODELS[1]!)).toMatch(/\$[\d.]+ per 1,000 phrases/)
  })

  it('findModel looks an id up and returns undefined for one that is not listed (a custom value)', () => {
    expect(findModel(OPENROUTER_MODELS, 'openai/gpt-4o-mini')?.name).toBe('GPT-4o mini')
    expect(findModel(OPENROUTER_MODELS, 'someone/else')).toBeUndefined()
  })
})

describe('activeModel', () => {
  it('is the chosen model, the default when none is chosen, and nothing for Google', () => {
    expect(activeModel('openrouter', { openrouterModel: 'openai/gpt-4o-mini' })).toBe('openai/gpt-4o-mini')
    expect(activeModel('openrouter', {})).toBe(OPENROUTER_DEFAULT_MODEL)
    expect(activeModel('anthropic', { anthropicModel: '' })).toBe(ANTHROPIC_DEFAULT_MODEL)
    expect(activeModel('google', { openrouterModel: 'x/y' })).toBeUndefined()
  })

  it('the model older versions used by default is still one of the listed options', () => {
    expect(findModel(OPENROUTER_MODELS, LEGACY_OPENROUTER_DEFAULT_MODEL)).toBeDefined()
  })
})
