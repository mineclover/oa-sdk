import { describe, expect, it, vi } from 'vitest'
import { BridgeError, definePopup } from '../src/index.js'
import { assetContract, definition, init, setup } from './fixture.js'

const hostMethods = { 'host.document.getSelection': () => ({ text: 'selected words' }) }

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<BridgeError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(BridgeError)
  expect((error as BridgeError).code).toBe(code)
  return error as BridgeError
}

describe('normal flow', () => {
  it('opens, becomes READY and serves typed RPC through call() and api', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init, host: hostMethods })
    expect(session.state).toBe('READY')
    expect(session.protocolVersion).toBe('1.0')
    expect(session.capabilities.map(c => c.name)).toContain('asset.select')
    expect(await session.call('asset.select', { multiple: false })).toEqual({ assetIds: ['a1'] })
    expect(await session.api.asset.select({ multiple: true })).toEqual({ assetIds: ['a1', 'a2'] })
    expect(booted[0]!.inits).toEqual([init])
    await session.close()
    expect(session.state).toBe('CLOSED')
  })

  it('opens the window synchronously, before any await', () => {
    const { bridge, browser } = setup()
    void bridge.open(definition, { init })
    expect(browser.popups).toHaveLength(1)
  })

  it('tolerates a slow popup page: nothing is sent before HELLO', async () => {
    const { bridge } = setup({ bootDelayMs: 80 })
    const session = await bridge.open(definition, { init })
    expect(await session.call('asset.getSnapshot')).toMatchObject({ revision: 0 })
  })

  it('tracks live sessions on the bridge', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    expect(bridge.sessions.has(session)).toBe(true)
    await session.close()
    await vi.waitFor(() => expect(bridge.sessions.size).toBe(0))
  })

  it('moves through the documented states', async () => {
    const { bridge } = setup()
    const states: string[] = []
    const opening = bridge.open(definition, { init })
    const session = await opening
    session.on('state', s => states.push(s))
    await session.close()
    expect(states).toEqual(['CLOSING', 'CLOSED'])
  })
})

describe('bootstrap failures', () => {
  it('reports POPUP_BLOCKED', async () => {
    const { bridge, browser } = setup()
    browser.blockPopups = true
    await rejectsWith(bridge.open(definition, { init }), 'POPUP_BLOCKED')
  })

  it('reports HANDSHAKE_TIMEOUT when the popup never says HELLO and closes the window', async () => {
    const { bridge, browser } = setup({ silent: true })
    await rejectsWith(bridge.open(definition, { init, handshakeTimeoutMs: 40 }), 'HANDSHAKE_TIMEOUT')
    expect(browser.popups[0]!.closed).toBe(true)
  })

  it('rejects an invalid init before opening any window', async () => {
    const { bridge, browser } = setup()
    const error = await rejectsWith(bridge.open(definition, { init: { documentId: 1 } as never }), 'INIT_INVALID')
    expect(error.message).toMatch(/documentId/)
    expect(browser.popups).toHaveLength(0)
  })

  it('refuses a popup answering from the wrong origin and logs it', async () => {
    const { bridge, securityEvents, browser } = setup()
    const hostile = definePopup(assetContract, { url: 'https://evil.example.net/asset-selector', expectedOrigin: 'https://tools.example.com' })
    await rejectsWith(bridge.open(hostile, { init }), 'ORIGIN_MISMATCH')
    expect(securityEvents.some(e => e.type === 'origin-mismatch' && e.origin === 'https://evil.example.net')).toBe(true)
    expect(browser.popups[0]!.closed).toBe(true)
  })

  it('has the popup refuse an unlisted host origin: no CONNECT is ever delivered', async () => {
    const onSecurity = vi.fn()
    const { bridge, booted } = setup({ allowedHostOrigins: ['https://other.example.com'], onSecurity })
    await rejectsWith(bridge.open(definition, { init, handshakeTimeoutMs: 60 }), 'HANDSHAKE_TIMEOUT')
    expect(booted[0]!.runtime.state).toBe('WAITING_CONNECT')
  })

  it('reports PROTOCOL_INCOMPATIBLE to both sides', async () => {
    const { bridge, booted } = setup({ popupProtocolVersions: ['2.0'] })
    // Keep the window open so the popup can receive the refusal and show it to the user.
    const error = await rejectsWith(bridge.open(definition, { init, closeWindowOnClose: false }), 'PROTOCOL_INCOMPATIBLE')
    expect(error.data).toMatchObject({ supported: ['1.0'], offered: ['2.0'] })
    await vi.waitFor(() => expect(booted[0]!.runtime.state).toBe('FAILED'), { timeout: 200 })
  })

  it('reports INIT_INVALID raised by the popup application', async () => {
    const { bridge } = setup({ onInit: () => { throw new Error('unsupported locale') } })
    await rejectsWith(bridge.open(definition, { init }), 'INIT_INVALID')
  })

  it('reports CAPABILITY_UNAVAILABLE when a required method is not registered', async () => {
    const { bridge } = setup({ skipRegister: ['asset.save'] })
    const error = await rejectsWith(bridge.open(definition, { init }), 'CAPABILITY_UNAVAILABLE')
    expect(JSON.stringify(error.data)).toContain('asset.save')
  })

  it('accepts a missing method when it is not required', async () => {
    const { bridge } = setup({ skipRegister: ['asset.save'] })
    const narrow = definePopup(assetContract, {
      url: 'https://tools.example.com/asset-selector',
      requiredCapabilities: [{ name: 'asset.select', versionRange: '^1.0.0' }],
    })
    const session = await bridge.open(narrow, { init })
    await rejectsWith(session.call('asset.save', { name: 'x' }), 'METHOD_NOT_FOUND')
  })

  it('supports cancelling while opening', async () => {
    const { bridge } = setup({ silent: true })
    const controller = new AbortController()
    const opening = bridge.open(definition, { init, signal: controller.signal })
    controller.abort()
    await rejectsWith(opening, 'CANCELLED')
  })
})

describe('rpc', () => {
  it('answers METHOD_NOT_FOUND for an unregistered method', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.call('asset.nothing' as never), 'METHOD_NOT_FOUND')
  })

  it('lets the popup call exposed host methods (reverse RPC)', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init, host: hostMethods })
    expect(await session.call('asset.readSelection')).toEqual({ text: 'selected words' })
  })

  it('does not reach host methods that were not exposed', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.call('asset.readSelection'), 'METHOD_NOT_FOUND')
  })

  it('denies calls through authorize hooks on either side', async () => {
    const popupAuthorize = vi.fn(({ permission }: { permission: string | undefined }) => permission !== 'assets:read')
    const { bridge, securityEvents } = setup({ popupAuthorize })
    const session = await bridge.open(definition, {
      init,
      host: hostMethods,
      authorize: ({ permission }) => permission !== 'document:read',
    })
    await rejectsWith(session.call('asset.select', {}), 'PERMISSION_DENIED')
    await rejectsWith(session.call('asset.readSelection'), 'PERMISSION_DENIED')
    expect(await session.call('asset.getSnapshot')).toBeDefined()
    expect(securityEvents.filter(e => e.type === 'unauthorized-call')).toHaveLength(1)
  })

  it('times out slow calls with RPC_TIMEOUT', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.call('asset.save', { name: 'x' }, { timeoutMs: 5 }), 'RPC_TIMEOUT')
  })

  it('executes a retried mutation once', async () => {
    const { bridge, saveRuns } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.call('asset.save', { name: 'abc' }, { timeoutMs: 5, idempotencyKey: 'save-1' }), 'RPC_TIMEOUT')
    expect(await session.call('asset.save', { name: 'abc' }, { idempotencyKey: 'save-1' })).toEqual({ saved: 3 })
    expect(saveRuns()).toBe(1)
  })

  it('rejects invalid params locally and from the wire', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.call('asset.save', 'x' as never), 'INVALID_PARAMS')
  })
})

describe('events and snapshots', () => {
  it('delivers events with revisions only to subscribed handlers and stops after unsubscribe', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init })
    const received: Array<[string[], number, boolean]> = []
    const unsubscribe = await session.subscribe('asset.selectionChanged', (payload, meta) => received.push([payload.assetIds, meta.revision, meta.gap]))
    const popup = booted[0]!.runtime
    popup.emit('asset.selectionChanged', { assetIds: ['a1'] })
    popup.emit('asset.selectionChanged', { assetIds: ['a1', 'a2'] })
    await vi.waitFor(() => expect(received).toHaveLength(2))
    expect(received).toEqual([[['a1'], 1, false], [['a1', 'a2'], 2, false]])
    await unsubscribe()
    popup.emit('asset.selectionChanged', { assetIds: [] })
    await new Promise(r => setTimeout(r, 20))
    expect(received).toHaveLength(2)
  })

  it('shares one wire subscription between handlers', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init })
    const a = vi.fn()
    const b = vi.fn()
    const offA = await session.subscribe('asset.selectionChanged', a)
    await session.subscribe('asset.selectionChanged', b)
    booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [] })
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(1))
    expect(a).toHaveBeenCalledTimes(1)
    await offA()
    booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [] })
    await vi.waitFor(() => expect(b).toHaveBeenCalledTimes(2))
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('rejects subscribing to an event outside the contract', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    await rejectsWith(session.subscribe('asset.nope' as never, () => undefined), 'CAPABILITY_UNAVAILABLE')
  })
})

describe('lifecycle', () => {
  it('fails pending calls with SESSION_CLOSED when the user closes the popup window', async () => {
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init })
    const pendingCall = session.call('asset.save', { name: 'abc' })
    browser.popups[0]!.close()
    await rejectsWith(pendingCall, 'SESSION_CLOSED')
    const info = await session.closed
    expect(info.reason).toBe('window-closed')
    expect(session.state).toBe('CLOSED')
    await rejectsWith(session.call('asset.getSnapshot'), 'SESSION_NOT_READY')
  })

  it('reconnects after a popup reload: old calls fail, state is re-synchronized', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const received: number[] = []
    await session.subscribe('asset.selectionChanged', (_p, meta) => received.push(meta.revision))
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)

    const inflight = session.call('asset.save', { name: 'abc' })
    browser.popups[0]!.reload()
    await rejectsWith(inflight, 'SESSION_CLOSED')
    expect(session.state).not.toBe('READY')
    await rejectsWith(session.call('asset.getSnapshot'), 'SESSION_NOT_READY')

    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    expect(session.state).toBe('READY')
    expect(booted).toHaveLength(2)
    expect(booted[1]!.inits).toEqual([init])
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    // The subscription survived and starts a fresh revision sequence.
    booted[1]!.runtime.emit('asset.selectionChanged', { assetIds: [] })
    await vi.waitFor(() => expect(received).toEqual([1]))
  })

  it('closes the session when the popup reloads and reconnecting is disabled', async () => {
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init, allowReconnect: false })
    browser.popups[0]!.reload()
    const info = await session.closed
    expect(info.reason).toBe('popup-close')
    expect(info.error?.code).toBe('SESSION_CLOSED')
  })

  it('gives up when a reloaded popup never says HELLO again', async () => {
    const { bridge, browser } = setup({ bootFirstOnly: true })
    const session = await bridge.open(definition, { init, handshakeTimeoutMs: 60 })
    browser.popups[0]!.reload()
    const info = await session.closed
    expect(info.error?.code).toBe('HANDSHAKE_TIMEOUT')
    expect(session.state).toBe('CLOSED')
  })

  it('notifies the popup when the host closes the session', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init })
    const closed = vi.fn()
    booted[0]!.runtime.onClose(closed)
    await session.close()
    await vi.waitFor(() => expect(closed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'host-close' })))
    expect(booted[0]!.runtime.state).toBe('CLOSED')
  })

  it('notifies the popup when the host page unloads', async () => {
    const { bridge, browser, booted } = setup()
    await bridge.open(definition, { init })
    browser.hostPageHide()
    await vi.waitFor(() => expect(booted[0]!.runtime.state).toBe('CLOSED'))
  })

  it('lets the popup close the session', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init })
    booted[0]!.runtime.close()
    const info = await session.closed
    expect(info.reason).toBe('popup-close')
  })

  it('keeps two concurrent popups isolated', async () => {
    const { bridge, booted } = setup()
    const [one, two] = await Promise.all([
      bridge.open(definition, { init: { ...init, documentId: 'one' } }),
      bridge.open(definition, { init: { ...init, documentId: 'two' } }),
    ])
    expect(one.sessionId).not.toBe(two.sessionId)
    expect(booted.map(b => b.inits[0]!.documentId).sort()).toEqual(['one', 'two'])
    const receivedOne: unknown[] = []
    const receivedTwo: unknown[] = []
    await one.subscribe('asset.selectionChanged', p => receivedOne.push(p))
    await two.subscribe('asset.selectionChanged', p => receivedTwo.push(p))
    const popupOne = booted.find(b => b.inits[0]!.documentId === 'one')!.runtime
    popupOne.emit('asset.selectionChanged', { assetIds: ['only-one'] })
    await vi.waitFor(() => expect(receivedOne).toHaveLength(1))
    expect(receivedTwo).toHaveLength(0)
    await one.close()
    expect(two.state).toBe('READY')
    expect(await two.call('asset.getSnapshot')).toBeDefined()
    await two.close()
  })
})

describe('untyped definitions', () => {
  it('works without a contract: raw names, free-form host handlers', async () => {
    const { bridge } = setup()
    const raw = { id: 'asset-selector', url: 'https://tools.example.com/asset-selector', expectedOrigin: 'https://tools.example.com', protocolVersions: ['1.0'], requiredCapabilities: [] }
    const session = await bridge.open(raw, { init, host: { 'host.ping.now': () => 'pong' } })
    expect(await session.call('asset.select', { multiple: false })).toEqual({ assetIds: ['a1'] })
  })
})

describe('heartbeat', () => {
  it('reports round trips while the popup answers', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init, heartbeat: { intervalMs: 20, timeoutMs: 200 } })
    const rtts: number[] = []
    session.on('health', (health, rtt) => {
      expect(health).toBe('ok')
      if (rtt !== undefined) rtts.push(rtt)
    })
    await vi.waitFor(() => expect(rtts.length).toBeGreaterThanOrEqual(2))
    expect(session.state).toBe('READY')
    expect(session.health).toBe('ok')
  })

  it('ends the session with PEER_UNRESPONSIVE and fails pending calls quickly when the popup hangs', async () => {
    const { bridge, booted } = setup({ freezable: true })
    const session = await bridge.open(definition, { init, heartbeat: { intervalMs: 20, timeoutMs: 80 } })
    const health: string[] = []
    session.on('health', value => health.push(value))
    booted[0]!.freeze()
    const startedAt = Date.now()
    const inflight = session.call('asset.save', { name: 'abc' }, { timeoutMs: 30_000 })
    const error = await rejectsWith(inflight, 'PEER_UNRESPONSIVE')
    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(error.data).toMatchObject({ timeoutMs: 80 })
    const info = await session.closed
    expect(info.error?.code).toBe('PEER_UNRESPONSIVE')
    expect(health).toContain('unresponsive')
  })

  it('does not probe when heartbeat is disabled', async () => {
    const { bridge, booted } = setup({ freezable: true })
    const session = await bridge.open(definition, { init, heartbeat: false })
    booted[0]!.freeze()
    await new Promise(r => setTimeout(r, 150))
    expect(session.state).toBe('READY')
  })
})

describe('page restored from the back/forward cache', () => {
  it('rejoins as a new instance, restores subscriptions and tells the popup page', async () => {
    const { bridge, browser, booted } = setup()
    const session = await bridge.open(definition, { init })
    const received: number[] = []
    await session.subscribe('asset.selectionChanged', (_p, meta) => received.push(meta.revision))
    const reconnected = vi.fn()
    session.on('reconnect', reconnected)
    const popupReconnected = vi.fn()
    booted[0]!.runtime.onReconnect(popupReconnected)

    browser.popups[0]!.freeze()
    await vi.waitFor(() => expect(session.state).toBe('WAITING_HELLO'))
    await rejectsWith(session.call('asset.getSnapshot'), 'SESSION_NOT_READY')

    browser.popups[0]!.restore()
    await vi.waitFor(() => expect(reconnected).toHaveBeenCalledTimes(1))
    expect(popupReconnected).toHaveBeenCalledTimes(1)
    expect(session.state).toBe('READY')
    expect(booted[0]!.runtime.state).toBe('READY')
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [] })
    await vi.waitFor(() => expect(received).toEqual([1]))
  })

  it('ignores a pageshow that was not restored from the cache', async () => {
    const { bridge, browser } = setup()
    const session = await bridge.open(definition, { init })
    // A plain pageshow (persisted=false) must not disturb a live session.
    browser.popups[0]!.page.env.onPageShow?.(() => undefined)
    expect(session.state).toBe('READY')
  })
})

describe('limits and accurate errors', () => {
  it('drops notifications beyond the host rate limit and reports a security event', async () => {
    const { bridge, booted, securityEvents } = setup()
    const session = await bridge.open(definition, { init, limits: { maxNotificationsPerSecond: 3 } })
    const received: number[] = []
    await session.subscribe('asset.selectionChanged', (_p, meta) => received.push(meta.revision))
    for (let i = 0; i < 10; i++) booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [String(i)] })
    await vi.waitFor(() => expect(securityEvents.some(e => e.type === 'rate-limited')).toBe(true))
    await new Promise(r => setTimeout(r, 30))
    expect(received).toEqual([1, 2, 3])
  })

  it('refuses reverse calls beyond the in-flight limit with OVERLOADED', async () => {
    const { bridge, securityEvents } = setup()
    const session = await bridge.open(definition, {
      init,
      limits: { maxInflight: 1 },
      host: { 'host.document.getSelection': async () => { await new Promise(r => setTimeout(r, 40)); return { text: 'slow' } } },
    })
    const results = await Promise.allSettled([session.call('asset.readSelection'), session.call('asset.readSelection')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect((rejected.reason as BridgeError).code).toBe('OVERLOADED')
    expect(securityEvents.some(e => e.type === 'rate-limited' && e.detail?.startsWith('inflight'))).toBe(true)
  })

  it('throws NOT_CLONEABLE to the emitter when a payload cannot be sent', async () => {
    const { bridge, booted } = setup()
    const session = await bridge.open(definition, { init })
    await session.subscribe('asset.selectionChanged', () => undefined)
    expect(() => booted[0]!.runtime.emit('asset.selectionChanged', { assetIds: [() => 1] as never })).toThrowError(
      expect.objectContaining({ code: 'NOT_CLONEABLE' }),
    )
  })

  it('transfers buffers in both directions through the typed API', async () => {
    const { bridge } = setup()
    const session = await bridge.open(definition, { init })
    const bytes = new ArrayBuffer(2048)
    expect(await session.call('asset.upload', { bytes }, { transfer: [bytes] })).toEqual({ length: 2048 })
    expect(bytes.byteLength).toBe(0)
    const downloaded = await session.call('asset.download', { size: 4096 })
    expect(downloaded.bytes.byteLength).toBe(4096)
    const kept = new ArrayBuffer(8)
    expect(await session.api.asset.upload({ bytes: kept })).toEqual({ length: 8 })
    expect(kept.byteLength).toBe(8)
  })
})


describe('a restore while the popup application is still initializing', () => {
  /** An `onInit` that stays pending until the test settles it, one gate per call. */
  function gatedInit() {
    const gates: Array<{ resolve(): void; reject(error: Error): void }> = []
    const onInit = () => new Promise<void>((resolve, reject) => gates.push({ resolve, reject }))
    return { gates, onInit }
  }

  it('lets only the connection that is still current become READY', async () => {
    const { gates, onInit } = gatedInit()
    const { bridge, browser, booted } = setup({ onInit })
    const opening = bridge.open(definition, { init })
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    const runtime = booted[0]!.runtime
    const reconnected = vi.fn()
    runtime.onReconnect(reconnected)
    expect(runtime.state).toBe('INITIALIZING')

    // The page is restored from the back/forward cache: a replacement connection starts its own init.
    browser.popups[0]!.restore()
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    expect(runtime.state).toBe('INITIALIZING')

    // The first init finishes late. It belongs to a connection that no longer exists.
    gates[0]!.resolve()
    await new Promise(r => setTimeout(r, 30))
    expect(runtime.state).toBe('INITIALIZING')
    expect(reconnected).not.toHaveBeenCalled()
    expect(booted[0]!.runtime.sessionId).toBeDefined()

    gates[1]!.resolve()
    const session = await opening
    expect(runtime.state).toBe('READY')
    expect(session.state).toBe('READY')
    expect(reconnected).toHaveBeenCalledTimes(1)
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    await session.close()
  })

  it('does not tear down the replacement connection when the superseded init fails', async () => {
    const { gates, onInit } = gatedInit()
    const { bridge, browser, booted } = setup({ onInit })
    const opening = bridge.open(definition, { init })
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    const runtime = booted[0]!.runtime

    browser.popups[0]!.restore()
    await vi.waitFor(() => expect(gates).toHaveLength(2))

    gates[0]!.reject(new Error('stale init failed'))
    await new Promise(r => setTimeout(r, 30))
    expect(runtime.state).toBe('INITIALIZING')

    gates[1]!.resolve()
    const session = await opening
    expect(runtime.state).toBe('READY')
    expect(await session.call('asset.select', {})).toEqual({ assetIds: ['a1'] })
    await session.close()
  })
})
