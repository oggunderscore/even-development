// Translation + romanisation for one utterance.
//
// TRANSLATE_PROVIDER=google      – Google Cloud Translation (no LLM). Romaji is generated locally (romaji.ts).
//                                  Default whenever GOOGLE_TRANSLATE_API_KEY is set.
// TRANSLATE_PROVIDER=openrouter  – any model on OpenRouter, one key, pay per token. Default otherwise.
// TRANSLATE_PROVIDER=anthropic   – Claude directly via the Anthropic API.

import Anthropic from '@anthropic-ai/sdk'
import type { Direction, Translation } from '../../src/protocol'
import { hasJapanese } from './lang'
import { romanize } from './romaji'

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

export function translateProvider(): string {
  return process.env['TRANSLATE_PROVIDER'] || (process.env['GOOGLE_TRANSLATE_API_KEY'] ? 'google' : 'openrouter')
}

export async function translate(
  dir: Direction,
  text: string,
  history: Translation[] = [],
  id = 0,
): Promise<Translation> {
  if (translateProvider() === 'google') return translateWithGoogle(dir, text, id)

  const context = history
    .slice(-3)
    .map((h) => `- ${h.dir === 'speak' ? 'wearer' : 'other person'}: ${h.dir === 'speak' ? h.english : h.japanese}`)
    .join('\n')
  const userContent = `${context ? `Recent turns:\n${context}\n\n` : ''}Mode "${dir}":\n${text}`

  const provider = translateProvider()
  const raw = provider === 'anthropic' ? await completeAnthropic(userContent) : await completeOpenRouter(userContent)
  const parsed = parseJson(raw)

  const romaji = stripMacrons(String(parsed['romaji'] ?? '')).trim()
  return dir === 'speak'
    ? { id, dir, english: text, japanese: String(parsed['ja'] ?? ''), romaji }
    : { id, dir, japanese: text, english: String(parsed['en'] ?? ''), romaji }
}

// ── Google Cloud Translation (Basic / v2) ────────────────────────────────────

async function googleTranslate(text: string, source: 'en' | 'ja', target: 'en' | 'ja'): Promise<string> {
  const key = process.env['GOOGLE_TRANSLATE_API_KEY']
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY is not set')

  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source, target, format: 'text' }),
  })
  if (!res.ok) throw new Error(`google translate ${res.status}: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`)
  const data = (await res.json()) as { data?: { translations?: { translatedText?: string }[] } }
  const out = data.data?.translations?.[0]?.translatedText
  if (out === undefined) throw new Error('google translate returned no translation')
  return out
}

async function translateWithGoogle(dir: Direction, text: string, id: number): Promise<Translation> {
  if (dir === 'speak') {
    const japanese = await googleTranslate(text, 'en', 'ja')
    return { id, dir, english: text, japanese, romaji: await romanize(japanese) }
  }
  const [english, romaji] = await Promise.all([googleTranslate(text, 'ja', 'en'), romanize(text)])
  return { id, dir, japanese: text, english, romaji }
}

// ── OpenRouter (OpenAI-compatible chat completions) ──────────────────────────

export const OPENROUTER_DEFAULT_MODEL = 'google/gemini-2.5-flash-lite'

async function completeOpenRouter(userContent: string): Promise<string> {
  const key = process.env['OPENROUTER_API_KEY']
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Honyaku', // shows up in OpenRouter's usage dashboard
    },
    body: JSON.stringify({
      model: process.env['OPENROUTER_MODEL'] || OPENROUTER_DEFAULT_MODEL,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
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

let anthropic: Anthropic | undefined

async function completeAnthropic(userContent: string): Promise<string> {
  anthropic ??= new Anthropic()
  const response = await anthropic.messages.create({
    model: process.env['ANTHROPIC_MODEL'] || 'claude-haiku-5-5',
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  })
  if (response.stop_reason === 'refusal') throw new Error('translation declined by the model')
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`model returned no JSON: ${raw.slice(0, 80)}`)
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
}

/** The G2 font silently drops unknown glyphs, so macrons would vanish mid-word. */
export function stripMacrons(s: string): string {
  const map: Record<string, string> = {
    ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou',
    Ā: 'Aa', Ī: 'Ii', Ū: 'Uu', Ē: 'Ee', Ō: 'Ou',
  }
  return s.replace(/[āīūēōĀĪŪĒŌ]/g, (c) => map[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '')
}
