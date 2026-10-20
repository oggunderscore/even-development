import { describe, expect, it } from 'vitest'
import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  LEGACY_OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_MODELS,
  RETIRED_MODELS,
  activeModel,
  costPer1000Phrases,
  costText,
  currentModelId,
  findModel,
} from './models'

describe('model lists: three simple picks', () => {
  it('OpenRouter offers exactly three models with unique ids, one for speed, one for quality, one for cost', () => {
    expect(OPENROUTER_MODELS).toHaveLength(3)
    expect(new Set(OPENROUTER_MODELS.map((m) => m.id)).size).toBe(3)
    expect(OPENROUTER_MODELS.flatMap((m) => m.picks).sort()).toEqual(['quality', 'speed', 'value'])
  })

  it('the direct Claude provider covers all three picks with its two models', () => {
    expect(ANTHROPIC_MODELS.flatMap((m) => m.picks).sort()).toEqual(['quality', 'speed', 'value'])
  })

  it('OpenRouter ids look like provider/model, Anthropic ids are bare model names', () => {
    for (const m of OPENROUTER_MODELS) expect(m.id).toMatch(/^[a-z0-9.-]+\/[\w.:-]+$/)
    for (const m of ANTHROPIC_MODELS) expect(m.id).toMatch(/^claude-[\w-]+$/)
  })

  it('the first entry is the default, and on OpenRouter it is the fast one (a live conversation cannot wait)', () => {
    expect(OPENROUTER_DEFAULT_MODEL).toBe(OPENROUTER_MODELS[0]!.id)
    expect(OPENROUTER_DEFAULT_MODEL).toBe('google/gemini-3.1-flash-lite')
    expect(OPENROUTER_MODELS[0]!.picks).toEqual(['speed'])
    expect(ANTHROPIC_DEFAULT_MODEL).toBe(ANTHROPIC_MODELS[0]!.id)
  })

  it('the cost pick really is the cheapest, and every OpenRouter model costs a fraction of a dollar per 1,000 phrases', () => {
    const cheapest = [...OPENROUTER_MODELS].sort((a, b) => costPer1000Phrases(a) - costPer1000Phrases(b))[0]!
    expect(cheapest.picks).toContain('value')
    for (const m of OPENROUTER_MODELS) expect(costPer1000Phrases(m)).toBeLessThan(1)
  })

  it('labels say which pick it is, and fit a phone\'s closed select', () => {
    expect(OPENROUTER_MODELS.map((m) => m.label)).toEqual(['Fastest: Gemini 3.1 Flash Lite', 'Best quality: Claude Haiku 5.5', 'Lowest cost: Qwen3.7 Flash'])
    for (const m of [...OPENROUTER_MODELS, ...ANTHROPIC_MODELS]) {
      expect(m.label.length).toBeLessThanOrEqual(31)
      expect(m.note.length).toBeGreaterThan(10)
    }
  })

  it('the newest Claude models are never sent sampling parameters they reject', () => {
    expect(findModel(OPENROUTER_MODELS, 'anthropic/claude-haiku-5.5')?.noTemperature).toBe(true)
    for (const m of ANTHROPIC_MODELS) expect(m.noTemperature).toBe(true)
  })

  it('cost text is honest about being an estimate', () => {
    expect(costText(OPENROUTER_MODELS[1]!)).toMatch(/^about \$0\.0\d+ per 1,000 phrases/)
    expect(costText(OPENROUTER_MODELS[2]!)).toMatch(/^about \$0\.0\d+ per 1,000 phrases/)
  })
})

describe('retired models', () => {
  it('a retired model is not listed and a saved choice of it moves to its listed replacement', () => {
    expect(findModel(OPENROUTER_MODELS, LEGACY_OPENROUTER_DEFAULT_MODEL)).toBeUndefined()
    expect(currentModelId(LEGACY_OPENROUTER_DEFAULT_MODEL)).toBe('google/gemini-3.1-flash-lite')
    for (const replacement of Object.values(RETIRED_MODELS)) expect(findModel(OPENROUTER_MODELS, replacement)).toBeDefined()
    expect(currentModelId('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini')
  })
})

describe('activeModel', () => {
  it('is the chosen model, the default when none is chosen, and nothing for Google', () => {
    expect(activeModel('openrouter', { openrouterModel: 'openai/gpt-4o-mini' })).toBe('openai/gpt-4o-mini')
    expect(activeModel('openrouter', {})).toBe(OPENROUTER_DEFAULT_MODEL)
    expect(activeModel('anthropic', { anthropicModel: '' })).toBe(ANTHROPIC_DEFAULT_MODEL)
    expect(activeModel('google', { openrouterModel: 'x/y' })).toBeUndefined()
  })
})
