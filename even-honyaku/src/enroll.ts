// Voice-profile enrollment: the wearer reads a few preset English and Japanese sentences with the glasses mic, and the
// voiceprint is built from how they actually sound — in both languages, since the Japanese they speak is the part
// that must never be mistaken for the other person's. Pure logic (no DOM, no bridge) so it is unit-tested.

import { type VoiceFeatures, voiceFeatures } from './core/dsp'
import { emptyProfile, profileQuality, profileReady, withSeed } from './core/voice'
import type { VoiceProfile } from './protocol'

export interface Prompt {
  lang: 'en' | 'ja'
  /** What to read: English, or Japanese in kana/kanji. */
  text: string
  /** Japanese only: how it is pronounced (the form the glasses show), and what it means. */
  romaji?: string
  meaning?: string
}

/**
 * Chosen to cover a spread of vowels and consonants, and to be things a traveller actually says. The Japanese ones are
 * meant to be read the way the wearer really speaks Japanese — accent and all — because that is what must be recognised.
 */
export const PROMPTS: Prompt[] = [
  { lang: 'en', text: 'Excuse me, could you tell me where the nearest station is?' },
  { lang: 'en', text: 'I would like a cup of coffee and a piece of cake, please.' },
  { lang: 'en', text: 'Thank you very much, that was delicious.' },
  { lang: 'en', text: 'How much does this cost, and do you take credit cards?' },
  { lang: 'ja', text: 'すみません、駅はどこですか。', romaji: 'sumimasen, eki wa doko desu ka.', meaning: 'Excuse me, where is the station?' },
  { lang: 'ja', text: 'これはいくらですか。', romaji: 'kore wa ikura desu ka.', meaning: 'How much is this?' },
  { lang: 'ja', text: 'お水をお願いします。', romaji: 'omizu o onegaishimasu.', meaning: 'Water, please.' },
  { lang: 'ja', text: 'ありがとうございます、とても美味しかったです。', romaji: 'arigatou gozaimasu, totemo oishikatta desu.', meaning: 'Thank you, it was very delicious.' },
]

/** An utterance must have this much clearly-voiced speech to count. */
const MIN_VOICED_SEC = 1.0
/** Quieter than this and the mic barely heard the wearer. */
const MIN_LEVEL_DB = -48

export type SubmitResult = { ok: true; features: VoiceFeatures } | { ok: false; reason: 'unclear' | 'quiet' }

export const REASON_TEXT: Record<'unclear' | 'quiet', string> = {
  unclear: 'Not enough clear speech. Read the whole sentence at a normal pace.',
  quiet: 'Too quiet. Speak at the volume you use in conversation.',
}

export class Enrollment {
  private profile: VoiceProfile = emptyProfile()
  private at = 0

  constructor(private readonly prompts: Prompt[] = PROMPTS) {}

  get index(): number {
    return this.at
  }
  get total(): number {
    return this.prompts.length
  }
  get current(): Prompt | null {
    return this.prompts[this.at] ?? null
  }
  get done(): boolean {
    return this.at >= this.prompts.length
  }

  /** One recorded utterance for the current prompt. Advances only if it was good enough. */
  submit(audio: Float32Array): SubmitResult {
    const prompt = this.current
    if (!prompt) return { ok: false, reason: 'unclear' }
    const f = voiceFeatures(audio)
    if (!f || f.voicedSec < MIN_VOICED_SEC) return { ok: false, reason: 'unclear' }
    if (f.levelDb < MIN_LEVEL_DB) return { ok: false, reason: 'quiet' }
    this.profile = withSeed(this.profile, prompt.lang, f)
    this.at++
    return { ok: true, features: f }
  }

  skip() {
    if (!this.done) this.at++
  }

  /** The profile so far, and whether it is usable yet. */
  result(): { profile: VoiceProfile; ready: boolean; quality: ReturnType<typeof profileQuality> } {
    return { profile: this.profile, ready: profileReady(this.profile), quality: profileQuality(this.profile) }
  }
}
