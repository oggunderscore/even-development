// Messages between the app and the translation engine (src/core/engine.ts), which runs inside the WebView.
// Audio is passed separately as 16 kHz mono s16le PCM. `config` (the user's own API keys) comes first.
//
// The mic streams continuously. `start auto` = always-on listening for English AND Japanese (language is
// detected per utterance); `start talk` = the wearer is holding the button: English only → romaji.
//
// Predictive Conversation Mode adds two things on top: a *voice filter* (is this the wearer or the other person?
// → the wearer's own Japanese is never translated or answered) and a *reply predictor* (after the other person
// finishes a turn, a few short romaji replies the wearer can read aloud).

/** speak  = user talks English → Japanese romaji shown on glasses (to read aloud).
 *  listen = other person talks Japanese → English shown on glasses. */
export type Direction = 'speak' | 'listen'

export type StreamMode = 'auto' | 'talk'

export type Provider = 'google' | 'openrouter' | 'anthropic'
export interface ApiKeys {
  deepgram?: string
  google?: string
  openrouter?: string
  anthropic?: string
}

export type AppMode = 'standard' | 'predictive'
export type ReplyStyle = 'polite' | 'casual'
export type JpLevel = 'beginner' | 'intermediate' | 'advanced'

export interface PredictConfig {
  enabled: boolean
  style: ReplyStyle
  level: JpLevel
  /** How many alternatives to offer for a decision question (a plain statement always gets one reply). */
  maxOptions: 2 | 3
}

/** One acoustic sample of the wearer's voice (see core/voice.ts). */
export interface VoiceSample {
  vec: number[]
  levelDb: number
}
export interface VoiceSet {
  /** Recorded on purpose during enrollment. */
  seed: VoiceSample[]
  /** Learned later from moments we are certain it was the wearer (hold-to-talk, echo-confirmed replies). */
  adapt: VoiceSample[]
}
/** The wearer's voiceprint — local only, never sent anywhere. */
export interface VoiceProfile {
  v: 1
  updated: number
  en: VoiceSet
  ja: VoiceSet
}

export interface VoiceConfig {
  /** Keep the wearer's own speech out of the conversation. */
  filter: boolean
  /** 0..1 — how readily a segment is called "the wearer". */
  strictness: number
  profile?: VoiceProfile | null
}

export interface UserConfig {
  keys?: ApiKeys
  provider?: Provider
  openrouterModel?: string
  predict?: PredictConfig
  voice?: VoiceConfig
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
  /** The wearer picked a suggested reply on the glasses, so it counts as said (for the conversation history). */
  | { type: 'chose'; option: ReplyOption }

export interface Translation {
  id: number
  dir: Direction
  /** Plain-text Japanese (kana/kanji). Rendered on the glasses only when the user turns that on. */
  japanese: string
  /** Hepburn romaji of `japanese`, no macrons (long vowels doubled: "arigatou"). */
  romaji: string
  english: string
  /** Voice filter couldn't tell who spoke: shown, but no reply is predicted for it. */
  unsure?: boolean
  /** The other person said this in English (voice filter only), so there is nothing to translate. */
  heardEnglish?: boolean
}

/** One suggested thing for the wearer to say. */
export interface ReplyOption {
  /** What it means, in a few English words ("Yes, please"). */
  gloss: string
  ja: string
  /** Plain-ASCII Hepburn romaji, read aloud. */
  romaji: string
}

export interface Prediction {
  /** `single`: one natural reply. `choice`: a decision question, several answers that differ in meaning. */
  kind: 'single' | 'choice'
  options: ReplyOption[]
}

export type Speaker = 'wearer' | 'other' | 'unsure'

export type ServerMsg =
  | { type: 'ready' }
  /** Reply to `config`: what the engine can do with the keys it was given. */
  | { type: 'config_ok'; stt: boolean; translate: boolean; provider: Provider; predict: boolean }
  | { type: 'test_result'; results: TestResult[] }
  | { type: 'partial'; dir: Direction; text: string }
  | ({ type: 'final' } & Translation)
  /** Suggested replies for the other person's last turn (`turnId` = the id of the `final` they answer). */
  | { type: 'predictions'; turnId: number; prediction: Prediction }
  /** The wearer's own speech was recognised and kept out of the conversation. `option` = which suggestion they read, from the suggestions for `turnId`. */
  | { type: 'self'; text: string; option?: ReplyOption; optionIndex?: number; turnId?: number }
  /** Voice-filter verdict for one utterance (feeds the tuning panel; nothing is stored). */
  | { type: 'voice_score'; who: Speaker; text: string; echo: number; voice: number | null; level: number | null }
  /** The voiceprint learned something new and should be saved. */
  | { type: 'voice_profile'; profile: VoiceProfile }
  | { type: 'done' }
  /** `no_keys`: a key needed for this action is missing — send the user to Settings.
   *  `no_llm`: Predictive mode needs an OpenRouter or Claude key (Google Translate can't suggest replies). */
  | { type: 'error'; message: string; code?: 'no_keys' | 'no_llm' }
