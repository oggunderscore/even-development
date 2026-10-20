// The same everyday conversation, against REAL models with your own keys. Skipped unless a key is in the environment:
//
//   HONYAKU_LIVE_OPENROUTER_KEY=sk-or-... npm run test:live
//   HONYAKU_LIVE_ANTHROPIC_KEY=sk-ant-... npm run test:live
//   (both may be set; HONYAKU_LIVE_MODELS=id1,id2 limits which models run)
//
// It checks that every answer parses into clean text, and writes live-report.md (git-ignored) with each model's response
// times and the replies it gave, which is how to re-decide which model is fastest, best and cheapest. Costs a few cents.
// The report contains only the practice sentences below. Keys are read from the environment and never written anywhere.

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ANTHROPIC_MODELS, OPENROUTER_MODELS, costPer1000Phrases } from './core/models'
import { predictReplies } from './core/predict'
import { type TranslateConfig, translate } from './core/translate'
import type { Prediction, PredictConfig } from './protocol'
import { CONVERSATION } from './test/conversation'
import './test/romaji-node'

const orKey = process.env['HONYAKU_LIVE_OPENROUTER_KEY']
const antKey = process.env['HONYAKU_LIVE_ANTHROPIC_KEY']
const only = process.env['HONYAKU_LIVE_MODELS']?.split(',').map((s) => s.trim())

const PREDICT: PredictConfig = { enabled: true, style: 'polite', level: 'beginner', maxOptions: 3 }
const LEAK = /[{}[\]"|*`]|ROMAJI|\bJA:|\bEN:|JSON/

interface Row {
  scene: string
  translateMs?: number
  firstMs?: number
  totalMs?: number
  english?: string
  prediction?: Prediction
  problem?: string
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN)
const p90 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.9) - 1)]! : NaN)
const sec = (ms: number) => (Number.isNaN(ms) ? 'n/a' : `${(ms / 1000).toFixed(2)}s`)

async function runConversation(cfg: TranslateConfig): Promise<Row[]> {
  const rows: Row[] = []
  const history: Parameters<typeof translate>[2] = []
  for (const ex of CONVERSATION) {
    const row: Row = { scene: ex.scene }
    try {
      const heard = ex.other.join(' ')
      // The two calls run side by side in the app (translation for the feed, replies for the glasses), so time them that way.
      const t0 = Date.now()
      const replies = ex.replies
        ? (async () => {
            let first = 0
            const p = await predictReplies(heard, history, cfg, PREDICT, undefined, () => {
              first ||= Date.now() - t0
            })
            return { p, first, total: Date.now() - t0 }
          })()
        : Promise.resolve(null)
      const tr = (async () => {
        const out = await translate('listen', heard, history, 0, cfg, { romaji: false })
        return { out, ms: Date.now() - t0 }
      })()
      const [r, t] = await Promise.all([replies, tr])
      row.translateMs = t.ms
      row.english = t.out.english
      if (r) Object.assign(row, { firstMs: r.first, totalMs: r.total, prediction: r.p })
      history.push(t.out)
      if (ex.wearer && 'free' in ex.wearer) {
        const s = await translate('speak', ex.wearer.free, history, 0, cfg)
        history.push(s)
        if (!s.japanese || !s.romaji || LEAK.test(s.japanese + s.romaji) || !/^[\x20-\x7e]+$/.test(s.romaji)) row.problem = 'unusable translation of the wearer'
      }
      if (!t.out.english || LEAK.test(t.out.english)) row.problem = 'unusable translation'
      for (const o of r?.p.options ?? []) {
        if (LEAK.test(o.gloss + o.romaji) || !/^[\x20-\x7e]+$/.test(o.romaji) || o.romaji.length > 56) row.problem = 'unusable reply'
      }
      if (ex.replies?.kind === 'single' && r && r.p.options.length !== 1) row.problem = 'expected one reply'
    } catch (err) {
      // Coded, never provider text, so the report is safe to share.
      row.problem = err instanceof Error && 'kind' in err ? `${err.name} ${String((err as { kind: unknown }).kind)} ${err.message}` : 'unexpected error'
    }
    rows.push(row)
  }
  return rows
}

const targets: { label: string; cfg: TranslateConfig; price: string }[] = [
  ...(orKey
    ? OPENROUTER_MODELS.map((m) => ({ label: `OpenRouter ${m.id}`, cfg: { provider: 'openrouter', openrouterKey: orKey, openrouterModel: m.id } as TranslateConfig, price: `$${costPer1000Phrases(m).toFixed(3)}/1000 phrases` }))
    : []),
  ...(antKey
    ? ANTHROPIC_MODELS.map((m) => ({ label: `Claude (direct) ${m.id}`, cfg: { provider: 'anthropic', anthropicKey: antKey, anthropicModel: m.id } as TranslateConfig, price: `$${costPer1000Phrases(m).toFixed(3)}/1000 phrases` }))
    : []),
].filter((t) => !only || only.some((id) => t.label.endsWith(id)))

describe.skipIf(targets.length === 0)('live conversation with real models', () => {
  const report: string[] = ['# Honyaku live conversation report', '', `Run: ${new Date().toISOString()}`, '']
  const summary: string[] = ['| model | translate median | translate p90 | first reply median | all replies median | replies p90 | list price | problems |', '|---|---|---|---|---|---|---|---|']
  const details: string[] = []

  for (const target of targets) {
    it(`${target.label}: every answer is usable`, async () => {
      const rows = await runConversation(target.cfg)
      const problems = rows.filter((r) => r.problem)
      const num = (f: (r: Row) => number | undefined) => rows.map(f).filter((x): x is number => x !== undefined && x > 0)
      summary.push(
        `| ${target.label} | ${sec(median(num((r) => r.translateMs)))} | ${sec(p90(num((r) => r.translateMs)))} | ${sec(median(num((r) => r.firstMs)))} | ${sec(median(num((r) => r.totalMs)))} | ${sec(p90(num((r) => r.totalMs)))} | ${target.price} | ${problems.length} |`,
      )
      details.push(`## ${target.label}`, '')
      for (const r of rows) {
        details.push(`- **${r.scene}**: ${r.english ?? '(no translation)'} -> ${r.prediction ? r.prediction.options.map((o) => `${o.gloss} / ${o.romaji}`).join(' | ') : '(no reply asked)'}${r.problem ? `  **PROBLEM: ${r.problem}**` : ''}`)
      }
      details.push('')
      writeFileSync('live-report.md', [...report, ...summary, '', ...details].join('\n'))
      expect(problems.map((p) => `${p.scene}: ${p.problem}`)).toEqual([])
    }, 300_000)
  }
})
