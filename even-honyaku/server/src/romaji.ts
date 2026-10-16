// Local Japanese → Hepburn romaji (no network, no per-use cost). Google Translate only returns
// translated text, so the romaji the wearer reads aloud is produced here with the kuromoji
// dictionary tokenizer + wanakana. Output is plain ASCII with long vowels doubled ("arigatou").

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import kuromoji from 'kuromoji'
import { toRomaji } from 'wanakana'
import { stripMacrons } from './translate'

type Tokenizer = kuromoji.Tokenizer<kuromoji.IpadicFeatures>

let tokenizer: Promise<Tokenizer> | undefined

/** Loads the ~17 MB dictionary once; call at startup so the first phrase isn't slow. */
export function loadRomajiDictionary(): Promise<Tokenizer> {
  tokenizer ??= new Promise((resolve, reject) => {
    const dicPath = join(dirname(createRequire(import.meta.url).resolve('kuromoji/package.json')), 'dict')
    kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t)))
  })
  return tokenizer
}

const PUNCT: Record<string, string> = {
  '。': '.', '、': ',', '？': '?', '！': '!', '「': '"', '」': '"', '『': '"', '』': '"',
  '（': '(', '）': ')', '・': ' ', '〜': '~', '…': '...', '：': ':', '；': ';',
}

/** Copulas stay separate words even after a verb/adjective: "ikitai desu", not "ikitaidesu". */
const COPULA = new Set(['です', 'だ'])

/** Katakana → romaji, expanding the long-vowel mark by doubling the previous vowel. */
function kanaToRomaji(kana: string): string {
  const base = toRomaji(kana)
  return base.replace(/([aiueo])ー/g, '$1$1').replace(/ー/g, '-')
}

export async function romanize(japanese: string): Promise<string> {
  const t = await loadRomajiDictionary()
  const tokens = t.tokenize(japanese)

  let out = ''
  let prev: kuromoji.IpadicFeatures | undefined
  for (const tok of tokens) {
    const surface = tok.surface_form
    let piece: string
    if (PUNCT[surface] !== undefined) piece = PUNCT[surface]!
    else if (tok.pos === '助詞' && surface === 'は') piece = 'wa' // topic particle
    else if (tok.pos === '助詞' && surface === 'へ') piece = 'e'
    else if (tok.pos === '助詞' && surface === 'を') piece = 'o'
    else if (tok.reading && tok.reading !== '*') piece = kanaToRomaji(tok.reading)
    else piece = kanaToRomaji(surface) // ASCII, digits, unknown words pass through

    const isPunct = tok.pos === '記号'
    // Conjugation endings glue to the verb/adjective they belong to: tabe+mashita, takaku+nai.
    // After a noun, です stays separate ("ikura desu").
    const glue =
      prev !== undefined &&
      !isPunct &&
      ((tok.pos === '助動詞' && !COPULA.has(tok.basic_form) && ['動詞', '形容詞', '助動詞'].includes(prev.pos)) ||
        (tok.pos === '助詞' && tok.pos_detail_1 === '接続助詞' && prev.pos === '動詞') ||
        tok.pos_detail_1 === '接尾')
    const noSpaceBefore = isPunct && /^[.,?!:;)"~]/.test(piece)
    out += out === '' || glue || noSpaceBefore || out.endsWith('(') ? piece : ` ${piece}`
    prev = tok
  }
  return stripMacrons(out).replace(/\s+/g, ' ').trim()
}
