import { describe, expect, it } from 'vitest'

import {
  ROUTE_DEFINITIONS,
  buildNavigationItems,
  routeForPath,
  normalizePathname,
} from '../navigation/index.js'

describe('pathname normalization', () => {
  it('adds a leading slash, trims, removes query/hash, and collapses slashes', () => {
    expect(normalizePathname('  issues  ')).toBe('/issues')
    expect(normalizePathname('///issues///overview/?a=1#top')).toBe('/issues/overview')
    expect(normalizePathname('/')).toBe('/')
  })
})

describe('route lookup', () => {
  it('finds overview for unknown paths', () => {
    expect(routeForPath('/not-found')).toEqual(ROUTE_DEFINITIONS[0])
    expect(routeForPath('/settings/anything?mode=edit')).toEqual(ROUTE_DEFINITIONS.at(4))
  })
})

describe('navigation items', () => {
  it('marks only the active route when the current location is nested', () => {
    const items = buildNavigationItems('/issues/123/comments')

    expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['issues'])
    expect(items.find((item) => item.id === 'issues')?.active).toBe(true)
    expect(items.find((item) => item.id === 'overview')?.active).toBe(false)
    expect(items.find((item) => item.id === 'docs')?.active).toBe(false)
  })

  it('keeps nested document edit pages under the docs route', () => {
    expect(routeForPath('/docs/DOC-01').id).toBe('docs')
    expect(buildNavigationItems('/docs/DOC-01').find((item) => item.id === 'docs')?.active).toBe(true)
  })

  it('keeps nested issue detail pages under the issues route', () => {
    expect(routeForPath('/issues/1452').id).toBe('issues')
    expect(buildNavigationItems('/issues/1452').find((item) => item.id === 'issues')?.active).toBe(true)
  })

  it('falls back to overview for unknown paths', () => {
    const items = buildNavigationItems('/mystery')

    expect(items.filter((item) => item.active).map((item) => item.id)).toEqual(['overview'])
  })
})
