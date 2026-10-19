// The models Honyaku offers, in order of recommendation. Both jobs it gives a model are short and latency-sensitive:
// translating a phrase into English/romaji (or the reverse), and suggesting a few replies in Predictive mode. So the list
// favours models that
//   - answer fast and don't "think" first (a reasoning pass adds seconds a live conversation can't afford),
//   - return clean JSON reliably (every OpenRouter model below supports JSON mode),
//   - write natural Japanese, with price as the tiebreaker: a phrase costs a fraction of a cent on all of them.
//
// The ranking is an editorial judgement (Japanese quality for the money), NOT a benchmark we ran. Prices are the OpenRouter
// catalog's list prices on 2026-10-19 in US$ per 1M tokens and will drift; the key check after choosing a model proves it
// answers, so a model that is retired or renamed shows an error instead of failing in the middle of a conversation.

export interface ModelChoice {
  id: string
  name: string
  /** US$ per 1M input tokens. */
  inPer1M: number
  /** US$ per 1M output tokens. */
  outPer1M: number
  /** One line: why it is where it is in the ranking. */
  note: string
}

/** OpenRouter model ids, best first. The first entry is the default. */
export const OPENROUTER_MODELS: ModelChoice[] = [
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', inPer1M: 0.1, outPer1M: 0.5, note: 'Best-sounding Japanese and the most reliable replies, at nearly the lowest price.' },
  { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', inPer1M: 0.1, outPer1M: 0.4, note: 'Fastest and cheapest all-rounder, with very good Japanese.' },
  { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen3 235B', inPer1M: 0.09, outPer1M: 0.55, note: 'Strong multilingual model, very low price; a little slower.' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', inPer1M: 0.15, outPer1M: 0.6, note: 'Dependable and consistent; solid, slightly plainer Japanese.' },
  { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', inPer1M: 0.25, outPer1M: 1.5, note: 'Newer Gemini: a step up in quality for a few times the cost.' },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', inPer1M: 0.28, outPer1M: 0.42, note: 'Good quality and cheap output, but response time varies.' },
  { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', inPer1M: 0.4, outPer1M: 1.6, note: 'Higher-quality GPT; costs more for a small gain.' },
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', inPer1M: 0.1, outPer1M: 0.32, note: 'Cheapest decent fallback; its Japanese is the weakest of these.' },
]

/** Claude model ids for the direct Anthropic provider, best first. The first entry is the default. */
export const ANTHROPIC_MODELS: ModelChoice[] = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', inPer1M: 0.1, outPer1M: 0.5, note: 'Fast and very cheap, with excellent Japanese. The right choice for almost everyone.' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', inPer1M: 2, outPer1M: 10, note: 'Most polished wording, at about 20 times the cost of Haiku.' },
]

export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODELS[0]!.id
/** What versions before the dropdown used when no model was chosen. People already set up keep it (see settings.ts). */
export const LEGACY_OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'
export const ANTHROPIC_DEFAULT_MODEL = ANTHROPIC_MODELS[0]!.id

const money = (n: number) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n % 1 ? 2 : 0)}`

/** What the dropdown shows. Short on purpose: a phone's closed select can't wrap, so prices live in the compare panel. */
export function modelLabel(m: ModelChoice, rank: number): string {
  return `${rank}. ${m.name}${rank === 1 ? ' ★' : ''}`
}

/** "$0.10 in / $0.50 out" per 1M tokens. */
export const priceText = (m: ModelChoice): string => `${money(m.inPer1M)} in / ${money(m.outPer1M)} out`

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
