// Reply prediction for Predictive Conversation Mode: after the other person finishes a turn, ask the LLM what the
// wearer could say next — one natural reply for a statement, a few genuinely different answers for a decision
// question — each as short, plain-ASCII romaji the wearer can read aloud straight off the glasses.

import type { JpLevel, Prediction, PredictConfig, ReplyOption, ReplyStyle, Translation } from '../protocol'
import { stripMacrons } from './lang'
import { toHiragana } from 'wanakana'
import { HonyakuError } from './errors'
import { type TranslateConfig, complete } from './translate'

export const MAX_GLOSS = 28
/** Longer than this can't be shown on one glasses row, and a clipped romaji line would be read wrong. */
export const MAX_ROMAJI = 44

const STYLE: Record<ReplyStyle, string> = {
  polite: 'Polite desu/masu form, friendly but not stiff. No heavy keigo.',
  casual: 'Casual, friendly spoken Japanese (tameguchi) that is still not rude to a stranger.',
}
const LEVEL: Record<JpLevel, string> = {
  beginner:
    'The wearer is a beginner: use the simplest, most common words and very short sentences that are easy to pronounce (hai, iie, daijoubu desu, onegaishimasu, arigatou gozaimasu...).',
  intermediate: 'The wearer is intermediate: simple everyday Japanese, one short sentence.',
  advanced: 'The wearer is advanced: natural everyday Japanese, one short sentence.',
}

export function buildSystem(cfg: PredictConfig): string {
  return `You help an English speaker, wearing smart glasses, talk face to face with a Japanese speaker. You get what the other person just said (speech-to-text, so it may contain recognition errors; infer the likely intent) and the recent turns. Suggest what the wearer could say next, in Japanese, so they can read it aloud at once.

Answer in plain lines, never JSON, nothing else:
Line 1: single  or  choice
Then one line per reply:  <English meaning> | <romaji>

- single: a statement, greeting, thanks, apology or anything else that needs one natural reply. Exactly 1 reply line.
- choice: the speaker asked something the wearer must decide (yes/no, either/or, how many, what would you like, ...). 2 to ${cfg.maxOptions} reply lines that genuinely differ in meaning, the most likely answer first. For open questions offer typical answers. Never invent personal facts (names, ages, addresses, room numbers, allergies).
- English meaning: a few plain words (max ${MAX_GLOSS} characters), e.g. Yes, please
- romaji: the Japanese reply in Hepburn romaji, as pronounced with word-sized spacing (kore wa ikura desu ka), plain ASCII, NO macrons (long vowels doubled: arigatou, ohayou), particles は/へ/を as wa/e/o, minimal punctuation, at most ${MAX_ROMAJI} characters. ${STYLE[cfg.style]} ${LEVEL[cfg.level]}

Every reply must be short and simple. Use earlier turns only for context.`
}

/** Short acknowledgements ("はい", "ええ", "なるほど") don't need an answer. */
const BACKCHANNEL = /^(?:(?:はい|ええ|うん|ふん|そうですか|そうですね|そう|あー?|ああ|えー?と?|うーん|なるほど|へえ|ふーん|ほう|あっ?|ん)[。、！!？?…ー~\s]*)+$/

export function isBackchannel(text: string): boolean {
  return BACKCHANNEL.test(text.trim())
}

function context(history: Translation[]): string {
  return history
    .slice(-4)
    .map((h) =>
      h.dir === 'speak'
        ? `- wearer said: ${h.english}`
        : `- other person said: ${h.japanese || h.english}${h.japanese && h.english ? ` (${h.english})` : ''}`,
    )
    .join('\n')
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

const asciiRomaji = (s: string): string =>
  stripMacrons(clean(s))
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Read the model's reply lines ("single" / "choice", then "meaning | romaji" per option) into something safe for the
 * glasses. While the answer is still streaming (`final` false) the last line may be unfinished, so it is left out and
 * nothing usable yet gives `null`; once it is final, nothing usable throws. Anything that is not a reply line is ignored.
 */
export function parseReplies(raw: string, maxOptions: number, final = true): Prediction | null {
  const lines = raw.split(/\r?\n/)
  if (!final) lines.pop()
  let kind: 'single' | 'choice' | null = null
  const seen = new Set<string>()
  const options: ReplyOption[] = []
  for (const line of lines) {
    const text = line.trim()
    const k = /^[`*\s]*(single|choice)\b[`*:.\s]*$/i.exec(text)
    if (k) {
      kind ??= k[1]!.toLowerCase() as 'single' | 'choice'
      continue
    }
    const parts = text.replace(/^(?:[-*•]|\d+[.)])\s*/, '').split(/\s*[|｜\t]\s*/)
    if (parts.length < 2) continue
    let gloss = clean(parts[0])
    const romaji = asciiRomaji(parts[1]!)
    if (!romaji || romaji.length > MAX_ROMAJI + 12) continue
    if (gloss.length > MAX_GLOSS) gloss = `${gloss.slice(0, MAX_GLOSS - 1).trimEnd()}.`
    const key = romaji.toLowerCase().replace(/[^a-z]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    // The Japanese script is derived here instead of asked for: it halves what the model has to write.
    options.push({ gloss: gloss || romaji, ja: toHiragana(romaji), romaji })
  }
  if (!options.length) {
    if (final) throw new HonyakuError('FORM', 'no reply lines')
    return null
  }
  if (final) return kind === 'choice' && options.length > 1 ? { kind: 'choice', options: options.slice(0, maxOptions) } : { kind: 'single', options: options.slice(0, 1) }
  // Mid-stream: believe the model's first line, so a decision shows as a list from its first option on.
  return kind === 'single' || (kind === null && options.length === 1)
    ? { kind: 'single', options: options.slice(0, 1) }
    : { kind: 'choice', options: options.slice(0, maxOptions) }
}

/**
 * Ask for replies to what the other person said. With `onPartial` the answer is streamed and each option is passed on
 * the moment its line is complete, so the first reply can be on the glasses while the model is still writing the rest.
 */
export async function predictReplies(
  heard: string,
  history: Translation[],
  translate: TranslateConfig,
  cfg: PredictConfig,
  signal?: AbortSignal,
  onPartial?: (p: Prediction) => void,
): Promise<Prediction> {
  const ctx = context(history)
  const user = `${ctx ? `Recent turns:\n${ctx}\n\n` : ''}The other person just said:\n${heard}`
  let shown = ''
  const raw = await complete(buildSystem(cfg), user, translate, {
    signal,
    maxTokens: 70 + 50 * cfg.maxOptions,
    onText: onPartial
      ? (soFar) => {
          const p = parseReplies(soFar, cfg.maxOptions, false)
          const sig = p ? `${p.kind}:${p.options.map((o) => o.romaji).join('|')}` : ''
          if (p && sig !== shown) {
            shown = sig
            onPartial(p)
          }
        }
      : undefined,
  })
  return parseReplies(raw, cfg.maxOptions, true)!
}
