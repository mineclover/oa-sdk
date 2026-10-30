import { describe, expect, it } from 'vitest'
import { BridgeError, createBridgeNode, definePopup, type TraceEvent } from '../src/index.js'
import { createPopupBridge } from '../src/host.js'
import { createPopupRuntime } from '../src/popup.js'
import { createMemoryBrowser } from '../src/testing.js'
import { A, B, ROOT, aContract, chain } from './chain.js'

const popupOf = (browser: ReturnType<typeof chain>['browser'], origin: string) => browser.popups.find(popup => popup.origin === origin)!

describe('attention between a popup and the popup that opened it', () => {
  it('B asks its host A for attention: A blinks, and B learns when the user comes back to A', async () => {
    const c = chain()
    await c.open()
    const a = c.pages.a!
    const b = c.pages.b!

    const waiting = b.runtime.host.attention.requestAndWait({ intent: 'input-needed', title: 'Pick a file' }, { acknowledgeTimeoutMs: 2_000 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(a.surface.title).toMatch(/Pick a file|Popup A/)
    expect(a.surface.marked).toBe(true)

    a.surface.activate() // the user clicks back into A
    const { result, acknowledged } = await waiting
    expect(result).toMatchObject({ accepted: true, visibility: 'hidden' })
    expect(result.appliedEffects).toContain('blink')
    expect(acknowledged).toBe(true)
    expect(a.surface.title).toBe('Popup A')
    expect(a.surface.marked).toBe(false)
  })

  it('A asks its popup B to come forward, and B reports that the browser granted it', async () => {
    const c = chain()
    const { sessionB } = await c.open()
    const result = await sessionB.attention.request({ intent: 'return' })
    expect(c.pages.b!.surface.focusCalls).toBe(1)
    expect(result).toMatchObject({ accepted: true, appliedEffects: ['focus'], focusObserved: true })
  })

  it('falls back to blinking when the browser refuses to raise B', async () => {
    const c = chain()
    const { sessionB } = await c.open()
    c.pages.b!.surface.grantFocus = false
    const result = await sessionB.attention.request({ intent: 'return', title: 'Back to B' })
    expect(result).toMatchObject({ appliedEffects: ['focus', 'blink'], focusObserved: false })
    expect(c.pages.b!.surface.title).toBe('● Back to B')
  })

  it('raises each other directly with focus(), from either end, without involving the peer page', async () => {
    const c = chain()
    const { sessionA, sessionB } = await c.open()
    sessionB.attention.focus() // A → B
    expect(popupOf(c.browser, B).focusRequests).toBe(1)
    expect(popupOf(c.browser, B).focused).toBe(true)

    c.pages.b!.runtime.host.attention.focus() // B → A
    expect(popupOf(c.browser, A).focusRequests).toBe(1)
    expect(popupOf(c.browser, A).focused).toBe(true)

    c.pages.a!.runtime.host.attention.focus() // A → root
    expect(c.browser.host.focusRequests).toBe(1)
    expect(c.browser.host.focused).toBe(true)
    sessionA.attention.focus() // root → A
    expect(popupOf(c.browser, A).focused).toBe(true)
  })

  it('does not move the window when the browser refuses, and says so', async () => {
    const c = chain()
    const { sessionB } = await c.open()
    c.browser.refuseFocus = true
    sessionB.attention.focus()
    expect(popupOf(c.browser, B).focusRequests).toBe(1)
    expect(popupOf(c.browser, B).focused).toBe(false)
  })

  it('answers "unsupported" when the peer has no attention manager', async () => {
    const c = chain({ aAttention: false })
    const { sessionB } = await c.open()
    expect(await c.pages.b!.runtime.host.attention.request({ intent: 'info' })).toMatchObject({ accepted: false, reason: 'unsupported' })
    expect(await sessionB.attention.request()).toMatchObject({ accepted: true }) // B still has one
  })

  it('applies the receiving page\'s policy, not the sender\'s wishes', async () => {
    const c = chain({ aAttention: { allow: ['blink'] } })
    await c.open()
    const result = await c.pages.b!.runtime.host.attention.request({ effects: ['focus', 'blink'] })
    expect(result.appliedEffects).toEqual(['blink'])
    expect(result.skipped).toEqual([{ effect: 'focus', reason: 'not-allowed' }])
    expect(c.pages.a!.surface.focusCalls).toBe(0)
  })

  it('rejects malformed requests from a peer with INVALID_PARAMS', async () => {
    const c = chain()
    await c.open()
    const error = await c.pages.b!.runtime.link.call('bridge.attention', { id: 'x', effects: ['teleport'] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BridgeError)
    expect((error as BridgeError).code).toBe('INVALID_PARAMS')
  })

  it('does not wait for an acknowledgement of a refused request', async () => {
    const c = chain({ aAttention: { authorize: () => false } })
    await c.open()
    const outcome = await c.pages.b!.runtime.host.attention.requestAndWait({ intent: 'info' }, { acknowledgeTimeoutMs: 10_000 })
    expect(outcome).toMatchObject({ acknowledged: false, result: { accepted: false, reason: 'denied' } })
  })
})

describe('links of a node', () => {
  it('lists a page\'s host and popups with the same interface', async () => {
    const c = chain()
    await c.open()
    const links = c.pages.a!.node.links
    expect(links.map(link => [link.role, link.status])).toEqual([['host', 'READY'], ['popup', 'READY']])
    expect(links.find(link => link.role === 'host')?.peerOrigin).toBe(ROOT)
    expect(links.find(link => link.role === 'popup')?.peerOrigin).toBe(B)
    expect(c.pages.b!.node.links.map(link => link.role)).toEqual(['host'])
  })

  it('drops a link when its popup closes', async () => {
    const c = chain()
    const { sessionB } = await c.open()
    await sessionB.close()
    expect(c.pages.a!.node.links.map(link => link.role)).toEqual(['host'])
  })
})

describe('topology', () => {
  it('walks down from the root through every popup that exposes its neighbours', async () => {
    const c = chain()
    await c.open()
    const tree = await c.rootNode.topology({ depth: 3 })
    expect(tree).toMatchObject({ name: 'root', origin: ROOT })
    expect(tree.links).toHaveLength(1)
    const aLink = tree.links[0]!
    expect(aLink).toMatchObject({ role: 'popup', peerOrigin: A, status: 'READY' })
    expect(aLink.node).toMatchObject({ name: 'a', origin: A })
    expect(aLink.node!.links.map(link => [link.role, link.peerOrigin])).toEqual([['host', ROOT], ['popup', B]])
    const bLink = aLink.node!.links.find(link => link.role === 'popup')!
    expect(bLink.node).toMatchObject({ name: 'b', origin: B })
    expect(bLink.node!.links.map(link => link.role)).toEqual(['host'])
  })

  it('stops at the requested depth', async () => {
    const c = chain()
    await c.open()
    const shallow = await c.rootNode.topology({ depth: 0 })
    expect(shallow.links[0]!.node).toBeUndefined()
    const one = await c.rootNode.topology({ depth: 1 })
    expect(one.links[0]!.node?.links.find(link => link.role === 'popup')?.node).toBeUndefined()
  })

  it('keeps a popup that hides its neighbours as a leaf, since topology is opt-in', async () => {
    const c = chain({ aTopology: false })
    await c.open()
    const tree = await c.rootNode.topology({ depth: 3 })
    expect(tree.links[0]!.node).toBeUndefined()
  })

  it('lets B see its siblings through its host A, without walking back into B', async () => {
    const c = chain()
    await c.open()
    const reply = (await c.pages.b!.runtime.link.call('bridge.topology', { depth: 3 })) as { links: { role: string; node?: unknown }[] }
    expect(reply.links.map(link => link.role)).toEqual(['host', 'popup'])
    expect(reply.links.find(link => link.role === 'popup')?.node).toBeUndefined() // the asker is not walked
  })

  it('decides per link when given a function', async () => {
    // A answers popups it opened (B) but not its host (the root).
    const c = chain({ aTopologyPolicy: link => link.role === 'popup' })
    await c.open()
    expect((await c.rootNode.topology({ depth: 3 })).links[0]!.node).toBeUndefined()
    const reply = (await c.pages.b!.runtime.link.call('bridge.topology', { depth: 1 })) as { name?: string }
    expect(reply.name).toBe('a')
  })

  it('rejects a malformed depth', async () => {
    const c = chain()
    await c.open()
    const error = await c.pages.b!.runtime.link.call('bridge.topology', { depth: -1 }).catch((e: unknown) => e)
    expect((error as BridgeError).code).toBe('INVALID_PARAMS')
  })
})

describe('inspection and trace', () => {
  it('snapshots links and records calls, notifications and state changes without heartbeat noise', async () => {
    const c = chain()
    const events: TraceEvent[] = []
    c.rootNode.onTrace(event => events.push(event))
    const { sessionA } = await c.open()
    await sessionA.call('a.ping')

    const snapshot = c.rootNode.inspect()
    expect(snapshot).toMatchObject({ name: 'root', origin: ROOT })
    expect(snapshot.links).toEqual([expect.objectContaining({ role: 'popup', peerOrigin: A, status: 'READY', connected: true, pendingCalls: 0 })])
    expect(snapshot.trace.length).toBeGreaterThan(0)

    expect(events.filter(event => event.type === 'link').map(event => (event as { status: string }).status)).toContain('READY')
    expect(events).toContainEqual(expect.objectContaining({ type: 'call', direction: 'out', method: 'a.ping', durationMs: expect.any(Number) }))
    expect(events.some(event => event.type === 'call' && event.method === 'bridge.ping')).toBe(false)
  })

  it('traces attention requests on both ends', async () => {
    const c = chain()
    await c.open()
    const incoming: TraceEvent[] = []
    const outgoing: TraceEvent[] = []
    c.pages.a!.node.onTrace(event => incoming.push(event))
    c.pages.b!.node.onTrace(event => outgoing.push(event))
    await c.pages.b!.runtime.host.attention.request({ intent: 'completed' })
    expect(incoming).toContainEqual(expect.objectContaining({ type: 'attention', direction: 'in', result: expect.objectContaining({ accepted: true }) }))
    expect(outgoing).toContainEqual(expect.objectContaining({ type: 'attention', direction: 'out' }))
  })

  it('reports security events through the node', async () => {
    const browser = createMemoryBrowser({ hostOrigin: ROOT })
    const node = createBridgeNode()
    const events: TraceEvent[] = []
    node.onTrace(event => events.push(event))
    browser.onPopupLoad(page => {
      const runtime = createPopupRuntime({ contract: aContract, allowedHostOrigins: [ROOT], env: page.env, handshakeTimeoutMs: 100 })
      runtime.register('a.ping', () => ({ ok: true }))
      void runtime.start().catch(() => undefined)
    })
    const bridge = createPopupBridge({ env: browser.hostEnv, node, defaults: { closedPollMs: 20 } })
    // The definition expects another origin than the one the popup answers from.
    const wrongOrigin = definePopup(aContract, { url: `${A}/a`, expectedOrigin: 'https://elsewhere.example.com', requiredCapabilities: [] })
    await bridge.open(wrongOrigin).catch(() => undefined)
    expect(events).toContainEqual(expect.objectContaining({ type: 'security', role: 'popup', event: expect.objectContaining({ type: 'origin-mismatch' }) }))
  })

  it('keeps only the newest events', async () => {
    const c = chain({ rootTraceBuffer: 3 })
    const { sessionA } = await c.open()
    for (let i = 0; i < 5; i++) await sessionA.call('a.ping')
    const { trace } = c.rootNode.inspect()
    expect(trace).toHaveLength(3)
    expect(trace.at(-1)).toMatchObject({ type: 'call', method: 'a.ping' })
  })

  it('survives a throwing observer', async () => {
    const c = chain()
    c.rootNode.onTrace(() => {
      throw new Error('observer bug')
    })
    const { sessionA } = await c.open()
    expect(await sessionA.call('a.ping')).toEqual({ ok: true })
  })
})
