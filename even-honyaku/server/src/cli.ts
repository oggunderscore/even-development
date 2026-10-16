// Try the translation step without any audio:
//   npm run translate -- speak "How much is this?"
//   npm run translate -- listen "これはいくらですか？"
import type { Direction } from '../../src/protocol'
import { translate } from '../../src/core/translate'
import { envTranslateConfig } from './env'
import './log'
import './romaji-node'

const [dir, ...rest] = process.argv.slice(2)
if ((dir !== 'speak' && dir !== 'listen') || rest.length === 0) {
  console.error('usage: npm run translate -- <speak|listen> "<text>"')
  process.exit(1)
}
console.log(await translate(dir as Direction, rest.join(' '), [], 0, envTranslateConfig()))
