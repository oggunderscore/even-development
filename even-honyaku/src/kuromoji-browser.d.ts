// The browser build of kuromoji ships without its own typings; it has the same API as the main entry.
declare module 'kuromoji/build/kuromoji.js' {
  import kuromoji from 'kuromoji'
  export default kuromoji
}
