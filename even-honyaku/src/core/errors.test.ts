import { describe, expect, it } from 'vitest'
import { HonyakuError, describeError, httpError, upstreamTag } from './errors'

describe('httpError', () => {
  it('maps status to a cause and keeps only the provider status and its short error token', () => {
    expect(httpError('openrouter', 401)).toMatchObject({ kind: 'AUTH', message: 'openrouter 401' })
    expect(httpError('openrouter', 402)).toMatchObject({ kind: 'RATE' })
    expect(httpError('anthropic', 429, '{"type":"error","error":{"type":"rate_limit_error","message":"free text"}}')).toMatchObject({ kind: 'RATE', message: 'anthropic 429 rate_limit_error' })
    expect(httpError('openrouter', 404)).toMatchObject({ kind: 'MODEL' })
    expect(httpError('openrouter', 504)).toMatchObject({ kind: 'TIME' })
    expect(httpError('anthropic', 529)).toMatchObject({ kind: 'SVC' })
    expect(httpError('google', 400)).toMatchObject({ kind: 'UNK' })
  })
})

describe('upstreamTag', () => {
  it('takes a short token or number, never free text', () => {
    expect(upstreamTag('{"error":{"code":"insufficient_quota","message":"sk-secret ran out"}}')).toBe('insufficient_quota')
    expect(upstreamTag('{"error":{"code":429}}')).toBe('429')
    expect(upstreamTag('{"error":{"type":"has spaces and text"}}')).toBe('')
    expect(upstreamTag('<html>gateway</html>')).toBe('')
  })
})

describe('describeError', () => {
  it('a coded generic sentence for the user, the cause only in the detail', () => {
    const e = describeError('replies', new HonyakuError('FORM', 'no reply lines'), 'anthropic/claude-haiku-5.5')
    expect(e.ref).toBe('R-FORM')
    expect(e.message).toBe('Replies: something went wrong (R-FORM)')
    expect(e.detail).toBe('no reply lines model=anthropic/claude-haiku-5.5')
  })

  it('a SyntaxError from JSON.parse is reduced to its type: the message quotes the text', () => {
    let caught: unknown
    try {
      JSON.parse('{"gloss": "secret transcript" "ja"}')
    } catch (err) {
      caught = err
    }
    const e = describeError('replies', caught)
    expect(e.message).not.toMatch(/Expected|position|JSON/)
    expect(e.detail).toBe('SyntaxError')
    expect(e.ref).toBe('R-UNK')
  })

  it('a failed fetch is a connection problem; the browser message is dropped', () => {
    const e = describeError('translate', new TypeError('Failed to fetch https://x?key=abc'))
    expect(e).toMatchObject({ ref: 'T-NET', detail: 'fetch failed' })
    expect(e.message).not.toContain('abc')
  })

  it('actionable causes tell the user where to go, with the code', () => {
    expect(describeError('check', new HonyakuError('AUTH')).message).toBe('Key check: key rejected, check Settings (K-AUTH)')
    expect(describeError('speech', new HonyakuError('NET')).message).toBe('Speech: no connection (S-NET)')
  })
})
