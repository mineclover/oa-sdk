import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `msw` is an optional peer (peerDependenciesMeta.msw.optional): npm and pnpm
// do not install it. Only the entry points that release-policy.json declares
// under optionalPeerEntryPoints may import it; every other entry point, the
// root one that `oa-gen mock` loads above all, must load without it.
const MSW_ABSENT = 'msw is not installed'

/** Messages of the error `load` rejects with and of its causes (vitest wraps a throwing mock factory). */
async function failureMessages(load: () => Promise<unknown>): Promise<string[]> {
  const messages: string[] = []
  let reason = await load().then(() => undefined, (error: unknown) => error)
  while (reason instanceof Error) {
    messages.push(reason.message)
    reason = reason.cause
  }
  return messages
}

describe('entry points without the optional msw peer', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('msw', () => {
      throw new Error(MSW_ABSENT)
    })
  })

  afterEach(() => {
    vi.doUnmock('msw')
    vi.resetModules()
  })

  it('loads the root entry', async () => {
    const root = await import('../../index.js')
    expect(root.createNodeMockServer).toBeTypeOf('function')
    expect(root.createTestClient).toBeTypeOf('function')
    expect(root).not.toHaveProperty('createMswHandlers')
  })

  it('loads the node-http adapter entry', async () => {
    const adapter = await import('../../adapters/node-http.js')
    expect(adapter.createNodeMockServer).toBeTypeOf('function')
  })

  it.each([
    ['adapters/msw', () => import('../../adapters/msw.js')],
    ['browser', () => import('../../browser.js')],
  ])('requires msw for the %s entry, which declares it', async (_entry, load) => {
    expect(await failureMessages(load)).toContain(MSW_ABSENT)
  })
})
