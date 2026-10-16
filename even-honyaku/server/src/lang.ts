/** Kana or kanji present → the text is Japanese. */
export const hasJapanese = (text: string): boolean => /[぀-ヿ㐀-鿿]/.test(text)
