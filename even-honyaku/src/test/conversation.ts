// A realistic English-speaker / Japanese-speaker conversation for end-to-end tests, and a fake network that answers it the
// way real models do: every reply formatted in a different, slightly messy way (fenced, bulleted, chatty, CRLF, macrons,
// JSON...), delivered as a byte stream cut at awkward places. Used by conversation.test.ts (mocked) and live.test.ts
// (the same lines against real models with the developer's own keys).

export interface Exchange {
  scene: string
  /** What the Japanese speaker says, as the speech recogniser delivers it (more than one string = several finals in one turn). */
  other: string[]
  english: string
  romaji: string
  /** Suggested replies as the model should give them: [meaning, romaji]. null = a backchannel, no reply wanted. */
  replies: { kind: 'single' | 'choice'; options: [string, string][] } | null
  /** How the wearer answers. `read`: reads suggestion N aloud (Japanese). `free`: says it in English. Omitted: waits. */
  wearer?: { read: number } | { free: string; ja: string; romaji: string }
}

export const CONVERSATION: Exchange[] = [
  { scene: 'greeting', other: ['こんにちは、いらっしゃいませ。'], english: 'Hello, welcome.', romaji: 'konnichiwa, irasshaimase.', replies: { kind: 'single', options: [['Hello', 'konnichiwa']] } },
  {
    scene: 'cafe order',
    other: ['ご注文はお決まりですか？'],
    english: 'Are you ready to order?',
    romaji: 'gochuumon wa okimari desu ka?',
    replies: { kind: 'choice', options: [['Coffee, please', 'koohii o onegaishimasu'], ['Tea, please', 'ocha o onegaishimasu'], ['One moment', 'sukoshi matte kudasai']] },
  },
  {
    scene: 'hot or iced',
    other: ['ホットとアイス、どちらになさいますか？'],
    english: 'Hot or iced?',
    romaji: 'hotto to aisu, dochira ni nasaimasu ka?',
    replies: { kind: 'choice', options: [['Hot, please', 'hotto de onegaishimasu'], ['Iced, please', 'aisu de onegaishimasu']] },
    wearer: { read: 1 },
  },
  {
    scene: 'here or to go (two phrases, one turn)',
    other: ['店内でお召し上がりですか？', 'お持ち帰りですか？'],
    english: 'Is it for here? Or to go?',
    romaji: 'tennai de omeshiagari desu ka? omochikaeri desu ka?',
    replies: { kind: 'choice', options: [['For here', 'koko de tabemasu'], ['To go', 'mochikaeri de onegaishimasu']] },
  },
  { scene: 'backchannel', other: ['はい。'], english: 'Yes.', romaji: 'hai.', replies: null },
  {
    scene: 'payment, answered in English',
    other: ['六百五十円です。現金ですか、カードですか？'],
    english: 'That is 650 yen. Cash or card?',
    romaji: 'roppyaku gojuu en desu. genkin desu ka, kaado desu ka?',
    replies: { kind: 'choice', options: [['Cash', 'genkin de onegaishimasu'], ['Card', 'kaado de onegaishimasu']] },
    wearer: { free: "I'll pay by card.", ja: 'カードでお願いします。', romaji: 'kaado de onegaishimasu.' },
  },
  {
    scene: 'thanks',
    other: ['ありがとうございました。またお越しください。'],
    english: 'Thank you very much. Please come again.',
    romaji: 'arigatou gozaimashita. mata okoshi kudasai.',
    replies: { kind: 'single', options: [['Thank you', 'arigatou gozaimashita']] },
  },
  {
    scene: 'asking the way, in English',
    other: ['駅ですか？この道をまっすぐ行って、二つ目の信号を右に曲がってください。'],
    english: 'The station? Go straight down this road and turn right at the second light.',
    romaji: 'eki desu ka? kono michi o massugu itte, futatsume no shingou o migi ni magatte kudasai.',
    replies: { kind: 'single', options: [['Got it, thank you', 'wakarimashita, arigatou gozaimasu']] },
    wearer: { free: 'Excuse me, where is the station?', ja: 'すみません、駅はどこですか？', romaji: 'sumimasen, eki wa doko desu ka?' },
  },
  {
    scene: 'how far',
    other: ['歩いて十分ぐらいですよ。'],
    english: "It's about ten minutes on foot.",
    romaji: 'aruite juppun gurai desu yo.',
    replies: { kind: 'single', options: [['Thanks, that is close', 'arigatou gozaimasu, chikai desu ne']] },
  },
  {
    scene: 'small talk 1',
    other: ['日本は初めてですか？'],
    english: 'Is this your first time in Japan?',
    romaji: 'nihon wa hajimete desu ka?',
    replies: { kind: 'choice', options: [['Yes, first time', 'hai, hajimete desu'], ["No, I've been before", 'iie, nando ka kimashita']] },
  },
  {
    scene: 'small talk 2',
    other: ['どちらから来られたんですか？'],
    english: 'Where did you come from?',
    romaji: 'dochira kara korareta n desu ka?',
    replies: { kind: 'choice', options: [['From America', 'amerika kara kimashita'], ['From Australia', 'oosutoraria kara kimashita'], ['From England', 'igirisu kara kimashita']] },
  },
  {
    scene: 'allergies',
    other: ['アレルギーはありますか？'],
    english: 'Do you have any allergies?',
    romaji: 'arerugii wa arimasu ka?',
    replies: { kind: 'choice', options: [['No allergies', 'arerugii wa arimasen'], ['Yes, I do', 'hai, arimasu']] },
  },
  {
    scene: 'seating (three phrases, one turn)',
    other: ['お席にご案内しますね。', 'こちらへどうぞ。', '足元にお気をつけください。'],
    english: 'Let me show you to your seat. This way, please. Watch your step.',
    romaji: 'oseki ni goannai shimasu ne. kochira e douzo. ashimoto ni oki o tsukete kudasai.',
    replies: { kind: 'single', options: [['Thank you', 'arigatou gozaimasu']] },
  },
  {
    scene: 'free English at the end',
    other: ['ごゆっくりどうぞ。'],
    english: 'Please take your time.',
    romaji: 'goyukkuri douzo.',
    replies: { kind: 'single', options: [['Thank you', 'arigatou gozaimasu']] },
    wearer: { free: 'This is delicious.', ja: 'おいしいです。', romaji: 'oishii desu.' },
  },
]

// ── how real models format an answer ─────────────────────────────────────────

const macron = (s: string) => s.replace(/oo/g, 'ō').replace(/uu/g, 'ū')

/** A translation answer for `kind` ('EN' for the other person, 'JA' for the wearer), in one of several shapes models produce. */
export function translationText(style: number, kind: 'EN' | 'JA', text: string, romaji: string, withRomaji = true): string {
  const k = kind
  const r = withRomaji
  switch (style % 7) {
    case 0:
      return `${k}: ${text}${r ? `\nROMAJI: ${romaji}` : ''}`
    case 1:
      return `\`\`\`\n${k}: ${text}${r ? `\nROMAJI: ${romaji}` : ''}\n\`\`\``
    case 2:
      return `**${k}:** "${text}"${r ? `\n**ROMAJI:** ${romaji}` : ''}`
    case 3:
      return `Sure! Here is the translation:\n${k}: ${text}${r ? `\nROMAJI: ${romaji}` : ''}\n\nLet me know if you need anything else.`
    case 4:
      return `${k.toLowerCase()}: ${text}${r ? `\r\nromaji: ${romaji}` : ''}\r\n`
    case 5:
      return JSON.stringify({ [k.toLowerCase()]: text, ...(r ? { romaji } : {}) })
    default:
      return `${k}: ${text}${r ? `\nROMAJI: ${macron(romaji)}` : ''}`
  }
}

/** A reply-suggestion answer in one of several shapes. */
export function repliesText(style: number, replies: NonNullable<Exchange['replies']>): string {
  const { kind, options } = replies
  const lines = options.map(([g, r]) => [g, r] as const)
  switch (style % 8) {
    case 0:
      return `${kind}\n${lines.map(([g, r]) => `${g} | ${r}`).join('\n')}`
    case 1:
      return `\`\`\`\n${kind}\n${lines.map(([g, r]) => `${g} | ${r}`).join('\n')}\n\`\`\``
    case 2:
      return `${kind}\n${lines.map(([g, r], i) => (kind === 'choice' ? `${i + 1}. ${g} | ${r}` : `- ${g} | ${r}`)).join('\n')}`
    case 3:
      return `**${kind}**\n${lines.map(([g, r]) => `${g} ｜ ${r}`).join('\n')}`
    case 4:
      return `Here are some replies:\n${kind}\n${lines.map(([g, r]) => `${g} | ${r}`).join('\n')}\n\nThese keep it polite and short.`
    case 5:
      return `${kind.toUpperCase()}\r\n${lines.map(([g, r]) => `${g.toLowerCase()} | ${r}`).join('\r\n')}\r\n`
    case 6:
      return `${kind}\n${lines.map(([g, r]) => `${g}  |  ${r}.  | ${r}`).join('\n')}`
    default:
      return `${kind}\n${lines.map(([g, r]) => `${g} | ${macron(r)}`).join('\n')}`
  }
}

// ── the fake network ─────────────────────────────────────────────────────────

/** `hang`: no answer at all (until aborted). `stall`: the stream starts, then goes quiet without ending. */
export type Flaw = 'rate_limit' | 'garbage' | 'html_502' | 'cut_stream' | 'hang' | 'stall'

export interface FakeNetworkOptions {
  provider: 'openrouter' | 'anthropic'
  /** Per call number (counting reply calls and translation calls separately): break this call. */
  flaws?: { replies?: Record<number, Flaw>; translate?: Record<number, Flaw> }
  /** Bytes per network chunk; small and odd so lines, JSON events and UTF-8 characters are cut in the middle. */
  chunk?: number
}

export interface FakeNetwork {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** What the model was asked, for assertions. */
  calls: { kind: 'replies' | 'translate'; body: Record<string, any>; style: number }[]
}

const enc = new TextEncoder()

const aborted = () => new DOMException('The operation was aborted.', 'AbortError')

function streamOf(text: string, chunk: number, signal: AbortSignal | null | undefined, cutAfter?: number, stallAfter?: number): Response {
  const bytes = enc.encode(text)
  let at = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // A real fetch ends its body stream when the request is aborted.
      signal?.addEventListener('abort', () => controller.error(aborted()))
    },
    pull(controller) {
      if (cutAfter !== undefined && at >= cutAfter) return controller.error(new TypeError('network connection lost'))
      if (stallAfter !== undefined && at >= stallAfter) return new Promise<void>(() => {}) // silence: never another byte
      if (at >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(at, at + chunk))
      at += chunk
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** Server-sent events carrying `content` the way each provider sends it (several characters per event). */
function sse(provider: 'openrouter' | 'anthropic', content: string): string {
  const pieces = content.match(/[\s\S]{1,6}/g) ?? []
  if (provider === 'openrouter') {
    const events = [': OPENROUTER PROCESSING\n\n', `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n`]
    for (const p of pieces) events.push(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`)
    events.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 90 } })}\n\n`, 'data: [DONE]\n\n')
    return events.join('')
  }
  const events = [`event: message_start\r\ndata: ${JSON.stringify({ type: 'message_start' })}\r\n\r\n`, `event: content_block_start\r\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\r\n\r\n`, `event: ping\r\ndata: {"type": "ping"}\r\n\r\n`]
  for (const p of pieces) events.push(`event: content_block_delta\r\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })}\r\n\r\n`)
  events.push(`event: message_delta\r\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\r\n\r\n`, `event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n`)
  return events.join('')
}

const plain = (provider: 'openrouter' | 'anthropic', content: string): Response =>
  new Response(JSON.stringify(provider === 'openrouter' ? { choices: [{ message: { content } }] } : { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }), { status: 200 })

export function fakeNetwork(script: Exchange[], opts: FakeNetworkOptions): FakeNetwork {
  const counts = { replies: 0, translate: 0 }
  const calls: FakeNetwork['calls'] = []
  const chunk = opts.chunk ?? 13

  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Record<string, any>
    const system: string = typeof body['system'] === 'string' ? body['system'] : (body['messages']?.[0]?.content ?? '')
    const user: string = opts.provider === 'anthropic' ? body['messages'][0].content : body['messages'][1].content
    const asksReplies = system.includes('Line 1: single')
    const kind = asksReplies ? 'replies' : 'translate'
    const n = counts[kind]++
    const style = n
    calls.push({ kind, body, style })

    const flaw = opts.flaws?.[kind]?.[n]
    if (flaw === 'rate_limit') return new Response('{"error":{"type":"rate_limit_error","message":"slow down, user said ホットですか"}}', { status: 429 })
    if (flaw === 'hang') {
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(aborted())))
    }
    if (flaw === 'html_502') return new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 })

    let text: string
    if (asksReplies) {
      const heard = user.split('The other person just said:\n')[1] ?? ''
      const ex = script.find((e) => e.other.join(' ') === heard)
      text = ex?.replies ? repliesText(style, ex.replies) : 'single\nOkay | wakarimashita'
    } else if (system.includes('JA:')) {
      const said = user.split('\n').at(-1) ?? ''
      const ex = script.find((e) => typeof e.wearer === 'object' && 'free' in e.wearer && e.wearer.free === said)
      const w = ex?.wearer as { ja: string; romaji: string } | undefined
      text = w ? translationText(style, 'JA', w.ja, w.romaji) : 'JA: はい\nROMAJI: hai'
    } else {
      const heard = user.split('\n').at(-1) ?? ''
      const ex = script.find((e) => e.other.includes(heard))
      // One phrase of a multi-phrase turn: the model translates just that phrase; the fixture keeps the whole turn's gloss.
      const phrase = ex ? splitGloss(ex, heard) : { english: 'Yes.', romaji: 'hai.' }
      text = translationText(style, 'EN', phrase.english, phrase.romaji, system.includes('ROMAJI:'))
    }
    if (flaw === 'garbage') text = "I'm sorry, but I can't help with that request. {\"oops\": \"x\" \"y\"}"

    if (!body['stream']) return plain(opts.provider, text)
    const wire = sse(opts.provider, text)
    return streamOf(wire, chunk, init.signal, flaw === 'cut_stream' ? Math.floor(wire.length * 0.55) : undefined, flaw === 'stall' ? Math.floor(wire.length * 0.55) : undefined)
  }
  return { fetch: fetchImpl, calls }
}

/** Per-phrase English and romaji of a multi-phrase turn (split on sentence ends, aligned in order). */
export function splitGloss(ex: Exchange, phrase: string): { english: string; romaji: string } {
  if (ex.other.length === 1) return { english: ex.english, romaji: ex.romaji }
  const split = (s: string) => s.match(/[^.?!。]+[.?!。]?/g)!.map((x) => x.trim()).filter(Boolean)
  const en = split(ex.english)
  const ro = split(ex.romaji)
  const i = ex.other.indexOf(phrase)
  return { english: en[i] ?? ex.english, romaji: ro[i] ?? ex.romaji }
}
