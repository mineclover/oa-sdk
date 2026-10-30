import { describe, expect, it, vi } from 'vitest'
import { BridgeError, createAttentionManager, parseAttentionRequest, type AttentionSource } from '../src/index.js'
import { createMemorySurface } from '../src/testing.js'

const source: AttentionSource = { sessionId: 's1', role: 'popup', origin: 'https://tools.example.com' }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function manager(options: Parameters<typeof createAttentionManager>[0] = {}, surface = createMemorySurface({ title: 'Host' })) {
  return {
    surface,
    manager: createAttentionManager({ surface, minIntervalMs: 0, blinkIntervalMs: 5, focusSettleMs: 1, ...options }),
  }
}

describe('request parsing', () => {
  it('keeps known fields and drops the rest', () => {
    expect(parseAttentionRequest({ id: 'a', intent: 'completed', effects: ['blink', 'blink'], urgency: 'high', extra: 1 })).toEqual({
      id: 'a',
      intent: 'completed',
      effects: ['blink'],
      urgency: 'high',
    })
  })

  it('rejects unknown effects, intents and malformed ids with INVALID_PARAMS', () => {
    for (const params of [{ id: 'a', effects: ['teleport'] }, { id: 'a', intent: 'shout' }, { id: '' }, { id: 'a', title: 5 }, 'text', null]) {
      expect(() => parseAttentionRequest(params)).toThrow(BridgeError)
      try {
        parseAttentionRequest(params)
      } catch (error) {
        expect((error as BridgeError).code).toBe('INVALID_PARAMS')
      }
    }
  })

  it('caps text that comes from another origin', () => {
    const parsed = parseAttentionRequest({ id: 'a', title: 'x'.repeat(1000), message: 'y'.repeat(5000) })
    expect(parsed.title).toHaveLength(120)
    expect(parsed.message).toHaveLength(500)
  })
})

describe('choosing effects from the page state', () => {
  it('shows only the in-page toast when the page is already in front', async () => {
    const onAttention = vi.fn()
    const { manager: m, surface } = manager({ onAttention }, createMemorySurface({ state: 'focused' }))
    const acknowledged = vi.fn()
    const result = await m.handle({ id: 'r1', intent: 'completed' }, source, acknowledged)
    expect(result).toMatchObject({ accepted: true, appliedEffects: ['toast'], visibility: 'focused' })
    expect(result.skipped).toEqual([{ effect: 'blink', reason: 'not-needed' }])
    expect(onAttention).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), expect.objectContaining({ visibility: 'focused', source }))
    expect(surface.title).toBe('Page')
    expect(acknowledged).toHaveBeenCalledWith('r1') // in front already: seen at once
  })

  it('blinks the title and marks the icon while the page is in the background, and stops on return', async () => {
    const { manager: m, surface } = manager({}, createMemorySurface({ state: 'hidden', title: 'Host' }))
    const acknowledged = vi.fn()
    const result = await m.handle({ id: 'r1', intent: 'completed', title: 'Export done' }, source, acknowledged)
    expect(result.appliedEffects).toEqual(['blink'])
    expect(result.skipped).toEqual([{ effect: 'toast', reason: 'unsupported' }])
    expect(surface.marked).toBe(true)
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      seen.add(surface.title)
      await sleep(4)
    }
    expect(seen).toEqual(new Set(['● Export done', 'Host']))
    expect(m.pending).toBe(1)
    expect(acknowledged).not.toHaveBeenCalled()

    surface.activate()
    expect(surface.title).toBe('Host')
    expect(surface.marked).toBe(false)
    expect(acknowledged).toHaveBeenCalledWith('r1')
    expect(m.pending).toBe(0)
    await sleep(15)
    expect(surface.title).toBe('Host') // the timer is gone
  })

  it('tries to focus on "return" and reports whether it worked', async () => {
    const { manager: m, surface } = manager({}, createMemorySurface({ state: 'hidden' }))
    const result = await m.handle({ id: 'r1', intent: 'return' }, source)
    expect(surface.focusCalls).toBe(1)
    expect(result).toMatchObject({ appliedEffects: ['focus'], focusObserved: true })
    expect(result.skipped).toEqual([{ effect: 'blink', reason: 'not-needed' }]) // focus worked, no fallback needed
  })

  it('falls back to blinking when the browser refuses to raise the window', async () => {
    const { manager: m, surface } = manager({}, createMemorySurface({ state: 'hidden', grantFocus: false }))
    const result = await m.handle({ id: 'r1', intent: 'return', title: 'Back to the editor' }, source)
    expect(result).toMatchObject({ appliedEffects: ['focus', 'blink'], focusObserved: false })
    expect(surface.title).toBe('● Back to the editor')
  })

  it('raises a system notification only with permission, and for input-needed or high urgency', async () => {
    const granted = manager({}, createMemorySurface({ state: 'hidden', notificationsPermitted: true }))
    const result = await granted.manager.handle({ id: 'r1', intent: 'input-needed', title: 'Pick a file', message: 'The popup waits' }, source)
    expect(result.appliedEffects).toContain('notification')
    expect(granted.surface.notifications).toEqual([{ title: 'Pick a file', body: 'The popup waits', tag: 's1' }])

    const denied = manager({}, createMemorySurface({ state: 'hidden', notificationsPermitted: false }))
    const refused = await denied.manager.handle({ id: 'r2', intent: 'input-needed' }, source)
    expect(refused.skipped).toContainEqual({ effect: 'notification', reason: 'unsupported' })

    const quiet = manager({}, createMemorySurface({ state: 'hidden', notificationsPermitted: true }))
    const completed = await quiet.manager.handle({ id: 'r3', intent: 'completed' }, source)
    expect(completed.appliedEffects).not.toContain('notification')
    const urgent = await quiet.manager.handle({ id: 'r4', intent: 'completed', urgency: 'high' }, source)
    expect(urgent.appliedEffects).toContain('notification')
  })

  it('honours an explicit effect hint and a custom selector', async () => {
    const hinted = manager({}, createMemorySurface({ state: 'hidden' }))
    expect((await hinted.manager.handle({ id: 'r1', effects: ['blink'] }, source)).appliedEffects).toEqual(['blink'])

    const selected = manager({ select: (_request, { defaults }) => defaults.filter(effect => effect !== 'blink') }, createMemorySurface({ state: 'hidden' }))
    const result = await selected.manager.handle({ id: 'r2', intent: 'completed' }, source)
    expect(result.appliedEffects).toEqual([])
    expect(selected.surface.title).toBe('Page')
  })
})

describe('policy', () => {
  it('refuses effects outside the allow list', async () => {
    const { manager: m, surface } = manager({ allow: ['blink'] }, createMemorySurface({ state: 'hidden' }))
    const result = await m.handle({ id: 'r1', intent: 'return' }, source)
    expect(surface.focusCalls).toBe(0)
    expect(result.skipped).toContainEqual({ effect: 'focus', reason: 'not-allowed' })
    expect(result.appliedEffects).toEqual(['blink'])
  })

  it('lets the page deny a request outright, per source', async () => {
    const authorize = vi.fn((_request: unknown, from: AttentionSource) => from.role !== 'popup')
    const { manager: m, surface } = manager({ authorize }, createMemorySurface({ state: 'hidden' }))
    const denied = await m.handle({ id: 'r1' }, source)
    expect(denied).toMatchObject({ accepted: false, reason: 'denied', appliedEffects: [] })
    expect(surface.marked).toBe(false)
    expect((await m.handle({ id: 'r2' }, { ...source, role: 'host' })).accepted).toBe(true)
  })

  it('limits how often one effect fires', async () => {
    const { manager: m } = manager({ minIntervalMs: 60_000 }, createMemorySurface({ state: 'hidden' }))
    expect((await m.handle({ id: 'r1', effects: ['blink'] }, source)).appliedEffects).toEqual(['blink'])
    const second = await m.handle({ id: 'r2', effects: ['blink'] }, source)
    expect(second).toMatchObject({ accepted: true, appliedEffects: [] })
    expect(second.skipped).toEqual([{ effect: 'blink', reason: 'rate-limited' }])
  })

  it('stops accepting requests beyond the per-minute budget', async () => {
    const { manager: m } = manager({ maxRequestsPerMinute: 2 }, createMemorySurface({ state: 'hidden' }))
    await m.handle({ id: 'r1' }, source)
    await m.handle({ id: 'r2' }, source)
    expect(await m.handle({ id: 'r3' }, source)).toMatchObject({ accepted: false, reason: 'rate-limited' })
  })

  it('rejects malformed requests as INVALID_PARAMS', async () => {
    const { manager: m } = manager()
    await expect(m.handle({ id: 'r1', effects: 'blink' }, source)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
  })

  it('stops everything once disposed', async () => {
    const { manager: m, surface } = manager({}, createMemorySurface({ state: 'hidden', title: 'Host' }))
    await m.handle({ id: 'r1', effects: ['blink'], title: 'x' }, source)
    m.dispose()
    expect(surface.title).toBe('Host')
    expect(await m.handle({ id: 'r2' }, source)).toMatchObject({ accepted: false, reason: 'unsupported' })
  })
})
