import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyUrlStatePatch,
  createUrlStateStore,
  getUrlStateStore,
  parseUrlState,
  serializeUrlState,
  useUrlState,
  type DashboardUrlState,
  type UrlStateWindow,
} from './useUrlState.js'

/** A window stub whose history writes move `location`, like a browser. */
function createFakeWindow(search = '', pathname = '/') {
  const location = { pathname, search }
  const listeners = new Set<() => void>()
  const moveTo = (url?: string | null) => {
    if (!url) return
    const next = new URL(url, 'http://spec-lens.test')
    location.pathname = next.pathname
    location.search = next.search
  }
  const win = {
    location,
    history: {
      pushState: vi.fn((_data: unknown, _unused: string, url?: string | null) => moveTo(url)),
      replaceState: vi.fn((_data: unknown, _unused: string, url?: string | null) => moveTo(url)),
    },
    addEventListener: vi.fn((_type: 'popstate', listener: () => void) => {
      listeners.add(listener)
    }),
    removeEventListener: vi.fn((_type: 'popstate', listener: () => void) => {
      listeners.delete(listener)
    }),
    /** Simulates the browser moving to `nextSearch` via back/forward. */
    popTo(nextSearch: string) {
      location.search = nextSearch
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  } satisfies UrlStateWindow & Record<string, unknown>
  return win
}

describe('parseUrlState', () => {
  it('defaults to timeline view for empty query string', () => {
    expect(parseUrlState('')).toEqual({ view: 'timeline' })
    expect(parseUrlState('?')).toEqual({ view: 'timeline' })
  })

  it('parses valid simple views (timeline, paths, graph)', () => {
    expect(parseUrlState('?view=paths')).toEqual({ view: 'paths' })
    expect(parseUrlState('?view=graph')).toEqual({ view: 'graph' })
    expect(parseUrlState('?view=timeline')).toEqual({ view: 'timeline' })
  })

  it('falls back to timeline for unknown view', () => {
    expect(parseUrlState('?view=unknownView')).toEqual({ view: 'timeline' })
  })

  it('parses diff view only when both base and head are present', () => {
    const diffState = parseUrlState('?view=diff&base=shaA&head=shaB')
    expect(diffState).toEqual({
      view: 'diff',
      baseId: 'shaA',
      headId: 'shaB',
      base: 'shaA',
      head: 'shaB',
    })
  })

  it('falls back to timeline if base or head is missing in diff view', () => {
    expect(parseUrlState('?view=diff&base=shaA')).toEqual({ view: 'timeline' })
    expect(parseUrlState('?view=diff&head=shaB')).toEqual({ view: 'timeline' })
    expect(parseUrlState('?view=diff')).toEqual({ view: 'timeline' })
  })

  it('accepts baseId and headId parameter aliases', () => {
    const state = parseUrlState('?view=diff&baseId=rev1&headId=rev2')
    expect(state).toEqual({
      view: 'diff',
      baseId: 'rev1',
      headId: 'rev2',
      base: 'rev1',
      head: 'rev2',
    })
  })

  it('parses revision parameter', () => {
    const state = parseUrlState('?view=graph&revision=feat-branch')
    expect(state).toEqual({
      view: 'graph',
      revisionId: 'feat-branch',
      revision: 'feat-branch',
    })
  })

  it('parses search, scope, and domain filters', () => {
    const state = parseUrlState('?view=paths&search=users&scope=public&domain=auth')
    expect(state).toEqual({
      view: 'paths',
      search: 'users',
      scope: 'public',
      domain: 'auth',
    })
  })

  it('decodes URL-encoded parameters properly', () => {
    const state = parseUrlState('?view=paths&search=%2Fapi%2Fv1%2Fusers%2F%7Bid%7D')
    expect(state.search).toBe('/api/v1/users/{id}')
  })

  it('parses scenario parameter', () => {
    const state = parseUrlState('?view=diff&base=a&head=b&scenario=spec-drift-triage')
    expect(state.scenario).toBe('spec-drift-triage')
    expect(state.view).toBe('diff')
  })
})

describe('serializeUrlState', () => {
  it('serializes default timeline to base pathname without query parameters', () => {
    expect(serializeUrlState({ view: 'timeline' }, '')).toBe('/')
    expect(serializeUrlState({ view: 'timeline' }, '/app')).toBe('/app')
  })

  it('serializes view parameter when not timeline', () => {
    expect(serializeUrlState({ view: 'paths' }, '/')).toBe('/?view=paths')
    expect(serializeUrlState({ view: 'graph' }, '')).toBe('?view=graph')
  })

  it('serializes diff view with base and head', () => {
    const serialized = serializeUrlState(
      { view: 'diff', baseId: 'abc', headId: 'def' },
      '/app',
    )
    expect(serialized).toBe('/app?view=diff&base=abc&head=def')
  })

  it('serializes graph view with revision', () => {
    const serialized = serializeUrlState(
      { view: 'graph', revisionId: 'main' },
      '',
    )
    expect(serialized).toBe('?view=graph&revision=main')
  })

  it('serializes active filters', () => {
    const serialized = serializeUrlState(
      { view: 'paths', search: 'users', scope: 'public', domain: 'identity' },
      '',
    )
    expect(serialized).toBe('?view=paths&search=users&scope=public&domain=identity')
  })

  it('omits undefined or empty filters', () => {
    const serialized = serializeUrlState(
      { view: 'paths', search: '', scope: undefined },
      '',
    )
    expect(serialized).toBe('?view=paths')
  })
})

describe('useUrlState Hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('initializes with timeline when window is undefined', () => {
    let capturedState: DashboardUrlState | null = null
    function Consumer() {
      const { state } = useUrlState()
      capturedState = state
      return createElement('div', { 'data-view': state.view }, state.view)
    }

    const html = renderToStaticMarkup(createElement(Consumer))
    expect(html).toContain('data-view="timeline"')
    expect(capturedState).toEqual({ view: 'timeline' })
  })

  it('initializes directly into diff view from window.location.search deep link', () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/',
        search: '?view=diff&base=commit1&head=commit2',
      },
      history: {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    let capturedState: DashboardUrlState | null = null
    function Consumer() {
      const { state } = useUrlState()
      capturedState = state
      return createElement(
        'div',
        { 'data-view': state.view },
        `${state.baseId}..${state.headId}`,
      )
    }

    const html = renderToStaticMarkup(createElement(Consumer))
    expect(html).toContain('data-view="diff"')
    expect(html).toContain('commit1..commit2')
    expect(capturedState).toEqual({
      view: 'diff',
      baseId: 'commit1',
      headId: 'commit2',
      base: 'commit1',
      head: 'commit2',
    })
  })

  it('triggers pushState for setView and setDiff, and replaceState for setFilters, composing on the latest state', () => {
    const pushState = vi.fn()
    const replaceState = vi.fn()

    vi.stubGlobal('window', {
      location: {
        pathname: '/',
        search: '',
      },
      history: {
        pushState,
        replaceState,
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    let actions: ReturnType<typeof useUrlState> | null = null
    function Consumer() {
      actions = useUrlState()
      return createElement('div')
    }

    renderToStaticMarkup(createElement(Consumer))
    expect(actions).not.toBeNull()

    // Setters captured from one render still build on the latest state (no stale closure).
    actions!.setView('paths', true)
    expect(pushState).toHaveBeenLastCalledWith(null, '', '/?view=paths')

    actions!.setDiff('commitA', 'commitB', true)
    expect(pushState).toHaveBeenLastCalledWith(null, '', '/?view=diff&base=commitA&head=commitB')

    actions!.setFilters({ search: 'users', scope: 'public' }, true)
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/?view=diff&base=commitA&head=commitB&search=users&scope=public',
    )

    actions!.setRevision('rev-123', true)
    expect(pushState).toHaveBeenLastCalledWith(
      null,
      '',
      '/?view=diff&base=commitA&head=commitB&revision=rev-123&search=users&scope=public',
    )

    // Leaving the diff view drops the diff ids.
    actions!.setView('graph', true)
    expect(pushState).toHaveBeenLastCalledWith(null, '', '/?view=graph&revision=rev-123&search=users&scope=public')
  })

  it('applies a multi-field update as one history entry', () => {
    const win = createFakeWindow('?view=diff&base=a&head=b')
    const store = createUrlStateStore(win)

    store.update({ view: 'paths', baseId: undefined, headId: undefined, scenario: 'endpoint-exploration' }, 'push')

    expect(win.history.pushState).toHaveBeenCalledTimes(1)
    expect(win.history.pushState).toHaveBeenCalledWith(null, '', '/?scenario=endpoint-exploration&view=paths')
    expect(store.getState()).toEqual({ view: 'paths', scenario: 'endpoint-exploration' })
  })

  it('does not add a history entry when an update leaves the URL unchanged', () => {
    const win = createFakeWindow('?view=graph')
    const store = createUrlStateStore(win)
    store.update({ view: 'graph' }, 'push')
    expect(win.history.pushState).not.toHaveBeenCalled()
  })

  it('shares one store per window, so every consumer sees updates made by any of them', () => {
    const win = createFakeWindow('')
    const a = getUrlStateStore(win)
    const b = getUrlStateStore(win)
    expect(a).toBe(b)
    expect(getUrlStateStore(createFakeWindow(''))).not.toBe(a)

    const seen: string[] = []
    const unsubscribe = b.subscribe(() => seen.push(b.getState().view))
    a.update({ view: 'paths' })
    expect(seen).toEqual(['paths'])
    expect(b.getState().view).toBe('paths')
    unsubscribe()
  })

  it('listens to popstate only while subscribed and re-reads the location on back/forward', () => {
    const win = createFakeWindow('?view=paths')
    const store = createUrlStateStore(win)
    expect(win.addEventListener).not.toHaveBeenCalled()

    const notified = vi.fn()
    const unsubscribe = store.subscribe(notified)
    expect(win.addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function))
    expect(win.listenerCount()).toBe(1)

    win.popTo('?view=graph&scenario=circular-ref-diagnostic')
    expect(notified).toHaveBeenCalledTimes(1)
    expect(store.getState()).toEqual({ view: 'graph', scenario: 'circular-ref-diagnostic' })

    unsubscribe()
    expect(win.removeEventListener).toHaveBeenCalledWith('popstate', win.addEventListener.mock.calls[0]![1])
    expect(win.listenerCount()).toBe(0)
  })
})

describe('applyUrlStatePatch', () => {
  it('removes keys patched to undefined or empty and keeps alias pairs in sync', () => {
    const prev = parseUrlState('?view=diff&base=a&head=b&revision=r&search=s')
    expect(applyUrlStatePatch(prev, { search: '', revisionId: undefined })).toEqual({
      view: 'diff',
      baseId: 'a',
      headId: 'b',
      base: 'a',
      head: 'b',
    })
    expect(applyUrlStatePatch(prev, { base: 'c' })).toMatchObject({ baseId: 'c', base: 'c' })
  })

  it('drops diff ids off the diff view and falls back to timeline for a diff without a pair', () => {
    expect(applyUrlStatePatch(parseUrlState('?view=diff&base=a&head=b'), { view: 'paths' })).toEqual({ view: 'paths' })
    expect(applyUrlStatePatch({ view: 'timeline' }, { view: 'diff' })).toEqual({ view: 'timeline' })
  })

  it('round-trips through serialize/parse', () => {
    const next = applyUrlStatePatch({ view: 'timeline' }, { view: 'diff', baseId: 'a', headId: 'b', scenario: 'x' })
    expect(parseUrlState(serializeUrlState(next, '').replace(/^[^?]*/, ''))).toEqual(next)
  })
})


