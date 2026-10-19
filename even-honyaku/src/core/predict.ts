// Reply prediction for Predictive Conversation Mode: after the other person finishes a turn, ask the LLM what the
// wearer could say next — one natural reply for a statement, a few genuinely different answers for a decision
// question — each as short, plain-ASCII romaji the wearer can read aloud straight off the glasses.

import type { JpLevel, Prediction, PredictConfig, ReplyOption, ReplyStyle, Translation } from '../protocol'
import { stripMacrons } from './lang'
import { type TranslateConfig, completeJson, parseJson } from './translate'

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
  return `You are the reply assistant inside smart glasses worn by an English speaker who is talking face to face with a Japanese speaker. You are given what the other person just said (normally Japanese; speech-to-text, so it may contain recognition errors; infer the likely intent) and the recent turns. Suggest what the wearer could say next, in Japanese, so they can read it aloud immediately.

Output ONLY one JSON object, no prose, no code fences:
{"kind":"single"|"choice","options":[{"gloss":"...","ja":"...","romaji":"..."}]}

- "single": a statement, greeting, thanks, apology or anything else that needs one natural reply. Exactly 1 option.
- "choice": the speaker asked something the wearer must decide (yes/no, either/or, how many, what would you like, ...). Give 2 to ${cfg.maxOptions} options that genuinely differ in meaning, the most likely answer first. For open questions offer typical answers. Never invent personal facts (names, ages, addresses, room numbers, allergies).
- gloss: what the wearer would be saying, as a few plain English words (max ${MAX_GLOSS} characters), e.g. "Yes, please" or "No, thank you".
- ja: the Japanese reply. ${STYLE[cfg.style]} ${LEVEL[cfg.level]}
- romaji: Hepburn romaji of exactly that ja, written the way it is pronounced with word-sized spacing (kore wa ikura desu ka), plain ASCII, NO macrons or diacritics (long vowels doubled: arigatou, ohayou), particles は/へ/を as wa/e/o, minimal punctuation, at most ${MAX_ROMAJI} characters. Shorter is better.

Every reply must be short and simple. Use earlier turns only to understand context.`
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

/** Validate the model's answer into something safe to put on the glasses. Throws if nothing usable is left. */
export function parsePrediction(raw: string, maxOptions: number): Prediction {
  const o = parseJson(raw)
  const list = Array.isArray(o['options']) ? (o['options'] as Record<string, unknown>[]) : []
  const seen = new Set<string>()
  const options: ReplyOption[] = []
  for (const item of list) {
    const ja = clean(item?.['ja'])
    const romaji = stripMacrons(clean(item?.['romaji']))
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    let gloss = clean(item?.['gloss'])
    if (!ja || !romaji || romaji.length > MAX_ROMAJI + 12) continue
    if (gloss.length > MAX_GLOSS) gloss = `${gloss.slice(0, MAX_GLOSS - 1).trimEnd()}.`
    const key = romaji.toLowerCase().replace(/[^a-z]/g, '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    options.push({ gloss: gloss || romaji, ja, romaji })
  }
  if (!options.length) throw new Error('the model suggested no usable replies')
  const choice = o['kind'] === 'choice' && options.length > 1
  return choice ? { kind: 'choice', options: options.slice(0, maxOptions) } : { kind: 'single', options: options.slice(0, 1) }
}

export async function predictReplies(
  heard: string,
  history: Translation[],
  translate: TranslateConfig,
  cfg: PredictConfig,
  signal?: AbortSignal,
): Promise<Prediction> {
  const ctx = context(history)
  const user = `${ctx ? `Recent turns:\n${ctx}\n\n` : ''}The other person just said:\n${heard}`
  const raw = await completeJson(buildSystem(cfg), user, translate, { signal, maxTokens: 500 })
  return parsePrediction(raw, cfg.maxOptions)
}
