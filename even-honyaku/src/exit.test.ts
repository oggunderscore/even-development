import { describe, expect, it, vi } from 'vitest'
import { exitImmediately } from './exit'

describe('exitImmediately', () => {
  it('stops capture, then closes with the immediate mode (0), never the confirmation dialog (1)', async () => {
    const order: string[] = []
    const bridge = { shutDownPageContainer: vi.fn(async (mode: number) => (order.push(`shutdown:${mode}`), true)) }
    const closed = await exitImmediately(bridge, async () => void order.push('stop'), async () => void order.push('resume'))
    expect(closed).toBe(true)
    expect(order).toEqual(['stop', 'shutdown:0'])
    expect(bridge.shutDownPageContainer).toHaveBeenCalledTimes(1)
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalledWith(1)
  })

  it('if the glasses refuse (or throw), capture is re-armed and the app keeps working', async () => {
    const resume = vi.fn(async () => {})
    expect(await exitImmediately({ shutDownPageContainer: async () => false }, async () => {}, resume)).toBe(false)
    expect(resume).toHaveBeenCalledTimes(1)
    const resume2 = vi.fn(async () => {})
    expect(await exitImmediately({ shutDownPageContainer: async () => Promise.reject(new Error('x')) }, async () => {}, resume2)).toBe(false)
    expect(resume2).toHaveBeenCalledTimes(1)
  })

  it('without a bridge there is nothing to close: carry on', async () => {
    const resume = vi.fn(async () => {})
    expect(await exitImmediately(null, async () => {}, resume)).toBe(false)
    expect(resume).toHaveBeenCalled()
  })
})
