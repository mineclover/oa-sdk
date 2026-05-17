import { describe, expect, it } from 'vitest'
import {
  buildNavItems,
  findRouteByPath,
  normalizePathname,
  routeForPath,
} from '../navigation/index.js'

describe('navigation routes', () => {
  it('normalizes path input for browser routing', () => {
    expect(normalizePathname('issues/')).toBe('/issues')
    expect(normalizePathname('/context?query=token')).toBe('/context')
    expect(normalizePathname('/docs#release')).toBe('/docs')
    expect(normalizePathname('/')).toBe('/')
  })

  it('resolves known routes and falls back to overview for unknown paths', () => {
    expect(findRouteByPath('/issues')?.id).toBe('issues')
    expect(findRouteByPath('/missing')).toBeUndefined()
    expect(routeForPath('/missing').id).toBe('overview')
  })

  it('marks a single active nav item', () => {
    const items = buildNavItems('/docs')
    expect(items.filter(item => item.active)).toHaveLength(1)
    expect(items.find(item => item.active)?.id).toBe('docs')
  })

  it('supports direct document page routes', () => {
    expect(findRouteByPath('/docs/DOC-05')?.id).toBe('docs')
    expect(routeForPath('/docs/DOC-05').id).toBe('docs')
  })

  it('supports direct issue detail routes', () => {
    expect(findRouteByPath('/issues/1452')?.id).toBe('issues')
    expect(routeForPath('/issues/1452').id).toBe('issues')
  })
})
