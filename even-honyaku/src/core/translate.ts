// Translation + romanisation for one utterance (plain fetch, called straight from the WebView).
//
//   google      – Google Cloud Translation (no LLM). Romaji is generated locally (romaji.ts).
//   openrouter  – any model on OpenRouter, one key, pay per token.
//   anthropic   – Claude directly via the Anthropic API.

import type { Direction, Provider, Translation } from '../../src/protocol'
import { hasJapanese, stripMacrons } from './lang'
import { ANTHROPIC_DEFAULT_MODEL, OPENROUTER_DEFAULT_MODEL } from './models'
import { romanize } from './romaji'

export { OPENROUTER_DEFAULT_MODEL, stripMacrons }

/** Japanese script (kana / kanji) present → the other person spoke Japanese; otherwise English. */
export function detectDir(text: string): Direction {
  return hasJapanese(text) ? 'listen' : 'speak'
}

const SYSTEM = `You are the translation engine inside smart glasses used by an English speaker talking with a Japanese speaker, in live conversation.

Output ONLY one JSON object, no prose, no code fences.

Mode "speak": the input is English spoken by the glasses' wearer. Return {"ja": "<natural, polite-but-casual Japanese>", "romaji": "<Hepburn romaji of exactly that Japanese>"}.
Mode "listen": the input is Japanese spoken by the other person (speech-to-text, so it may contain recognition errors; infer the likely intent). Return {"en": "<natural English>", "romaji": "<Hepburn romaji of the Japanese input>"}.

Romaji rules:
- The wearer will read it aloud, so write it the way it is pronounced, with word-sized spacing (kore wa ikura desu ka), not letter-by-letter.
- Plain ASCII only. NO macrons or diacritics: write long vowels doubled ("arigatou", "ohayou", "kyuu", "onee-san" → "oneesan"). Particles は/へ/を are "wa", "e", "o".
- Keep punctuation minimal (. , ? !).

Translate meaning and tone, not word-for-word. Keep it short; this is shown on a tiny display. Use earlier turns only to resolve pronouns and context.`

/** Everything translate() needs. Built per user from their own keys (see config.ts). */
export interface TranslateConfig {
  provider: Provider
  googleKey?: string
  openrouterKey?: string
  openrouterModel?: string
  anthropicKey?: string
  anthropicModel?: string
}

export async function translate(
  dir: Direction,
  text: string,
  history: Translation[] = [],
  id = 0,
  cfg: TranslateConfig,
): Promise<Translation> {
  if (cfg.provider === 'google') return translateWithGoogle(dir, text, id, cfg)

  const context = history
    .slice(-3)
    .map((h) => `- ${h.dir === 'speak' ? 'wearer' : 'other person'}: ${h.dir === 'speak' ? h.english : h.japanese}`)
    .join('\n')
  const userContent = `${context ? `Recent turns:\n${context}\n\n` : ''}Mode "${dir}":\n${text}`

  const parsed = parseJson(await completeJson(SYSTEM, userContent, cfg))

  const romaji = stripMacrons(String(parsed['romaji'] ?? '')).trim()
  return dir === 'speak'
    ? { id, dir, english: text, japanese: String(parsed['ja'] ?? ''), romaji }
    : { id, dir, japanese: text, english: String(parsed['en'] ?? ''), romaji }
}

// ── Google Cloud Translation (Basic / v2) ────────────────────────────────────

async function googleTranslate(key: string | undefined, text: string, source: 'en' | 'ja', target: 'en' | 'ja'): Promise<string> {
  if (!key) throw new Error('Google Translate key is not set')

  // The key goes in a header, not the URL, so it can't end up in a logged or quoted address.
  const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ q: text, source, target, format: 'text' }),
  })
  if (!res.ok) throw new Error(`google translate ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`)
  const data = (await res.json()) as { data?: { translations?: { translatedText?: string }[] } }
  const out = data.data?.translations?.[0]?.translatedText
  if (out === undefined) throw new Error('google translate returned no translation')
  return out
}

async function translateWithGoogle(dir: Direction, text: string, id: number, cfg: TranslateConfig): Promise<Translation> {
  if (dir === 'speak') {
    const japanese = await googleTranslate(cfg.googleKey, text, 'en', 'ja')
    return { id, dir, english: text, japanese, romaji: await romanize(japanese) }
  }
  const [english, romaji] = await Promise.all([googleTranslate(cfg.googleKey, text, 'ja', 'en'), romanize(text)])
  return { id, dir, japanese: text, english, romaji }
}

// ── OpenRouter (OpenAI-compatible chat completions) ──────────────────────────


/** One JSON-answering LLM call on whichever LLM provider the user chose (OpenRouter or Claude). */
export async function completeJson(system: string, userContent: string, cfg: TranslateConfig, opts: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<string> {
  if (cfg.provider === 'google') throw new Error('Google Translate cannot generate text; use an OpenRouter or Claude key')
  return cfg.provider === 'anthropic' ? completeAnthropic(system, userContent, cfg, opts) : completeOpenRouter(system, userContent, cfg, opts)
}

async function completeOpenRouter(system: string, userContent: string, cfg: TranslateConfig, opts: { signal?: AbortSignal; maxTokens?: number }): Promise<string> {
  const key = cfg.openrouterKey
  if (!key) throw new Error('OpenRouter key is not set')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Honyaku', // shows up in OpenRouter's usage dashboard
    },
    body: JSON.stringify({
      model: cfg.openrouterModel || OPENROUTER_DEFAULT_MODEL,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 160)}`)

  // OpenRouter can answer 200 with an `error` body when an upstream provider fails.
  const data = (await res.json()) as {
    error?: { message?: string }
    choices?: { message?: { content?: string } }[]
  }
  if (data.error) throw new Error(`openrouter: ${data.error.message ?? 'unknown error'}`)
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('openrouter returned no content')
  return content
}

// ── Anthropic (optional) ─────────────────────────────────────────────────────

async function completeAnthropic(system: string, userContent: string, cfg: TranslateConfig, opts: { signal?: AbortSignal; maxTokens?: number }): Promise<string> {
  const key = cfg.anthropicKey
  if (!key) throw new Error('Anthropic key is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      // Required for calls made straight from a browser/WebView; the key is the user's own.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.anthropicModel || ANTHROPIC_DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 160)}`)
  const data = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] }
  if (data.stop_reason === 'refusal') throw new Error('translation declined by the model')
  const text = (data.content ?? []).flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
  if (!text) throw new Error('anthropic returned no content')
  return text
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`model returned no JSON: ${raw.slice(0, 80)}`)
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
}
