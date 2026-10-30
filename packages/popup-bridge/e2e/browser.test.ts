import type { BrowserContext, Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { call, newHostPage, openNested, openPopup, startHarness, waitFor, type Harness } from './harness.js'

let harness: Harness
let context: BrowserContext

beforeAll(async () => {
  harness = await startHarness()
})
afterAll(async () => {
  await harness?.close()
})
beforeEach(async () => {
  context = await harness.browser.newContext()
})
afterEach(async () => {
  await context.close()
})

const popupUrl = (query = '') => `${harness.popupOrigin}/asset-selector${query}`
const hostEval = <T>(host: Page, fn: () => T) => host.evaluate(fn)

describe('real browser: cross-origin popup', () => {
  it('opens, becomes READY and serves RPC both ways across origins', async () => {
    const host = await newHostPage(context, harness)
    const { popup, result } = await openPopup(context, host, { url: popupUrl() })
    expect(result).toEqual({ ok: true, index: 0 })
    expect(new URL(popup.url()).origin).toBe(harness.popupOrigin)
    expect(new URL(host.url()).origin).not.toBe(harness.popupOrigin)

    expect(await call(host, 0, 'asset.select', { multiple: true })).toEqual({ ok: true, value: { assetIds: ['a1', 'a2'] } })
    // Popup → host: the popup handler calls the host method over the reverse channel.
    expect(await call(host, 0, 'asset.readSelection')).toEqual({ ok: true, value: { text: 'selected words' } })
    expect(await popup.evaluate(() => (window as never as { __inits: unknown[] }).__inits)).toEqual([{ documentId: 'doc-123', locale: 'ko-KR' }])
  })

  it('negotiates optional features across origins and falls back for a popup that offers none', async () => {
    const host = await newHostPage(context, harness)
    const features = (index: number) => host.evaluate(i => (window as never as { __sessions: Array<{ features: { ids: string[] } }> }).__sessions[i]!.features.ids, index)

    const { popup, result } = await openPopup(context, host, { url: popupUrl('?features=x.b,x.a,x.c'), features: ['x.a', 'x.b', 'x.z'] })
    expect(result).toEqual({ ok: true, index: 0 })
    expect(await features(0)).toEqual(['x.a', 'x.b'])
    const popupSide = await popup.evaluate(() => (window as never as { __runtime: { features: { ids: string[] } } }).__runtime.features.ids)
    expect(popupSide.slice().sort()).toEqual(['x.a', 'x.b'])

    // A popup that predates features offers nothing: the session works on the baseline.
    const legacy = await openPopup(context, host, { url: popupUrl(), features: ['x.a'] })
    expect(legacy.result).toEqual({ ok: true, index: 1 })
    expect(await features(1)).toEqual([])
    expect(await call(host, 1, 'asset.select', { multiple: false })).toEqual({ ok: true, value: { assetIds: ['a1'] } })
  })

  it('answers an unregistered method with METHOD_NOT_FOUND', async () => {
    const host = await newHostPage(context, harness)
    await openPopup(context, host, { url: popupUrl() })
    expect(await call(host, 0, 'asset.nothing')).toMatchObject({ ok: false, code: 'METHOD_NOT_FOUND' })
  })

  it('waits for a slow popup page without losing the handshake', async () => {
    const host = await newHostPage(context, harness)
    const { result } = await openPopup(context, host, { url: popupUrl('?mode=slow') })
    expect(result).toMatchObject({ ok: true })
  })

  it('delivers events with revisions to the host', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl() })
    await host.evaluate(() => (window as never as { __subscribe(i: number, n: string): Promise<void> }).__subscribe(0, 'asset.selectionChanged'))
    await popup.evaluate(() => {
      const w = window as never as { __emit(ids: string[]): void }
      w.__emit(['a1'])
      w.__emit(['a1', 'a2'])
    })
    const events = await waitFor(
      () => host.evaluate(() => (window as never as { __events: Record<number, Array<{ revision: number; gap: boolean }>> }).__events[0] ?? []),
      list => list.length === 2,
    )
    expect(events.map(e => [e.revision, e.gap])).toEqual([[1, false], [2, false]])
  })

  it('refuses a popup that answers from another origin', async () => {
    const host = await newHostPage(context, harness)
    const { result } = await openPopup(context, host, { url: `${harness.rogueOrigin}/asset-selector`, expectedOrigin: harness.popupOrigin })
    expect(result).toMatchObject({ ok: false, code: 'ORIGIN_MISMATCH' })
    const events = await hostEval(host, () => (window as never as { __securityEvents: Array<{ type: string; origin?: string }> }).__securityEvents)
    expect(events).toContainEqual(expect.objectContaining({ type: 'origin-mismatch', origin: harness.rogueOrigin }))
  })

  it('has the popup refuse an unlisted host origin: nothing connects', async () => {
    const host = await newHostPage(context, harness)
    const { popup, result } = await openPopup(context, host, { url: popupUrl('?allow=https://other.example.com'), handshakeTimeoutMs: 800 })
    expect(result).toMatchObject({ ok: false, code: 'HANDSHAKE_TIMEOUT' })
    void popup
  })

  it('reports an init rejected by the popup application', async () => {
    const host = await newHostPage(context, harness)
    const { result } = await openPopup(context, host, { url: popupUrl('?mode=reject-init') })
    expect(result).toMatchObject({ ok: false, code: 'INIT_INVALID' })
  })

  it('reports missing required capabilities', async () => {
    const host = await newHostPage(context, harness)
    const { result } = await openPopup(context, host, { url: popupUrl('?mode=skip-save') })
    expect(result).toMatchObject({ ok: false, code: 'CAPABILITY_UNAVAILABLE' })
  })
})

describe('real browser: lifecycle', () => {
  it('fails in-flight calls and reconnects when the popup page reloads', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl() })
    await host.evaluate(() => (window as never as { __subscribe(i: number, n: string): Promise<void> }).__subscribe(0, 'asset.selectionChanged'))

    const inflight = call(host, 0, 'asset.save', { name: 'abc' })
    await waitFor(() => popup.evaluate(() => (window as never as { __saves: number }).__saves), saves => saves === 1)
    await popup.reload()
    expect(await inflight).toMatchObject({ ok: false, code: 'SESSION_CLOSED' })

    await waitFor(() => hostEval(host, () => (window as never as { __reconnects: Record<number, number> }).__reconnects[0]), n => n === 1)
    expect(await call(host, 0, 'asset.select', {})).toEqual({ ok: true, value: { assetIds: ['a1'] } })
    // The subscription was restored on the new page and starts a fresh revision sequence.
    await popup.evaluate(() => (window as never as { __emit(ids: string[]): void }).__emit(['x']))
    const events = await waitFor(
      () => host.evaluate(() => (window as never as { __events: Record<number, Array<{ revision: number }>> }).__events[0] ?? []),
      list => list.some(e => e.revision === 1),
    )
    expect(events.at(-1)).toMatchObject({ revision: 1 })
  })

  it('reports a reloaded popup as a reset instead of replaying a history that is gone', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl() })
    await host.evaluate(() => (window as never as { __subscribe(i: number, n: string): Promise<void> }).__subscribe(0, 'asset.progress'))
    await popup.evaluate(() => (window as never as { __emitProgress(n: number): void }).__emitProgress(3))
    await waitFor(
      () => host.evaluate(() => (window as never as { __events: Record<number, unknown[]> }).__events[0]?.length ?? 0),
      count => count === 3,
    )
    await popup.reload()
    await waitFor(() => hostEval(host, () => (window as never as { __reconnects: Record<number, number> }).__reconnects[0]), n => n === 1)
    const info = await hostEval(host, () => (window as never as { __reconnectInfo: Record<number, { replay: Record<string, unknown>; failed: string[] }> }).__reconnectInfo[0])
    expect(info?.failed).toEqual([])
    expect(info?.replay['asset.progress']).toMatchObject({ outcome: 'reset', replayed: 0 })
    await popup.evaluate(() => (window as never as { __emitProgress(n: number): void }).__emitProgress(1))
    const events = await waitFor(
      () => host.evaluate(() => (window as never as { __events: Record<number, Array<{ revision: number; gap: boolean; replayed: boolean }>> }).__events[0] ?? []),
      list => list.length === 4,
    )
    expect(events[3]).toMatchObject({ revision: 1, gap: false, replayed: false })
  })

  it('ends the session when the user closes the popup window', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl() })
    const inflight = call(host, 0, 'asset.save', { name: 'abc' })
    await waitFor(() => popup.evaluate(() => (window as never as { __saves: number }).__saves), saves => saves === 1)
    await popup.close()
    expect(await inflight).toMatchObject({ ok: false, code: 'SESSION_CLOSED' })
    const info = await waitFor(() => hostEval(host, () => (window as never as { __closeInfo: Record<number, unknown> }).__closeInfo[0]), value => value !== undefined)
    expect(info).toMatchObject({ reason: 'window-closed' })
  })

  it('tells the popup when the host closes the session (bridge.close crosses the port)', async () => {
    const host = await newHostPage(context, harness)
    // Keep the window open: the notice itself, not the window teardown, must reach the popup.
    const { popup } = await openPopup(context, host, { url: popupUrl(), closeWindowOnClose: false })
    await host.evaluate(() => (window as never as { __sessions: Array<{ close(): Promise<unknown> }> }).__sessions[0]!.close())
    const info = await waitFor(() => popup.evaluate(() => (window as never as { __closeInfo: unknown }).__closeInfo), value => value !== null)
    expect(info).toMatchObject({ reason: 'host-close' })
  })

  it('tells the popup when the host page reloads (pagehide notice)', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl() })
    await host.reload()
    const info = await waitFor(() => popup.evaluate(() => (window as never as { __closeInfo: unknown }).__closeInfo), value => value !== null, 8_000)
    // Either the pagehide notice crossed the port or the opener poll saw the old document go away.
    expect(info).toMatchObject({ reason: expect.stringMatching(/^(host-close|opener-gone)$/) })
  })

  it('keeps two concurrent popups isolated', async () => {
    const host = await newHostPage(context, harness)
    const first = await openPopup(context, host, { url: popupUrl(), init: { documentId: 'one', locale: 'en' } })
    const second = await openPopup(context, host, { url: popupUrl(), init: { documentId: 'two', locale: 'en' } })
    expect([first.result, second.result]).toEqual([{ ok: true, index: 0 }, { ok: true, index: 1 }])
    await host.evaluate(async () => {
      const w = window as never as { __subscribe(i: number, n: string): Promise<void> }
      await w.__subscribe(0, 'asset.selectionChanged')
      await w.__subscribe(1, 'asset.selectionChanged')
    })
    await second.popup.evaluate(() => (window as never as { __emit(ids: string[]): void }).__emit(['only-two']))
    const events = await waitFor(
      () => host.evaluate(() => (window as never as { __events: Record<number, unknown[]> }).__events),
      all => (all[1]?.length ?? 0) === 1,
    )
    expect(events[0]).toHaveLength(0)
    expect(await first.popup.evaluate(() => (window as never as { __inits: Array<{ documentId: string }> }).__inits[0]!.documentId)).toBe('one')
    expect(await second.popup.evaluate(() => (window as never as { __inits: Array<{ documentId: string }> }).__inits[0]!.documentId)).toBe('two')
  })
})

describe('real browser: known browser constraint', () => {
  it('cannot connect when the host sets Cross-Origin-Opener-Policy: same-origin', async () => {
    const host = await newHostPage(context, harness, '?coop=1')
    const { popup, result } = await openPopup(context, host, { url: popupUrl(), handshakeTimeoutMs: 1_500 })
    expect(result).toMatchObject({ ok: false })
    // The popup lost its opener reference, so it reports HOST_UNAVAILABLE instead of connecting.
    const code = await waitFor(() => popup.evaluate(() => (window as never as { __startError: string | null }).__startError), value => value !== null, 4_000)
    expect(code).toBe('HOST_UNAVAILABLE')
  })
})

describe('real browser: transfer, hung page, flood', () => {
  it('moves large buffers by transfer in both directions', async () => {
    const host = await newHostPage(context, harness)
    await openPopup(context, host, { url: popupUrl() })
    const size = 16 * 1024 * 1024
    const result = await host.evaluate(s => (window as never as { __transferTest(i: number, n: number): Promise<{ length: number; detachedAfter: number; downloaded: number }> }).__transferTest(0, s), size)
    expect(result).toEqual({ length: size, detachedAfter: 0, downloaded: size })
  })

  it('reports NOT_CLONEABLE when a result holds a function', async () => {
    const host = await newHostPage(context, harness)
    await openPopup(context, host, { url: popupUrl() })
    expect(await call(host, 0, 'asset.leak')).toMatchObject({ ok: false, code: 'NOT_CLONEABLE' })
  })

  it('ends the session quickly with PEER_UNRESPONSIVE when the popup page hangs', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl(), heartbeat: { intervalMs: 200, timeoutMs: 700 } })
    const startedAt = Date.now()
    await popup.evaluate(() => (window as never as { __hang(ms: number): void }).__hang(4_000))
    const inflight = call(host, 0, 'asset.select', {}, { timeoutMs: 30_000 })
    expect(await inflight).toMatchObject({ ok: false, code: 'PEER_UNRESPONSIVE' })
    expect(Date.now() - startedAt).toBeLessThan(3_000)
    const info = await waitFor(() => hostEval(host, () => (window as never as { __closeInfo: Record<number, unknown> }).__closeInfo[0]), value => value !== undefined)
    expect(info).toMatchObject({ code: 'PEER_UNRESPONSIVE' })
  })

  it('drops events beyond the host rate limit and reports it', async () => {
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl(), maxNotificationsPerSecond: 50 })
    await host.evaluate(() => (window as never as { __subscribe(i: number, n: string): Promise<void> }).__subscribe(0, 'asset.selectionChanged'))
    await popup.evaluate(() => (window as never as { __emitMany(n: number): void }).__emitMany(500))
    await new Promise(r => setTimeout(r, 500))
    const received = await host.evaluate(() => (window as never as { __events: Record<number, unknown[]> }).__events[0]!.length)
    expect(received).toBeGreaterThan(0)
    expect(received).toBeLessThanOrEqual(60)
    const events = await hostEval(host, () => (window as never as { __securityEvents: Array<{ type: string }> }).__securityEvents)
    expect(events.some(e => e.type === 'rate-limited')).toBe(true)
  })

  it('recovers the events the host rate limit dropped from the popup replay buffer, without a gap', async () => {
    type Seen = Array<{ revision: number; gap: boolean; replayed: boolean }>
    const host = await newHostPage(context, harness)
    const { popup } = await openPopup(context, host, { url: popupUrl(), maxNotificationsPerSecond: 50 })
    await host.evaluate(() => (window as never as { __subscribe(i: number, n: string): Promise<void> }).__subscribe(0, 'asset.progress'))
    await popup.evaluate(() => (window as never as { __emitProgress(n: number): void }).__emitProgress(150))
    const security = () => hostEval(host, () => (window as never as { __securityEvents: Array<{ type: string }> }).__securityEvents)
    await waitFor(security, list => list.some(e => e.type === 'rate-limited'))
    const events = () => host.evaluate(() => (window as never as { __events: Record<number, Seen> }).__events[0] ?? [])
    const live = (await waitFor(events, list => list.length > 0)).length
    expect(live).toBeLessThan(150)

    // The last events were dropped and no later one reveals it; resync finds them.
    const report = await host.evaluate(() => (window as never as { __resync(i: number): Promise<Record<string, { outcome: string }>> }).__resync(0))
    expect(report['asset.progress']).toMatchObject({ outcome: 'replayed', missed: 0 })
    const all = await events()
    expect(all.map(e => e.revision)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1))
    expect(all.some(e => e.gap)).toBe(false)
    expect(all.filter(e => e.replayed).length).toBe(150 - live)
  })
})


describe('real browser: a popup that opens a popup', () => {
  type Attention = {
    request(request?: unknown, options?: unknown): Promise<{ accepted: boolean; appliedEffects: string[]; skipped: { effect: string; reason: string }[]; focusObserved?: boolean; visibility?: string }>
    requestAndWait(request?: unknown, options?: unknown): Promise<{ result: { accepted: boolean }; acknowledged: boolean }>
    focus(): void
  }
  type Page_ = {
    __runtime: { host: { attention: Attention }; link: unknown }
    __sessionB: { attention: Attention }
    __node: { topology(options?: unknown): Promise<unknown>; links: unknown[] }
    __wait: Promise<unknown>
    __toasts: unknown[]
    __notifications: string[]
    __ownSelection(initial: string[]): void
    __owned: { get(): unknown; set(value: unknown): number }
    __replicate(): Promise<unknown>
    __replica: { get(): unknown; set(value: unknown): Promise<unknown> }
  }
  /** Makes the page behave as if another window had the user's focus. */
  const goToBackground = (page: Page) =>
    page.evaluate(() => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false })
    })
  const returnToPage = (page: Page) =>
    page.evaluate(() => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
      window.dispatchEvent(new Event('focus'))
    })

  async function openChain() {
    const host = await newHostPage(context, harness)
    const { popup: a, result } = await openPopup(context, host, { url: popupUrl('?mode=chain') })
    expect(result).toMatchObject({ ok: true })
    const leafUrl = `${harness.rogueOrigin}/asset-selector?mode=leaf&allow=${encodeURIComponent(harness.popupOrigin)}`
    const { child: b, result: opened } = await openNested(context, a, leafUrl)
    expect(opened).toEqual({ ok: true })
    expect(new Set([new URL(host.url()).origin, new URL(a.url()).origin, new URL(b.url()).origin]).size).toBe(3)
    return { host, a, b }
  }

  it('B asks its host A for attention: A blinks its tab title until the user returns, and B is told', async () => {
    const { a, b } = await openChain()
    await goToBackground(a)
    await b.evaluate(() => {
      (window as unknown as Page_).__wait = (window as unknown as Page_).__runtime.host.attention.requestAndWait({ intent: 'input-needed', title: 'Pick a file' }, { acknowledgeTimeoutMs: 15_000 })
    })

    const titles = new Set<string>()
    await waitFor(
      async () => {
        titles.add(await a.evaluate(() => document.title))
        return titles
      },
      seen => seen.has('● Pick a file') && seen.has('popup-loaded'),
    )
    expect(await a.evaluate(() => (window as unknown as Page_).__toasts)).toEqual([{ intent: 'input-needed', visibility: 'visible' }])

    await returnToPage(a)
    expect(await b.evaluate(() => (window as unknown as Page_).__wait)).toMatchObject({ result: { accepted: true }, acknowledged: true })
    expect(await a.evaluate(() => document.title)).toBe('popup-loaded')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(await a.evaluate(() => document.title)).toBe('popup-loaded') // the blink stopped for good
  })

  it('A asks its popup B to come forward: B tries window.focus() and reports that the browser did not move it', async () => {
    const { a, b } = await openChain()
    await b.evaluate(() => {
      ;(window as unknown as { __focusCalls: number }).__focusCalls = 0
      window.focus = () => {
        ;(window as unknown as { __focusCalls: number }).__focusCalls++
      }
    })
    await goToBackground(b)
    const result = await a.evaluate(() => (window as unknown as Page_).__sessionB.attention.request({ intent: 'return', title: 'Back to B' }))
    expect(result).toMatchObject({ accepted: true, appliedEffects: ['focus', 'blink'], focusObserved: false, visibility: 'visible' })
    expect(await b.evaluate(() => (window as unknown as { __focusCalls: number }).__focusCalls)).toBe(1)
  })

  it('shows a system notification on the host when the user allowed notifications', async () => {
    const { a, b } = await openChain()
    // Headless Chromium cannot show a system notification; stand in for the API the page would use,
    // with the permission the user would have granted.
    await a.evaluate(() => {
      const shown: string[] = []
      ;(window as unknown as Page_).__notifications = shown
      class GrantedNotification {
        static readonly permission = 'granted'
        constructor(title: string) {
          shown.push(title)
        }
      }
      Object.defineProperty(window, 'Notification', { configurable: true, value: GrantedNotification })
    })
    await goToBackground(a)
    const result = await b.evaluate(() => (window as unknown as Page_).__runtime.host.attention.request({ intent: 'input-needed', title: 'Needs you', message: 'The popup is waiting' }))
    expect(result.appliedEffects).toContain('notification')
    expect(await a.evaluate(() => (window as unknown as Page_).__notifications)).toEqual(['Needs you'])
  })

  it('raises either window directly across three origins without a cross-origin error', async () => {
    const { a, b } = await openChain()
    // `window.opener.focus()` and `popup.focus()` are among the calls browsers allow across origins.
    expect(await b.evaluate(() => ((window as unknown as Page_).__runtime.host.attention.focus(), 'ok'))).toBe('ok') // B → A
    expect(await a.evaluate(() => ((window as unknown as Page_).__sessionB.attention.focus(), 'ok'))).toBe('ok') // A → B
    expect(await a.evaluate(() => ((window as unknown as Page_).__runtime.host.attention.focus(), 'ok'))).toBe('ok') // A → root
  })

  it('maps the whole window tree from the root, and a child can see its siblings through its host', async () => {
    const { host, b } = await openChain()
    const tree = (await host.evaluate(() => (window as unknown as Page_).__node.topology({ depth: 3 }))) as {
      name: string
      links: { role: string; peerOrigin: string; node?: { name: string; links: { role: string; peerOrigin: string; node?: { name: string } }[] } }[]
    }
    expect(tree.name).toBe('root')
    expect(tree.links).toHaveLength(1)
    expect(tree.links[0]).toMatchObject({ role: 'popup', peerOrigin: harness.popupOrigin, node: { name: 'chain' } })
    expect(tree.links[0]!.node!.links).toEqual([
      expect.objectContaining({ role: 'host', peerOrigin: harness.hostOrigin }),
      expect.objectContaining({ role: 'popup', peerOrigin: harness.rogueOrigin, node: expect.objectContaining({ name: 'leaf' }) }),
    ])
    const seenByB = (await b.evaluate(() => ((window as unknown as Page_).__runtime.link as { call(m: string, p: unknown): Promise<unknown> }).call('bridge.topology', { depth: 2 }))) as { name: string; links: unknown[] }
    expect(seenByB.name).toBe('chain')
    expect(seenByB.links).toHaveLength(2)
  })

  it('shares state: the root owns it and A writes; A owns another and B follows it', async () => {
    const { host, a, b } = await openChain()
    await host.evaluate(() => (window as unknown as Page_).__ownSelection(['root']))
    expect(await a.evaluate(() => (window as unknown as Page_).__replicate())).toEqual({ value: { ids: ['root'] }, revision: 0 })
    await a.evaluate(() => (window as unknown as Page_).__replica.set({ ids: ['picked-in-a'] }))
    expect(await host.evaluate(() => (window as unknown as Page_).__owned.get())).toEqual({ value: { ids: ['picked-in-a'] }, revision: 1 })

    await a.evaluate(() => {
      // A is a separate page: its owned state is independent of the root's.
      (window as unknown as Page_).__ownSelection(['a-seed'])
    })
    expect(await b.evaluate(() => (window as unknown as Page_).__replicate())).toEqual({ value: { ids: ['a-seed'] }, revision: 0 })
    await a.evaluate(() => (window as unknown as Page_).__owned.set({ ids: ['a-changed'] }))
    const followed = await waitFor(
      () => b.evaluate(() => (window as unknown as Page_).__replica.get() as { revision: number; value: { ids: string[] } }),
      snapshot => snapshot.revision === 1,
    )
    expect(followed.value).toEqual({ ids: ['a-changed'] })
  })

  it('drops the link when B closes', async () => {
    const { a, b } = await openChain()
    expect(await a.evaluate(() => (window as unknown as Page_).__node.links.length)).toBe(2)
    await b.close()
    await waitFor(() => a.evaluate(() => (window as unknown as Page_).__node.links.length), count => count === 1)
  })
})
