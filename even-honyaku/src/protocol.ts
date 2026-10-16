// Wire protocol between the G2 app (WebView) and the Honyaku proxy server.
// Audio travels as binary WebSocket frames (16 kHz, mono, s16le PCM); everything else is JSON.
//
// The mic streams continuously. `start auto` = always-on listening for English AND Japanese (language is
// detected per utterance); `start talk` = the wearer is holding the button: English only → romaji.

/** speak  = user talks English → Japanese romaji shown on glasses (to read aloud).
 *  listen = other person talks Japanese → English shown on glasses. */
export type Direction = 'speak' | 'listen'

export type StreamMode = 'auto' | 'talk'

export type ClientMsg =
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
  | { type: 'partial'; dir: Direction; text: string }
  | ({ type: 'final' } & Translation)
  | { type: 'done' }
  | { type: 'error'; message: string }
