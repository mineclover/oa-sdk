import { describe, expect, it } from 'vitest'
import { matchRoute as indexedMatchRoute } from '../route-match.js'
import type { HttpMethod, MatchResult, RouteIndex } from '../types.js'
import { linearMatchRoute } from './support/linear-route-match.js'
import { createOperationEntry, createRouteIndex } from './support/route-corpus.js'

type RouteSpec = readonly [string, readonly HttpMethod[]]
type Matcher = (index: RouteIndex, method: HttpMethod, urlPath: string) => MatchResult

function params(result: MatchResult): Array<[string, string]> {
  if (result.type !== 'found') throw new Error(`expected found, got ${result.type}`)
  return Object.entries(result.pathParams)
}

// The same expectations run against the linear reference, which shows they pin
// the matcher's established behavior rather than the new implementation's.
const MATCHERS: ReadonlyArray<readonly [string, Matcher]> = [
  ['indexed matchRoute', indexedMatchRoute],
  ['linear reference matcher', linearMatchRoute],
]

describe.each(MATCHERS)('%s', (_, matchRoute) => {
  function winner(routes: readonly RouteSpec[], urlPath: string, method: HttpMethod = 'get'): string | undefined {
    const result = matchRoute(createRouteIndex(routes), method, urlPath)
    return result.type === 'found' ? result.entry.openApiPath : undefined
  }

  describe('precedence', () => {
    it('a concrete path beats a templated path regardless of declaration order', () => {
      const templated: RouteSpec = ['/users/{id}', ['get']]
      const concrete: RouteSpec = ['/users/me', ['get']]
      expect(winner([templated, concrete], '/users/me')).toBe('/users/me')
      expect(winner([concrete, templated], '/users/me')).toBe('/users/me')
      expect(winner([templated, concrete], '/users/42')).toBe('/users/{id}')
    })

    it('checks the method only on the winning path', () => {
      const index = createRouteIndex([
        ['/users/{id}', ['get', 'delete']],
        ['/users/me', ['post', 'put']],
      ])
      expect(matchRoute(index, 'get', '/users/me')).toEqual({ type: 'method_not_allowed', allowed: ['post', 'put'] })
      const found = matchRoute(index, 'put', '/users/me')
      expect(found.type === 'found' && found.entry.openApiPath).toBe('/users/me')
    })

    it('a literal segment earlier in the path wins over one later in the path', () => {
      const routes: RouteSpec[] = [
        ['/{org}/users/{id}', ['get']],
        ['/acme/{team}/{id}', ['get']],
      ]
      expect(winner(routes, '/acme/users/1')).toBe('/acme/{team}/{id}')
      expect(winner([...routes].reverse(), '/acme/users/1')).toBe('/acme/{team}/{id}')
    })

    it('with equal segment kinds, fewer template expressions win', () => {
      const routes: RouteSpec[] = [
        ['/files/{name}.{ext}', ['get']],
        ['/files/{file}', ['get']],
      ]
      expect(winner(routes, '/files/report.pdf')).toBe('/files/{file}')
      expect(winner([...routes].reverse(), '/files/report.pdf')).toBe('/files/{file}')
    })

    it('with equal expression counts, more literal characters win', () => {
      const routes: RouteSpec[] = [
        ['/files/{file}', ['get']],
        ['/files/{name}.json', ['get']],
      ]
      expect(winner(routes, '/files/data.json')).toBe('/files/{name}.json')
      expect(winner(routes, '/files/data.xml')).toBe('/files/{file}')
    })

    it('fully tied templates resolve by declaration order', () => {
      expect(winner([['/items/{id}', ['get']], ['/items/{key}', ['get']]], '/items/1')).toBe('/items/{id}')
      expect(winner([['/items/{key}', ['get']], ['/items/{id}', ['get']]], '/items/1')).toBe('/items/{key}')
    })

    it('templates with different segment counts never compete', () => {
      const routes: RouteSpec[] = [
        ['/a/{x}', ['get']],
        ['/a/{x}/b', ['get']],
      ]
      expect(winner(routes, '/a/1')).toBe('/a/{x}')
      expect(winner(routes, '/a/1/b')).toBe('/a/{x}/b')
      expect(winner(routes, '/a/1/c')).toBeUndefined()
    })

    it('keeps the legacy ranking of expression names that contain "/"', () => {
      // Segment kinds come from splitting the raw template on "/", so "{a/b}" is
      // counted as two literal segments and outranks the one-segment "/cafe".
      // Pinned so that any change to this quirk is deliberate.
      expect(winner([['/cafe', ['get']], ['/{a/b}', ['get']]], '/cafe')).toBe('/{a/b}')
    })
  })

  describe('path semantics', () => {
    it('treats trailing slashes and empty segments literally', () => {
      const index = createRouteIndex([
        ['/users', ['get']],
        ['/users/{id}', ['get']],
        ['/teams/', ['get']],
      ])
      expect(matchRoute(index, 'get', '/users/').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/teams').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/teams/').type).toBe('found')
      expect(matchRoute(index, 'get', '//users').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/users//').type).toBe('not_found')
    })

    it('is case-sensitive', () => {
      const index = createRouteIndex([['/users/{id}', ['get']]])
      expect(matchRoute(index, 'get', '/Users/1').type).toBe('not_found')
    })

    it('returns parameters raw, without percent-decoding or query stripping', () => {
      const index = createRouteIndex([['/users/{id}', ['get']], ['/caf%C3%A9', ['get']]])
      expect(params(matchRoute(index, 'get', '/users/a%2Fb'))).toEqual([['id', 'a%2Fb']])
      expect(params(matchRoute(index, 'get', '/users/caf%C3%A9'))).toEqual([['id', 'caf%C3%A9']])
      expect(params(matchRoute(index, 'get', '/users/1?expand=true'))).toEqual([['id', '1?expand=true']])
      expect(matchRoute(index, 'get', '/café').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/caf%C3%A9').type).toBe('found')
    })

    it('splits multi-expression segments greedily from the left', () => {
      const index = createRouteIndex([
        ['/files/{name}.{ext}', ['get']],
        ['/pair/{a}{b}', ['get']],
        ['/range/{from}-{to}', ['get']],
      ])
      expect(params(matchRoute(index, 'get', '/files/archive.tar.gz'))).toEqual([['name', 'archive.tar'], ['ext', 'gz']])
      expect(params(matchRoute(index, 'get', '/pair/xyz'))).toEqual([['a', 'xy'], ['b', 'z']])
      expect(params(matchRoute(index, 'get', '/range/1-2-3'))).toEqual([['from', '1-2'], ['to', '3']])
      expect(matchRoute(index, 'get', '/files/noext').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/files/.gz').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/pair/x').type).toBe('not_found')
    })

    it('matches partial-segment expressions with literal prefixes and suffixes', () => {
      const index = createRouteIndex([['/v{version}/status', ['get']], ['/v{version}/{id}.json', ['get']]])
      expect(params(matchRoute(index, 'get', '/v2/status'))).toEqual([['version', '2']])
      expect(params(matchRoute(index, 'get', '/v2/a.b.json'))).toEqual([['version', '2'], ['id', 'a.b']])
      expect(matchRoute(index, 'get', '/v/status').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/v2/.json').type).toBe('not_found')
    })

    it('does not treat regex metacharacters in literals as patterns', () => {
      const index = createRouteIndex([['/files.v1/{id}', ['get']], ['/a+b/(x)/[0]/*', ['get']]])
      expect(matchRoute(index, 'get', '/files.v1/42').type).toBe('found')
      expect(matchRoute(index, 'get', '/filesXv1/42').type).toBe('not_found')
      expect(matchRoute(index, 'get', '/a+b/(x)/[0]/*').type).toBe('found')
      expect(matchRoute(index, 'get', '/aab/(x)/[0]/*').type).toBe('not_found')
    })

    it('assigns repeated parameter names last-wins', () => {
      const index = createRouteIndex([['/{id}/x/{id}', ['get']]])
      expect(params(matchRoute(index, 'get', '/1/x/2'))).toEqual([['id', '2']])
    })

    it('stores parameter names as own keys of a fresh null-prototype record per call', () => {
      const index = createRouteIndex([['/{__proto__}/{constructor}', ['get']]])
      const first = matchRoute(index, 'get', '/a/b')
      expect(params(first)).toEqual([['__proto__', 'a'], ['constructor', 'b']])
      if (first.type !== 'found') throw new Error('expected found')
      expect(Object.getPrototypeOf(first.pathParams)).toBeNull()
      first.pathParams.extra = 'mutated'
      const second = matchRoute(index, 'get', '/a/b')
      expect(params(second)).toEqual([['__proto__', 'a'], ['constructor', 'b']])
    })

    it('returns an empty parameter record for concrete paths', () => {
      const index = createRouteIndex([['/health', ['get']]])
      expect(params(matchRoute(index, 'get', '/health'))).toEqual([])
    })
  })

  describe('route index changes after the first match', () => {
    function winnerIn(index: RouteIndex, urlPath: string): string | undefined {
      const result = matchRoute(index, 'get', urlPath)
      return result.type === 'found' ? result.entry.openApiPath : undefined
    }

    it('sees routes added after the first match', () => {
      const index = createRouteIndex([['/users/{id}', ['get']]])
      expect(matchRoute(index, 'get', '/teams/1').type).toBe('not_found')
      index.set('/teams/{id}', new Map([['get', createOperationEntry('/teams/{id}', 'get')]]))
      expect(matchRoute(index, 'get', '/teams/1').type).toBe('found')
    })

    it('drops routes removed after the first match', () => {
      const index = createRouteIndex([['/users/{id}', ['get']], ['/users/me', ['get']]])
      expect(matchRoute(index, 'get', '/users/me').type).toBe('found')
      index.delete('/users/me')
      const result = matchRoute(index, 'get', '/users/me')
      expect(result.type === 'found' && result.entry.openApiPath).toBe('/users/{id}')
    })

    // Same-size changes defeat a size-based staleness check. In these cases the
    // first request after the change is not a hit on a removed path (the first
    // case runs in both orders), so noticing a removed winner is not enough.
    function replaceRoute(index: RouteIndex, removed: string, added: string): void {
      index.delete(removed)
      index.set(added, new Map([['get', createOperationEntry(added, 'get')]]))
    }

    it.each([
      ['removed winner first', ['/users/me', '/users/1/posts']],
      ['added path first', ['/users/1/posts', '/users/me']],
    ])('sees a path replaced by another at the same size (%s)', (_, requests) => {
      const index = createRouteIndex([['/users/me', ['get']], ['/users/{id}', ['get']]])
      expect(winnerIn(index, '/users/me')).toBe('/users/me')
      replaceRoute(index, '/users/me', '/users/{id}/posts')
      const expected: Record<string, string> = { '/users/me': '/users/{id}', '/users/1/posts': '/users/{id}/posts' }
      for (const urlPath of requests) expect(winnerIn(index, urlPath)).toBe(expected[urlPath])
    })

    it('sees a new path that replaced one the requests never matched', () => {
      const index = createRouteIndex([['/users/{id}', ['get']], ['/old', ['get']]])
      expect(winnerIn(index, '/users/1')).toBe('/users/{id}')
      replaceRoute(index, '/old', '/teams/{id}')
      expect(winnerIn(index, '/teams/1')).toBe('/teams/{id}')
      expect(winnerIn(index, '/old')).toBeUndefined()
    })

    it('sees a more specific path that replaced an unrelated one while the old winner stays', () => {
      const index = createRouteIndex([['/users/{id}', ['get']], ['/old', ['get']]])
      expect(winnerIn(index, '/users/me')).toBe('/users/{id}')
      replaceRoute(index, '/old', '/users/me')
      expect(winnerIn(index, '/users/me')).toBe('/users/me')
      expect(winnerIn(index, '/users/1')).toBe('/users/{id}')
    })

    it('treats a deleted and re-added path as declared last for tie-breaking', () => {
      const index = createRouteIndex([['/items/{id}', ['get']], ['/items/{key}', ['get']]])
      expect(params(matchRoute(index, 'get', '/items/1'))).toEqual([['id', '1']])
      const methodMap = index.get('/items/{id}')!
      index.delete('/items/{id}')
      index.set('/items/{id}', methodMap)
      expect(params(matchRoute(index, 'get', '/items/1'))).toEqual([['key', '1']])
    })

    it('sees an index cleared and refilled with the same number of paths', () => {
      const index = createRouteIndex([['/a/{x}', ['get']], ['/b', ['get']]])
      expect(winnerIn(index, '/a/1')).toBe('/a/{x}')
      index.clear()
      for (const pattern of ['/c/{y}', '/a/1']) {
        index.set(pattern, new Map([['get', createOperationEntry(pattern, 'get')]]))
      }
      expect(winnerIn(index, '/c/2')).toBe('/c/{y}')
      expect(winnerIn(index, '/a/1')).toBe('/a/1')
      expect(winnerIn(index, '/a/2')).toBeUndefined()
      expect(winnerIn(index, '/b')).toBeUndefined()
    })

    it('reads method maps live, so replaced or extended method maps take effect', () => {
      const index = createRouteIndex([['/users/{id}', ['get']]])
      expect(matchRoute(index, 'post', '/users/1').type).toBe('method_not_allowed')
      index.get('/users/{id}')!.set('post', createOperationEntry('/users/{id}', 'post'))
      expect(matchRoute(index, 'post', '/users/1').type).toBe('found')
      index.set('/users/{id}', new Map([['put', createOperationEntry('/users/{id}', 'put')]]))
      expect(matchRoute(index, 'post', '/users/1')).toEqual({ type: 'method_not_allowed', allowed: ['put'] })
    })
  })
})
