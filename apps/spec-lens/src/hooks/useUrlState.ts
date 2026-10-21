import { useMemo, useState, useSyncExternalStore } from 'react'

export interface DashboardUrlState {
  view: 'timeline' | 'graph' | 'paths' | 'diff'
  scenario?: string
  baseId?: string
  headId?: string
  revisionId?: string
  base?: string
  head?: string
  revision?: string
  search?: string
  scope?: string
  domain?: string
}

/**
 * A change to apply to the URL state. A key set to `undefined` (or `''`) removes
 * that parameter; keys that are absent are left as they are.
 */
export type DashboardUrlPatch = Partial<DashboardUrlState>

/** `push` adds a browser history entry; `replace` rewrites the current one. */
export type UrlHistoryMode = 'push' | 'replace'

export interface UseUrlStateReturn {
  state: DashboardUrlState
  /** Applies a patch atomically on top of the latest state and writes history once. */
  update(patch: DashboardUrlPatch, mode?: UrlHistoryMode): void
  setView(view: DashboardUrlState['view'], push?: boolean): void
  setDiff(base: string, head: string, push?: boolean): void
  setRevision(revisionId: string, push?: boolean): void
  setScenario(scenarioId?: string, push?: boolean): void
  setFilters(filters: Partial<Pick<DashboardUrlState, 'search' | 'scope' | 'domain'>>, replace?: boolean): void
}

/**
 * Parses query parameters from URL search string into normalized DashboardUrlState.
 */
export function parseUrlState(searchStr: string): DashboardUrlState {
  const p = new URLSearchParams(searchStr.startsWith('?') ? searchStr : `?${searchStr}`)
  const rawView = p.get('view')
  const scenario = p.get('scenario') ?? undefined
  const base = p.get('base') ?? p.get('baseId') ?? undefined
  const head = p.get('head') ?? p.get('headId') ?? undefined
  const revision = p.get('revision') ?? p.get('revisionId') ?? undefined
  const search = p.get('search') ?? undefined
  const scope = p.get('scope') ?? undefined
  const domain = p.get('domain') ?? undefined

  let view: DashboardUrlState['view'] = 'timeline'
  if (rawView === 'diff') {
    // Only diff view if both base and head are present
    if (base && head) {
      view = 'diff'
    } else {
      view = 'timeline'
    }
  } else if (rawView === 'graph' || rawView === 'paths' || rawView === 'timeline') {
    view = rawView
  }

  const result: DashboardUrlState = { view }

  if (scenario) {
    result.scenario = scenario
  }
  if (view === 'diff' && base && head) {
    result.baseId = base
    result.headId = head
    result.base = base
    result.head = head
  }
  if (revision) {
    result.revisionId = revision
    result.revision = revision
  }
  if (search) {
    result.search = search
  }
  if (scope) {
    result.scope = scope
  }
  if (domain) {
    result.domain = domain
  }

  return result
}

/**
 * Serializes DashboardUrlState into a URL query path string.
 */
export function serializeUrlState(
  state: DashboardUrlState,
  pathname = typeof window !== 'undefined' ? window.location.pathname : '',
): string {
  const p = new URLSearchParams()
  if (state.scenario) {
    p.set('scenario', state.scenario)
  }
  if (state.view !== 'timeline') {
    p.set('view', state.view)
  }
  const base = state.baseId ?? state.base
  const head = state.headId ?? state.head
  if (state.view === 'diff' && base && head) {
    p.set('base', base)
    p.set('head', head)
  }
  const revision = state.revisionId ?? state.revision
  if (revision) {
    p.set('revision', revision)
  }
  if (state.search) {
    p.set('search', state.search)
  }
  if (state.scope) {
    p.set('scope', state.scope)
  }
  if (state.domain) {
    p.set('domain', state.domain)
  }

  const query = p.toString()
  const basePrefix = pathname || ''
  return query ? `${basePrefix}?${query}` : (basePrefix || '/')
}

type AliasKey = 'baseId' | 'base' | 'headId' | 'head' | 'revisionId' | 'revision'
type AliasPair = readonly [AliasKey, AliasKey]
const ALIAS_PAIRS: readonly AliasPair[] = [
  ['baseId', 'base'],
  ['headId', 'head'],
  ['revisionId', 'revision'],
]
const PLAIN_KEYS = ['scenario', 'search', 'scope', 'domain'] as const

/**
 * Applies a patch to a URL state and normalizes the result the same way
 * `parseUrlState` would read it back: alias pairs (`baseId`/`base`, ...) stay
 * in sync, empty values are removed, and the diff ids only survive on a `diff`
 * view that has both of them (a diff without a pair falls back to `timeline`).
 */
export function applyUrlStatePatch(prev: DashboardUrlState, patch: DashboardUrlPatch): DashboardUrlState {
  const next: DashboardUrlState = { ...prev, view: patch.view ?? prev.view }

  for (const key of PLAIN_KEYS) {
    if (!(key in patch)) continue
    const value = patch[key]
    if (value) next[key] = value
    else delete next[key]
  }

  for (const [canonical, alias] of ALIAS_PAIRS) {
    if (!(canonical in patch) && !(alias in patch)) continue
    const value = patch[canonical] ?? patch[alias]
    if (typeof value === 'string' && value) {
      next[canonical] = value
      next[alias] = value
    } else {
      delete next[canonical]
      delete next[alias]
    }
  }

  const hasDiffPair = Boolean((next.baseId ?? next.base) && (next.headId ?? next.head))
  if (next.view === 'diff' && !hasDiffPair) {
    next.view = 'timeline'
  }
  if (next.view !== 'diff') {
    delete next.baseId
    delete next.headId
    delete next.base
    delete next.head
  }
  return next
}

/** The slice of `window` the URL state store needs (stubbable in tests). */
export interface UrlStateWindow {
  location: { pathname: string; search: string }
  history: {
    pushState(data: unknown, unused: string, url?: string | null): void
    replaceState(data: unknown, unused: string, url?: string | null): void
  }
  addEventListener(type: 'popstate', listener: () => void): void
  removeEventListener(type: 'popstate', listener: () => void): void
}

/**
 * One observable mirror of the page URL. Every component reading the URL
 * subscribes to the same store, so an update made by one of them (or a
 * browser back/forward) is seen by all of them.
 */
export interface UrlStateStore {
  getState(): DashboardUrlState
  subscribe(listener: () => void): () => void
  /** Applies a patch to the latest state, writes history once, and notifies subscribers. */
  update(patch: DashboardUrlPatch, mode?: UrlHistoryMode): DashboardUrlState
}

export function createUrlStateStore(win?: UrlStateWindow): UrlStateStore {
  let state: DashboardUrlState = win ? parseUrlState(win.location.search) : { view: 'timeline' }
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const syncFromLocation = () => {
    if (!win) return
    const fromLocation = parseUrlState(win.location.search)
    if (serializeUrlState(fromLocation, '') !== serializeUrlState(state, '')) {
      state = fromLocation
      notify()
    }
  }

  const onPopState = () => {
    syncFromLocation()
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1 && win) {
        win.addEventListener('popstate', onPopState)
        // The location may have moved while nobody was listening.
        syncFromLocation()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && win) {
          win.removeEventListener('popstate', onPopState)
        }
      }
    },
    update(patch, mode = 'push') {
      const next = applyUrlStatePatch(state, patch)
      const pathname = win?.location.pathname ?? ''
      const nextUrl = serializeUrlState(next, pathname)
      if (nextUrl === serializeUrlState(state, pathname)) {
        return state
      }
      state = next
      if (win) {
        if (mode === 'push') {
          win.history.pushState(null, '', nextUrl)
        } else {
          win.history.replaceState(null, '', nextUrl)
        }
      }
      notify()
      return state
    },
  }
}

const sharedStores = new WeakMap<UrlStateWindow, UrlStateStore>()

function currentWindow(): UrlStateWindow | undefined {
  return typeof window === 'undefined' ? undefined : window
}

/**
 * The store for a window. All callers for the same window share one store, so
 * the URL has a single source of truth however many components read it. Without
 * a window (SSR) a detached store with the default state is returned.
 */
export function getUrlStateStore(win: UrlStateWindow | undefined = currentWindow()): UrlStateStore {
  if (!win) return createUrlStateStore()
  let store = sharedStores.get(win)
  if (!store) {
    store = createUrlStateStore(win)
    sharedStores.set(win, store)
  }
  return store
}

function historyMode(push: boolean): UrlHistoryMode {
  return push ? 'push' : 'replace'
}

/**
 * Hook for bidirectional URL query state synchronization.
 * Supports browser popstate (back/forward), pushState for view navigation,
 * and replaceState for filter/search updates. Every caller shares the window's
 * store, and setters always build on the latest state, never a render's snapshot.
 */
export function useUrlState(): UseUrlStateReturn {
  const [store] = useState(() => getUrlStateStore())
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)

  const actions = useMemo(() => {
    const update = (patch: DashboardUrlPatch, mode: UrlHistoryMode = 'push') => {
      store.update(patch, mode)
    }
    return {
      update,
      setView: (view: DashboardUrlState['view'], push = true) => update({ view }, historyMode(push)),
      setDiff: (base: string, head: string, push = true) =>
        update({ view: 'diff', baseId: base, headId: head }, historyMode(push)),
      setRevision: (revisionId: string, push = true) =>
        update({ revisionId: revisionId || undefined }, historyMode(push)),
      setScenario: (scenarioId?: string, push = true) =>
        update({ scenario: scenarioId || undefined }, historyMode(push)),
      setFilters: (
        filters: Partial<Pick<DashboardUrlState, 'search' | 'scope' | 'domain'>>,
        replace = true,
      ) => update(filters, replace ? 'replace' : 'push'),
    }
  }, [store])

  return { state, ...actions }
}
