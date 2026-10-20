// The models Honyaku offers. Users get three simple choices per provider, not a comparison: the fastest, the best-sounding
// (quality) and the cheapest. Both jobs it gives a model are short and latency-sensitive: translating a phrase into
// English/romaji (or the reverse), and suggesting a few replies in Predictive mode.
//
// Only models that can be run WITHOUT a reasoning pass are considered: a model that must think first (Gemini 3.5 Flash
// Lite, GLM 5.3 Flash, Muse Spark, Gemini 3.7/3.8 Flash...) adds seconds that cannot be switched off. The picks that
// think by default are asked not to (`thinkOff`), which is where most of the response time goes.
//
// The picks are an editorial judgement from the OpenRouter catalog (list prices and reasoning support, 2026-10-19), NOT a
// benchmark we ran: OpenRouter publishes no latency figures and nobody has measured Japanese quality here. `npm run
// test:live` (see TESTING.md) runs a real conversation against the listed models with your own keys and writes the
// response times and outputs to a report, which is how to re-decide these picks. Prices are US$ per 1M tokens and drift;
// the key check after choosing a model proves it answers, so a retired model shows an error instead of failing mid-talk.

export type ModelPick = 'quality' | 'speed' | 'value'

export interface ModelChoice {
  id: string
  name: string
  /** What the dropdown shows: the pick, then the model. Short, because a phone's closed select can't wrap. */
  label: string
  /** US$ per 1M input tokens. */
  inPer1M: number
  /** US$ per 1M output tokens. */
  outPer1M: number
  /** Which of the three it is the pick for. */
  picks: ModelPick[]
  /** One short line shown under the dropdown. */
  note: string
  /** The model rejects or ignores `temperature` (the newest Claude and GPT models). Default: accepted. */
  noTemperature?: true
  /**
   * The model reasons by default but can be told not to, which is where the seconds go. `effort`: OpenRouter's
   * `reasoning: {effort: 'none'}`; `enabled`: `reasoning: {enabled: false}`; direct Claude has its own thinking switch.
   */
  thinkOff?: 'effort' | 'enabled'
}

/** OpenRouter models, in the order shown. The first entry is the default: a live conversation needs the fast one. */
export const OPENROUTER_MODELS: ModelChoice[] = [
  { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', label: 'Fastest: Gemini 3.1 Flash Lite', inPer1M: 0.25, outPer1M: 1.5, picks: ['speed'], thinkOff: 'effort', note: 'Built for low latency, with very good Japanese.' },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', label: 'Best quality: Claude Haiku 5.5', inPer1M: 0.1, outPer1M: 0.5, picks: ['quality'], noTemperature: true, thinkOff: 'effort', note: 'The most natural Japanese and the most dependable replies.' },
  { id: 'qwen/qwen3.7-flash', name: 'Qwen3.7 Flash', label: 'Lowest cost: Qwen3.7 Flash', inPer1M: 0.03, outPer1M: 0.13, picks: ['value'], thinkOff: 'enabled', note: 'The cheapest here by a wide margin, with solid multilingual skills.' },
]

/** Claude models for the direct Anthropic provider, in the order shown. The first entry is the default. */
export const ANTHROPIC_MODELS: ModelChoice[] = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', label: 'Fastest & cheapest: Haiku 5.5', inPer1M: 0.1, outPer1M: 0.5, picks: ['speed', 'value'], noTemperature: true, thinkOff: 'effort', note: 'Fast and very cheap, with excellent Japanese.' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', label: 'Best quality: Sonnet 5.5', inPer1M: 2, outPer1M: 10, picks: ['quality'], noTemperature: true, thinkOff: 'effort', note: 'The most polished wording, but about 20 times the cost and slower.' },
]

/** Models that have been withdrawn, and what replaces them. A saved choice is moved over when settings load. */
export const RETIRED_MODELS: Record<string, string> = {
  // Retired by OpenRouter on 2026-10-20.
  'google/gemini-2.5-flash-lite': 'google/gemini-3.1-flash-lite',
}

export const currentModelId = (id: string): string => RETIRED_MODELS[id] ?? id

export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODELS[0]!.id
/** What versions before the dropdown used when no model was chosen. People already set up keep it (see settings.ts). */
export const LEGACY_OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash-lite' // retired: see RETIRED_MODELS
export const ANTHROPIC_DEFAULT_MODEL = ANTHROPIC_MODELS[0]!.id

/**
 * Rough cost of 1,000 translated phrases: each is about 350 input tokens (the instructions plus a little context) and 100
 * output tokens. Predictive replies add a similar call per question, so roughly double it.
 */
export function costPer1000Phrases(m: ModelChoice): number {
  return (350 * m.inPer1M + 100 * m.outPer1M) / 1000
}

export function costText(m: ModelChoice): string {
  const c = costPer1000Phrases(m)
  return `about ${c < 0.01 ? 'under $0.01' : `$${c.toFixed(c < 0.1 ? 3 : 2)}`} per 1,000 phrases (roughly double with Predictive replies)`
}

/** The model the chosen provider will use, or undefined for Google (which has none). `''` means "the default". */
export function activeModel(provider: string, models: { openrouterModel?: string; anthropicModel?: string }): string | undefined {
  if (provider === 'openrouter') return models.openrouterModel || OPENROUTER_DEFAULT_MODEL
  if (provider === 'anthropic') return models.anthropicModel || ANTHROPIC_DEFAULT_MODEL
  return undefined
}

export const findModel = (list: ModelChoice[], id: string): ModelChoice | undefined => list.find((m) => m.id === id)
