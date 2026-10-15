// Claude-backed translation + romanisation for one utterance.

import Anthropic from '@anthropic-ai/sdk'
import type { Direction, Translation } from '../../src/protocol'

const client = new Anthropic()
const MODEL = process.env['TRANSLATE_MODEL'] ?? 'claude-opus-5-5'

const SYSTEM = `You are the translation engine inside smart glasses used by an English speaker talking with a Japanese speaker, in live conversation.

Output ONLY one JSON object, no prose, no code fences.

Mode "speak": the input is English spoken by the glasses' wearer. Return {"ja": "<natural, polite-but-casual Japanese>", "romaji": "<Hepburn romaji of exactly that Japanese>"}.
Mode "listen": the input is Japanese spoken by the other person (speech-to-text, so it may contain recognition errors; infer the likely intent). Return {"en": "<natural English>", "romaji": "<Hepburn romaji of the Japanese input>"}.

Romaji rules:
- The wearer will read it aloud, so write it the way it is pronounced, with word-sized spacing (kore wa ikura desu ka), not letter-by-letter.
- Plain ASCII only. NO macrons or diacritics: write long vowels doubled ("arigatou", "ohayou", "kyuu", "onee-san" → "oneesan"). Particles は/へ/を are "wa", "e", "o".
- Keep punctuation minimal (. , ? !).

Translate meaning and tone, not word-for-word. Keep it short; this is shown on a tiny display. Use earlier turns only to resolve pronouns and context.`

export async function translate(
  dir: Direction,
  text: string,
  history: Translation[] = [],
  id = 0,
): Promise<Translation> {
  const context = history
    .slice(-3)
    .map((h) => `- ${h.dir === 'speak' ? 'wearer' : 'other person'}: ${h.dir === 'speak' ? h.english : h.japanese}`)
    .join('\n')

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${context ? `Recent turns:\n${context}\n\n` : ''}Mode "${dir}":\n${text}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') throw new Error('translation declined by the model')

  const raw = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  const parsed = parseJson(raw)

  const romaji = stripMacrons(String(parsed['romaji'] ?? '')).trim()
  return dir === 'speak'
    ? { id, dir, english: text, japanese: String(parsed['ja'] ?? ''), romaji }
    : { id, dir, japanese: text, english: String(parsed['en'] ?? ''), romaji }
}

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
