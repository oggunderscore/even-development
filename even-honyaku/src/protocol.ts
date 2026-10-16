// Messages between the app and the translation engine (src/core/engine.ts), which runs inside the WebView.
// Audio is passed separately as 16 kHz mono s16le PCM. `config` (the user's own API keys) comes first.
//
// The mic streams continuously. `start auto` = always-on listening for English AND Japanese (language is
// detected per utterance); `start talk` = the wearer is holding the button: English only → romaji.

/** speak  = user talks English → Japanese romaji shown on glasses (to read aloud).
 *  listen = other person talks Japanese → English shown on glasses. */
export type Direction = 'speak' | 'listen'

export type StreamMode = 'auto' | 'talk'

export type Provider = 'google' | 'openrouter' | 'anthropic'
/** How always-on listening tells English from Japanese (see core/stt.ts). */
export type ListenEngine = 'dual' | 'ja' | 'multi'

export interface ApiKeys {
  deepgram?: string
  google?: string
  openrouter?: string
  anthropic?: string
}

export interface UserConfig {
  keys?: ApiKeys
  provider?: Provider
  openrouterModel?: string
  listenEngine?: ListenEngine
}

export interface TestResult {
  service: 'deepgram' | Provider | 'translate' | 'romaji'
  ok: boolean
  detail: string
}

export type ClientMsg =
  | { type: 'config'; config: UserConfig }
  /** Check the keys in the current config against their services and run a sample translation. */
  | { type: 'test' }
  | { type: 'start'; mode: StreamMode }
  /** Flush the current stream (finals are translated, then `done` is sent). */
  | { type: 'end' }
  /** Dev aid: skip STT and translate typed text; direction is detected from the script. */
  | { type: 'text'; text: string }

export interface Translation {
  id: number
  dir: Direction
  /** Plain-text Japanese (kana/kanji). Not rendered on glasses — the G2 font has no CJK glyphs. */
  japanese: string
  /** Hepburn romaji of `japanese`, no macrons (long vowels doubled: "arigatou"). */
  romaji: string
  english: string
}

export type ServerMsg =
  | { type: 'ready' }
  /** Reply to `config`: what the engine can do with the keys it was given. */
  | { type: 'config_ok'; stt: boolean; translate: boolean; provider: Provider }
  | { type: 'test_result'; results: TestResult[] }
  | { type: 'partial'; dir: Direction; text: string }
  | ({ type: 'final' } & Translation)
  | { type: 'done' }
  /** `no_keys`: a key needed for this action is missing — send the user to Settings. */
  | { type: 'error'; message: string; code?: 'no_keys' }
