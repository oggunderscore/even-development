import { describe, expect, it } from 'vitest'
import { type Settings, defaultSettings } from './settings'
import { planChange } from './settings-change'

const base = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), deepgramKey: 'dg-key-12345', provider: 'openrouter', openrouterKey: 'or-key-12345', ...over })

describe('planChange', () => {
  it('nothing changed: nothing to do', () => {
    expect(planChange(base(), base()).changed).toBe(false)
  })

  it('a new Deepgram key restarts the stream and checks only Deepgram', () => {
    const p = planChange(base(), base({ deepgramKey: 'dg-new-key-9999' }))
    expect(p).toMatchObject({ changed: true, restartStream: true, test: ['stt'], clear: [] })
  })

  it('a new provider key checks only the translation side, and leaves the stream alone', () => {
    const p = planChange(base(), base({ openrouterKey: 'or-new-key-9999' }))
    expect(p).toMatchObject({ restartStream: false, test: ['translate'] })
  })

  it('changing the model re-checks that the model answers; changing a model of a provider not in use does not', () => {
    expect(planChange(base(), base({ openrouterModel: 'openai/gpt-4o-mini' })).test).toEqual(['translate'])
    expect(planChange(base(), base({ anthropicModel: 'claude-sonnet-5-5' })).test).toEqual([])
    expect(planChange(base({ provider: 'anthropic', anthropicKey: 'sk-ant-12345678' }), base({ provider: 'anthropic', anthropicKey: 'sk-ant-12345678', anthropicModel: 'claude-sonnet-5-5' })).test).toEqual(['translate'])
  })

  it('picking a provider that already has a key checks it; picking one with no key yet clears the status and is not undone', () => {
    const withBoth = base({ anthropicKey: 'sk-ant-12345678' })
    expect(planChange(withBoth, { ...withBoth, provider: 'anthropic' }).test).toEqual(['translate'])
    const p = planChange(base(), base({ provider: 'anthropic' }))
    expect(p.next.provider).toBe('anthropic') // still the user's pick, although it has no key
    expect(p).toMatchObject({ test: [], clear: ['translate'], switchedProvider: false })
  })

  it('removing a key clears its status instead of testing it', () => {
    expect(planChange(base(), base({ deepgramKey: '' }))).toMatchObject({ test: [], clear: ['stt'], restartStream: true })
    expect(planChange(base(), base({ openrouterKey: '' })).clear).toEqual(['translate'])
  })

  it('pasting a key for a provider that is not selected switches to it (first-run convenience) and checks it', () => {
    const start = base({ provider: 'google', openrouterKey: '', googleKey: '' })
    const p = planChange(start, { ...start, openrouterKey: 'or-pasted-key-1' })
    expect(p.next.provider).toBe('openrouter')
    expect(p).toMatchObject({ switchedProvider: true, test: ['translate'] })
  })

  it('changes that are not about keys (preferences) test nothing', () => {
    const p = planChange(base(), base({ mode: 'predictive', maxOptions: 2 }))
    expect(p).toMatchObject({ changed: true, restartStream: false, test: [], clear: [] })
  })

  it('both keys entered at once check both', () => {
    const empty = base({ deepgramKey: '', openrouterKey: '' })
    expect(planChange(empty, base()).test.sort()).toEqual(['stt', 'translate'])
  })

  it('editing the Deepgram key never flips a provider the user picked, even one with no key yet', () => {
    const picked = base({ provider: 'anthropic' }) // OpenRouter has a key, Claude doesn't, and Claude was chosen
    const p = planChange(picked, { ...picked, deepgramKey: 'dg-edited-key-9' })
    expect(p.next.provider).toBe('anthropic')
    expect(p.switchedProvider).toBe(false)
    expect(p.test).toEqual(['stt'])
  })

  it('entering the key of the provider that was chosen does not switch anything', () => {
    const start = base({ provider: 'anthropic' })
    const p = planChange(start, { ...start, anthropicKey: 'sk-ant-entered-1' })
    expect(p.next.provider).toBe('anthropic')
    expect(p.test).toEqual(['translate'])
  })
})
