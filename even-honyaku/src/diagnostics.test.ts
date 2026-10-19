import { beforeEach, describe, expect, it } from 'vitest'
import { clearErrors, diagnosticsReport, errorCount, recordError } from './diagnostics'

const ctx = { version: '1.1.7', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', mode: 'predictive' }

describe('diagnostics', () => {
  beforeEach(clearErrors)

  it('says so when nothing went wrong', () => {
    expect(diagnosticsReport(ctx)).toBe('Honyaku v1.1.7 | openrouter anthropic/claude-haiku-5.5 | predictive\nNo errors recorded this session.')
  })

  it('lists codes with their detail and time, oldest first', () => {
    recordError('R-FORM', 'no reply lines', Date.parse('2026-10-19T12:00:00Z'))
    recordError('T-RATE', 'openrouter 429 rate_limit_exceeded', Date.parse('2026-10-19T12:01:00Z'))
    expect(diagnosticsReport(ctx).split('\n').slice(1)).toEqual([
      '2026-10-19T12:00:00.000Z R-FORM no reply lines',
      '2026-10-19T12:01:00.000Z T-RATE openrouter 429 rate_limit_exceeded',
    ])
  })

  it('keeps only the newest 30, in memory', () => {
    for (let i = 0; i < 40; i++) recordError('R-NET', `n${i}`)
    expect(errorCount()).toBe(30)
    expect(diagnosticsReport(ctx)).not.toContain('n9\n')
    expect(diagnosticsReport(ctx)).toContain('n39')
  })

  it('an error without a code is still recorded', () => {
    recordError(undefined, undefined)
    expect(diagnosticsReport(ctx)).toContain('UNCODED')
  })
})
