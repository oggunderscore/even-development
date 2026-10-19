import { describe, expect, it, vi } from 'vitest'
import { requestExit } from './exit'

describe('requestExit', () => {
  it('asks for the system confirmation dialog (mode 1), never the immediate exit (mode 0)', async () => {
    const bridge = { shutDownPageContainer: vi.fn(async () => true) }
    expect(await requestExit(bridge)).toBe(true)
    expect(bridge.shutDownPageContainer).toHaveBeenCalledTimes(1)
    expect(bridge.shutDownPageContainer).toHaveBeenCalledWith(1)
    expect(bridge.shutDownPageContainer).not.toHaveBeenCalledWith(0)
  })

  it('a refused or failing request, or no bridge, is just "not accepted" and never throws', async () => {
    expect(await requestExit({ shutDownPageContainer: async () => false })).toBe(false)
    expect(await requestExit({ shutDownPageContainer: async () => Promise.reject(new Error('x')) })).toBe(false)
    expect(await requestExit(null)).toBe(false)
  })
})
