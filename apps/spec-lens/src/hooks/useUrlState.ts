import { useCallback, useEffect, useState } from 'react'

export interface DashboardUrlState {
  view: 'timeline' | 'graph' | 'paths' | 'diff'
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

export interface UseUrlStateReturn {
  state: DashboardUrlState
  setView(view: DashboardUrlState['view'], push?: boolean): void
  setDiff(base: string, head: string, push?: boolean): void
  setRevision(revisionId: string, push?: boolean): void
  setFilters(filters: Partial<Pick<DashboardUrlState, 'search' | 'scope' | 'domain'>>, replace?: boolean): void
}

/**
 * Parses query parameters from URL search string into normalized DashboardUrlState.
 */
export function parseUrlState(searchStr: string): DashboardUrlState {
  const p = new URLSearchParams(searchStr.startsWith('?') ? searchStr : `?${searchStr}`)
  const rawView = p.get('view')
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

/**
 * Hook for bidirectional URL query state synchronization.
 * Supports browser popstate (back/forward), pushState for view navigation,
 * and replaceState for filter/search updates.
 */
export function useUrlState(): UseUrlStateReturn {
  const [state, setState] = useState<DashboardUrlState>(() => {
    if (typeof window === 'undefined') {
      return { view: 'timeline' }
    }
    return parseUrlState(window.location.search)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onPopState = () => {
      setState(parseUrlState(window.location.search))
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const setView = useCallback((view: DashboardUrlState['view'], push = true) => {
    const next: DashboardUrlState = {
      ...state,
      view,
    }
    if (view !== 'diff') {
      delete next.baseId
      delete next.headId
      delete next.base
      delete next.head
    }
    setState(next)
    if (typeof window !== 'undefined') {
      const url = serializeUrlState(next)
      if (push) {
        window.history.pushState(null, '', url)
      } else {
        window.history.replaceState(null, '', url)
      }
    }
  }, [state])

  const setDiff = useCallback((base: string, head: string, push = true) => {
    const next: DashboardUrlState = {
      ...state,
      view: 'diff',
      baseId: base,
      headId: head,
      base,
      head,
    }
    setState(next)
    if (typeof window !== 'undefined') {
      const url = serializeUrlState(next)
      if (push) {
        window.history.pushState(null, '', url)
      } else {
        window.history.replaceState(null, '', url)
      }
    }
  }, [state])

  const setRevision = useCallback((revisionId: string, push = true) => {
    const next: DashboardUrlState = {
      ...state,
      revisionId: revisionId || undefined,
      revision: revisionId || undefined,
    }
    if (!revisionId) {
      delete next.revisionId
      delete next.revision
    }
    setState(next)
    if (typeof window !== 'undefined') {
      const url = serializeUrlState(next)
      if (push) {
        window.history.pushState(null, '', url)
      } else {
        window.history.replaceState(null, '', url)
      }
    }
  }, [state])

  const setFilters = useCallback((
    filters: Partial<Pick<DashboardUrlState, 'search' | 'scope' | 'domain'>>,
    replace = true,
  ) => {
    const next: DashboardUrlState = {
      ...state,
      ...filters,
    }
    if (!next.search) delete next.search
    if (!next.scope) delete next.scope
    if (!next.domain) delete next.domain

    setState(next)
    if (typeof window !== 'undefined') {
      const url = serializeUrlState(next)
      if (replace) {
        window.history.replaceState(null, '', url)
      } else {
        window.history.pushState(null, '', url)
      }
    }
  }, [state])

  return {
    state,
    setView,
    setDiff,
    setRevision,
    setFilters,
  }
}
