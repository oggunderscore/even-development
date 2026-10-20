// Translation + romanisation for one utterance (plain fetch, called straight from the WebView).
//
//   google      – Google Cloud Translation (no LLM). Romaji is generated locally (romaji.ts).
//   openrouter  – any model on OpenRouter, one key, pay per token.
//   anthropic   – Claude directly via the Anthropic API.

import type { Direction, Provider, Translation } from '../../src/protocol'
import { hasJapanese, stripMacrons } from './lang'
import { HonyakuError, httpError } from './errors'
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_MODELS, OPENROUTER_DEFAULT_MODEL, OPENROUTER_MODELS, findModel } from './models'
import { RomajiNotInstalledError, romanize } from './romaji'

export { OPENROUTER_DEFAULT_MODEL, stripMacrons }

/** Japanese script (kana / kanji) present → the other person spoke Japanese; otherwise English. */
export function detectDir(text: string): Direction {
  return hasJapanese(text) ? 'listen' : 'speak'
}

const ROMAJI_RULES = `Romaji rules: Hepburn, written the way it is pronounced with word-sized spacing (kore wa ikura desu ka); plain ASCII, NO macrons or diacritics (long vowels doubled: arigatou, ohayou, oneesan); particles は/へ/を are wa, e, o; minimal punctuation.`

const SHARED = `You are the translation engine inside smart glasses used by an English speaker in a live face-to-face conversation with a Japanese speaker. Translate meaning and tone, not word-for-word, and keep it short: it is shown on a tiny display. Use earlier turns only to resolve pronouns and context. Answer with exactly the labelled lines below and nothing else (no quotes, no code fences, no JSON).`

function systemFor(dir: Direction, withRomaji: boolean): string {
  if (dir === 'speak') {
    return `${SHARED}

The input is English spoken by the wearer.
JA: <natural, polite-but-casual Japanese>
ROMAJI: <romaji of exactly that Japanese>

${ROMAJI_RULES}`
  }
  return withRomaji
    ? `${SHARED}

The input is Japanese spoken by the other person (speech-to-text, so it may contain recognition errors; infer the likely intent).
EN: <natural English>
ROMAJI: <romaji of the Japanese input>

${ROMAJI_RULES}`
    : `${SHARED}

The input is Japanese spoken by the other person (speech-to-text, so it may contain recognition errors; infer the likely intent).
EN: <natural English>`
}

/** Everything translate() needs. Built per user from their own keys (see config.ts). */
export interface TranslateConfig {
  provider: Provider
  googleKey?: string
  openrouterKey?: string
  openrouterModel?: string
  anthropicKey?: string
  anthropicModel?: string
}

export interface TranslateOptions {
  /** Ask for (and wait for) the romaji of Japanese the other person said. Off in Predictive mode, which doesn't show it. */
  romaji?: boolean
}

export async function translate(
  dir: Direction,
  text: string,
  history: Translation[] = [],
  id = 0,
  cfg: TranslateConfig,
  opts: TranslateOptions = {},
): Promise<Translation> {
  const withRomaji = opts.romaji ?? true
  if (cfg.provider === 'google') return translateWithGoogle(dir, text, id, cfg, withRomaji)

  const context = history
    .slice(-3)
    .map((h) => `- ${h.dir === 'speak' ? 'wearer' : 'other person'}: ${h.dir === 'speak' ? h.english : h.japanese}`)
    .join('\n')
  const userContent = `${context ? `Recent turns:\n${context}\n\n` : ''}${text}`

  const fields = parseLabeled(await complete(systemFor(dir, withRomaji), userContent, cfg, { maxTokens: dir === 'speak' || withRomaji ? 220 : 130 }))
  const romaji = stripMacrons(fields['romaji'] ?? '').trim()
  if (dir === 'speak') {
    if (!fields['ja']) throw new HonyakuError('FORM', 'no JA line')
    return { id, dir, english: text, japanese: fields['ja'], romaji }
  }
  if (!fields['en']) throw new HonyakuError('FORM', 'no EN line')
  return { id, dir, japanese: text, english: fields['en'], romaji: withRomaji ? romaji : '' }
}

/** "JA: ...\nROMAJI: ..." → { ja, romaji }. Tolerates quotes, fences, bullets and (as a fallback) a JSON object. */
export function parseLabeled(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?\**\s*(ja|en|romaji)\s*\**\s*[:：]\s*\**\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.replace(/^[\s"'`“”「]+|[\s"'`“”」,]+$/g, '').replace(/\s+/g, ' ')
    if (value && !(key in out)) out[key] = value
  }
  if (Object.keys(out).length) return out
  // A model that ignored the format and answered in JSON anyway.
  try {
    const o = parseJson(raw)
    for (const k of ['ja', 'en', 'romaji']) if (typeof o[k] === 'string' && o[k]) out[k] = (o[k] as string).trim()
  } catch {
    /* fall through */
  }
  if (!Object.keys(out).length) throw new HonyakuError('FORM', 'no labelled lines')
  return out
}

// ── Google Cloud Translation (Basic / v2) ────────────────────────────────────

async function googleTranslate(key: string | undefined, text: string, source: 'en' | 'ja', target: 'en' | 'ja'): Promise<string> {
  if (!key) throw new HonyakuError('AUTH', 'google key missing')

  // The key goes in a header, not the URL, so it can't end up in a logged or quoted address.
  const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ q: text, source, target, format: 'text' }),
  })
  if (!res.ok) throw httpError('google', res.status, await res.text().catch(() => ''))
  const data = (await res.json().catch(() => ({}))) as { data?: { translations?: { translatedText?: string }[] } }
  const out = data.data?.translations?.[0]?.translatedText
  if (out === undefined) throw new HonyakuError('EMPTY', 'google no translation')
  return out
}

async function translateWithGoogle(dir: Direction, text: string, id: number, cfg: TranslateConfig, withRomaji: boolean): Promise<Translation> {
  if (dir === 'speak') {
    const japanese = await googleTranslate(cfg.googleKey, text, 'en', 'ja')
    return { id, dir, english: text, japanese, romaji: await romanize(japanese) }
  }
  // The other person's speech: the English is what matters. If the romaji dictionary isn't on this phone yet, show the
  // English anyway (with no romaji) rather than losing the translation; the engine tells the app to fetch the dictionary.
  const [english, romaji] = await Promise.all([
    googleTranslate(cfg.googleKey, text, 'ja', 'en'),
    withRomaji ? romanize(text).catch((err: unknown) => (err instanceof RomajiNotInstalledError ? '' : Promise.reject(err))) : '',
  ])
  return { id, dir, japanese: text, english, romaji }
}

// ── LLM providers: OpenRouter (OpenAI-compatible chat completions) and Anthropic ──

/** A reply that takes longer than this is no use in a live conversation; the user sees "too slow" and carries on. */
const LLM_TIMEOUT_MS = 20_000

export interface CompleteOptions {
  signal?: AbortSignal
  maxTokens?: number
  /** Streams the answer: called with everything received so far each time more arrives. */
  onText?: (soFar: string) => void
}

/** One LLM call on whichever LLM provider the user chose (OpenRouter or Claude). Returns the full text. */
export async function complete(system: string, userContent: string, cfg: TranslateConfig, opts: CompleteOptions = {}): Promise<string> {
  if (cfg.provider === 'google') throw new HonyakuError('UNK', 'google cannot generate text')
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), LLM_TIMEOUT_MS)
  const onCallerAbort = () => timeout.abort()
  opts.signal?.addEventListener('abort', onCallerAbort)
  try {
    const run = { ...opts, signal: timeout.signal }
    return await (cfg.provider === 'anthropic' ? completeAnthropic(system, userContent, cfg, run) : completeOpenRouter(system, userContent, cfg, run))
  } catch (err) {
    // Our own timeout looks like any other abort; tell it apart from the caller cancelling.
    if (timeout.signal.aborted && !opts.signal?.aborted) throw new HonyakuError('TIME', 'timeout')
    throw err
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/** Feed each `data:` payload of a server-sent-event stream to `onData`. */
async function readEvents(res: Response, onData: (data: string) => void): Promise<void> {
  const feed = (line: string) => {
    if (line.startsWith('data:')) onData(line.slice(5).trim())
  }
  if (!res.body) {
    for (const line of (await res.text()).split(/\r?\n/)) feed(line)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      feed(buf.slice(0, nl).trimEnd())
      buf = buf.slice(nl + 1)
    }
  }
  feed(buf.trim())
}

const parse = (data: string): Record<string, any> | null => {
  try {
    return JSON.parse(data) as Record<string, any>
  } catch {
    return null
  }
}

async function completeOpenRouter(system: string, userContent: string, cfg: TranslateConfig, opts: CompleteOptions): Promise<string> {
  const key = cfg.openrouterKey
  if (!key) throw new HonyakuError('AUTH', 'openrouter key missing')

  const model = cfg.openrouterModel || OPENROUTER_DEFAULT_MODEL
  const known = findModel(OPENROUTER_MODELS, model)
  const maxTokens = opts.maxTokens ?? 200
  // `tuned`: the speed options. Without them a model may think before answering (seconds) and that thinking counts
  // against max_tokens, so the plain fallback allows more room.
  const send = (tuned: boolean) =>
    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Honyaku', // shows up in OpenRouter's usage dashboard
      },
      body: JSON.stringify({
        model,
        max_tokens: tuned ? maxTokens : maxTokens * 4,
        stream: !!opts.onText,
        ...(tuned
          ? {
              ...(known?.noTemperature ? {} : { temperature: 0 }),
              // Answer from whichever provider of this model responds fastest, instead of the cheapest or the most loaded.
              provider: { sort: 'latency' },
              ...(known?.thinkOff ? { reasoning: known.thinkOff === 'enabled' ? { enabled: false } : { effort: 'none' } } : {}),
            }
          : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    })

  let res = await send(true)
  // If one of the options was the problem, the plain request still works.
  if (res.status === 400 || res.status === 422) res = await send(false)
  if (!res.ok) throw httpError('openrouter', res.status, await res.text().catch(() => ''))

  if (opts.onText) {
    let text = ''
    await readEvents(res, (data) => {
      if (data === '[DONE]') return
      const chunk = parse(data)
      if (!chunk) return
      // OpenRouter reports an upstream failure inside the stream.
      if (chunk['error']) throw new HonyakuError('SVC', `openrouter stream ${typeof chunk['error']?.code === 'number' ? chunk['error'].code : 'error'}`)
      const piece = chunk['choices']?.[0]?.delta?.content
      if (typeof piece === 'string' && piece) {
        text += piece
        opts.onText!(text)
      }
    })
    if (!text) throw new HonyakuError('EMPTY', 'openrouter empty stream')
    return text
  }

  // OpenRouter can answer 200 with an `error` body when an upstream provider fails.
  const data = (await res.json().catch(() => null)) as { error?: { code?: unknown }; choices?: { message?: { content?: string } }[] } | null
  if (data?.error) throw new HonyakuError('SVC', `openrouter body error${typeof data.error.code === 'number' ? ` ${data.error.code}` : ''}`)
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new HonyakuError('EMPTY', 'openrouter no content')
  return content
}

async function completeAnthropic(system: string, userContent: string, cfg: TranslateConfig, opts: CompleteOptions): Promise<string> {
  const key = cfg.anthropicKey
  if (!key) throw new HonyakuError('AUTH', 'anthropic key missing')

  const model = cfg.anthropicModel || ANTHROPIC_DEFAULT_MODEL
  const known = findModel(ANTHROPIC_MODELS, model)
  const maxTokens = opts.maxTokens ?? 200
  const send = (tuned: boolean) =>
    fetch('https://api.anthropic.com/v1/messages', {
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
        model,
        // Haiku 5.5 and Sonnet 5.5 think by default and the thinking counts against max_tokens, so the plain fallback has room.
        max_tokens: tuned ? maxTokens : maxTokens * 4,
        stream: !!opts.onText,
        system,
        messages: [{ role: 'user', content: userContent }],
        // No `temperature`: these models answer 400 to any value but the default.
        ...(tuned && known?.thinkOff
          ? {
              // Haiku accepts `disabled`; Sonnet 5.5 rejects it and takes `between_tools` instead. Effort low trims the rest.
              thinking: { type: model === 'claude-haiku-5-5' ? 'disabled' : 'between_tools' },
              output_config: { effort: 'low' },
            }
          : {}),
      }),
    })

  let res = await send(true)
  if (res.status === 400 || res.status === 422) res = await send(false)
  if (!res.ok) throw httpError('anthropic', res.status, await res.text().catch(() => ''))

  if (opts.onText) {
    let text = ''
    let declined = false
    await readEvents(res, (data) => {
      const ev = parse(data)
      if (!ev) return
      if (ev['type'] === 'error') throw new HonyakuError('SVC', `anthropic stream ${typeof ev['error']?.type === 'string' && /^[a-z_]{1,40}$/.test(ev['error'].type) ? ev['error'].type : 'error'}`)
      if (ev['type'] === 'content_block_delta' && typeof ev['delta']?.text === 'string') {
        text += ev['delta'].text
        opts.onText!(text)
      }
      if (ev['type'] === 'message_delta' && ev['delta']?.stop_reason === 'refusal') declined = true
    })
    if (declined) throw new HonyakuError('DECL', 'anthropic refusal')
    if (!text) throw new HonyakuError('EMPTY', 'anthropic empty stream')
    return text
  }

  const data = (await res.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; text?: string }[] } | null
  if (data?.stop_reason === 'refusal') throw new HonyakuError('DECL', 'anthropic refusal')
  const text = (data?.content ?? []).flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
  if (!text) throw new HonyakuError('EMPTY', 'anthropic no content')
  return text
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Last-resort reader for a model that answered in JSON instead of the labelled lines. */
export function parseJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new HonyakuError('FORM', 'no json')
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new HonyakuError('FORM', 'bad json')
  }
}
