import { describe, expect, it, vi } from 'vitest'
import { BridgeError, defineSharedState, type TraceEvent } from '../src/index.js'
import { chain } from './chain.js'

type Selection = { ids: string[] }

const selection = defineSharedState<Selection>({
  name: 'document.selection',
  initial: { ids: [] },
  schema: (value: unknown): Selection => {
    const ids = (value as Partial<Selection> | null)?.ids
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('ids must be strings')
    return { ids }
  },
  writable: true,
})
const readOnly = defineSharedState<{ count: number }>({ name: 'document.counter', initial: { count: 0 } })

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

describe('naming', () => {
  it('follows the method and event naming convention', () => {
    expect(() => defineSharedState({ name: 'Bad Name', initial: 0 })).toThrow(TypeError)
    expect(() => defineSharedState({ name: 'bridge.counter', initial: 0 })).toThrow(/reserved/)
  })
})

describe('owner and replica across a link', () => {
  it('replicates the initial value and every change from the owner to a popup', async () => {
    const c = chain()
    await c.open()
    const owned = c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)

    expect(await replica.ready).toEqual({ value: { ids: [] }, revision: 0 })
    expect(replica.status).toBe('ready')
    expect(owned.subscribers).toBe(1)

    const changes: number[] = []
    replica.onChange((snapshot, change) => {
      changes.push(snapshot.revision)
      expect(change.source).toBe('remote')
    })
    owned.set({ ids: ['a1'] })
    owned.update(current => ({ ids: [...current.ids, 'a2'] }))
    await tick()
    expect(replica.get()).toEqual({ value: { ids: ['a1', 'a2'] }, revision: 2 })
    expect(changes).toEqual([1, 2])
  })

  it('works in the other direction too: a host replicates a state owned by its popup', async () => {
    const c = chain()
    const { sessionA } = await c.open()
    const owned = c.pages.a!.node.state.own(selection, { initial: { ids: ['seed'] } })
    const replica = sessionA.link.replicate(selection)
    expect(await replica.ready).toMatchObject({ value: { ids: ['seed'] } })
    owned.set({ ids: ['x'] })
    await tick()
    expect(replica.get()?.value).toEqual({ ids: ['x'] })
  })

  it('lets a grandchild follow its host, which in turn follows the root', async () => {
    const c = chain()
    await c.open()
    const root = c.rootNode.state.own(selection)
    const viaA = c.pages.a!.runtime.link.replicate(selection)
    await viaA.ready
    const mirror = c.pages.a!.node.state.own(selection)
    viaA.onChange(snapshot => mirror.set(snapshot.value))
    const viaB = c.pages.b!.runtime.link.replicate(selection)
    await viaB.ready
    root.set({ ids: ['from-root'] })
    await vi.waitFor(() => expect(viaB.get()?.value).toEqual({ ids: ['from-root'] }))
  })

  it('rejects ready when the peer owns no such state', async () => {
    const c = chain()
    await c.open()
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await expect(replica.ready).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' })
    expect(replica.status).toBe('unavailable')
  })

  it('catches up after the popup reloads and starts over', async () => {
    const c = chain()
    const { sessionA } = await c.open()
    const first = c.pages.a!.node.state.own(selection, { initial: { ids: ['before'] } })
    const replica = sessionA.link.replicate(selection)
    await replica.ready
    first.set({ ids: ['before', 'more'] })
    await vi.waitFor(() => expect(replica.get()?.revision).toBe(1))

    // The popup page reloads: a new page with a new node re-creates the owner from what it persisted.
    const reconnected = new Promise<void>(resolve => sessionA.on('reconnect', () => resolve()))
    c.browser.popups[0]!.reload()
    await vi.waitFor(() => expect(c.pages.a!.runtime.state).toBe('READY'))
    c.pages.a!.node.state.own(selection, { initial: { ids: ['after'] } })
    await reconnected
    await vi.waitFor(() => expect(replica.get()?.value).toEqual({ ids: ['after'] }))
    expect(replica.get()?.revision).toBe(0) // adopted although the revision went backwards
  })

  it('stops pushing after the replica is disposed', async () => {
    const c = chain()
    await c.open()
    const owned = c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready
    replica.dispose()
    await vi.waitFor(() => expect(owned.subscribers).toBe(0))
    owned.set({ ids: ['late'] })
    await tick()
    expect(replica.get()?.value).toEqual({ ids: [] })
    expect(replica.status).toBe('closed')
  })

  it('forgets subscribers whose link ended', async () => {
    const c = chain()
    const { sessionB } = await c.open()
    const owned = c.pages.a!.node.state.own(selection)
    const replica = c.pages.b!.runtime.link.replicate(selection)
    await replica.ready
    expect(owned.subscribers).toBe(1)
    await sessionB.close()
    await vi.waitFor(() => expect(owned.subscribers).toBe(0))
  })
})

describe('writes', () => {
  it('commits a replica\'s proposal at the owner and returns the new snapshot', async () => {
    const c = chain()
    await c.open()
    const owned = c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready
    const seen = vi.fn()
    owned.onChange((snapshot, change) => seen(snapshot.value, change.source, change.link?.role))

    const written = await replica.set({ ids: ['picked'] })
    expect(written).toEqual({ value: { ids: ['picked'] }, revision: 1 })
    expect(owned.get().value).toEqual({ ids: ['picked'] })
    expect(seen).toHaveBeenCalledWith({ ids: ['picked'] }, 'remote', 'popup')
  })

  it('refuses writes to a read-only state, on both ends', async () => {
    const c = chain()
    await c.open()
    c.rootNode.state.own(readOnly)
    const replica = c.pages.a!.runtime.link.replicate(readOnly)
    await replica.ready
    await expect(replica.set({ count: 1 })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    // A peer that skips the client-side check is refused by the owner as well.
    const direct = await c.pages.a!.runtime.link.call('bridge.state.set', { name: 'document.counter', value: { count: 9 } }).catch((e: unknown) => e)
    expect((direct as BridgeError).code).toBe('PERMISSION_DENIED')
  })

  it('validates proposed values against the schema', async () => {
    const c = chain()
    await c.open()
    c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready
    const direct = await c.pages.a!.runtime.link.call('bridge.state.set', { name: selection.name, value: { ids: [1] } }).catch((e: unknown) => e)
    expect((direct as BridgeError).code).toBe('INVALID_PARAMS')
  })

  it('detects conflicting writes by revision and retries read-modify-write with the newer value', async () => {
    const c = chain()
    await c.open()
    const owned = c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready

    owned.set({ ids: ['owner'] }) // the replica has not seen this yet
    const stale = await replica.set({ ids: ['stale'] }, { baseRevision: 0 }).catch((e: unknown) => e)
    expect(stale).toBeInstanceOf(BridgeError)
    expect((stale as BridgeError).code).toBe('STATE_CONFLICT')
    expect((stale as BridgeError).data).toEqual({ revision: 1, value: { ids: ['owner'] } })
    expect(owned.get().value).toEqual({ ids: ['owner'] })

    let attempts = 0
    const merged = await replica.update(current => {
      attempts++
      if (attempts === 1) owned.set({ ids: ['owner', 'again'] }) // changes under the writer's feet once
      return { ids: [...current.ids, 'replica'] }
    })
    expect(merged.value.ids).toEqual(['owner', 'again', 'replica'])
    expect(attempts).toBe(2)
  })

  it('lets the owner decide per link who may read or write', async () => {
    const c = chain()
    await c.open()
    c.rootNode.state.own(selection, { authorize: operation => operation === 'read' })
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready
    await expect(replica.set({ ids: ['no'] })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })

    const closed = chain()
    await closed.open()
    closed.rootNode.state.own(selection, { authorize: () => false })
    await expect(closed.pages.a!.runtime.link.replicate(selection).ready).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('owner', () => {
  it('can own a name once per node and validates the initial value', () => {
    const c = chain()
    c.rootNode.state.own(selection)
    expect(() => c.rootNode.state.own(selection)).toThrow(/already owned/)
    const other = chain()
    expect(() => other.rootNode.state.own(selection, { initial: { ids: [1] } as never })).toThrow(BridgeError)
    expect(() => other.rootNode.state.own(selection)).not.toThrow() // the failed attempt did not claim the name
  })

  it('refuses values that cannot be sent to a peer', () => {
    const c = chain()
    const state = c.rootNode.state.own(defineSharedState<unknown>({ name: 'x.fn', initial: 1 }))
    expect(() => state.set(() => 1)).toThrow(expect.objectContaining({ code: 'NOT_CLONEABLE' }))
    expect(state.get().revision).toBe(0)
  })

  it('can be released and owned again', () => {
    const c = chain()
    c.rootNode.state.own(selection).dispose()
    expect(() => c.rootNode.state.own(selection)).not.toThrow()
  })

  it('traces commits on the owner and snapshots on the replica', async () => {
    const c = chain()
    await c.open()
    const ownerTrace: TraceEvent[] = []
    const replicaTrace: TraceEvent[] = []
    c.rootNode.onTrace(event => ownerTrace.push(event))
    c.pages.a!.node.onTrace(event => replicaTrace.push(event))
    const owned = c.rootNode.state.own(selection)
    const replica = c.pages.a!.runtime.link.replicate(selection)
    await replica.ready
    owned.set({ ids: ['t'] })
    await vi.waitFor(() => expect(replicaTrace).toContainEqual(expect.objectContaining({ type: 'state', revision: 1, source: 'remote' })))
    expect(ownerTrace).toContainEqual(expect.objectContaining({ type: 'state', name: selection.name, revision: 1, source: 'local' }))
  })
})
