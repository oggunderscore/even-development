/** Kana or kanji present → the text is Japanese. */
export const hasJapanese = (text: string): boolean => /[぀-ヿ㐀-鿿]/.test(text)

/** The G2 font silently drops unknown glyphs, so macrons would vanish mid-word. */
export function stripMacrons(s: string): string {
  const map: Record<string, string> = {
    ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou',
    Ā: 'Aa', Ī: 'Ii', Ū: 'Uu', Ē: 'Ee', Ō: 'Ou',
  }
  return s.replace(/[āīūēōĀĪŪĒŌ]/g, (c) => map[c] ?? c).normalize('NFD').replace(/[̀-ͯ]/g, '')
}
