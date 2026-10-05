import { describe, expect, it } from 'vitest'

import * as browserEntry from '../browser.js'
import * as rootEntry from '../index.js'
import {
  appendJsonPointer,
  canonicalJsonPointerFragment,
  decodeJsonPointerFragment,
  escapeJsonPointerToken,
  findNearestJsonPointerEntry,
  formatJsonPointer,
  parseJsonPointer,
  resolveJsonPointer,
  unescapeJsonPointerToken,
} from '../json-pointer.js'

/** Every string of length 0..maxLength over `alphabet`, shortest first. */
function allStrings(alphabet: readonly string[], maxLength: number): string[] {
  const result = ['']
  let previous = ['']
  for (let length = 1; length <= maxLength; length += 1) {
    const next = previous.flatMap(prefix => alphabet.map(character => prefix + character))
    result.push(...next)
    previous = next
  }
  return result
}

/** Characters that interact with RFC 6901 escaping, plus one plain character. */
const POINTER_ALPHABET = ['~', '/', '0', '1', 'a'] as const

describe('escapeJsonPointerToken', () => {
  it('escapes ~ as ~0 and / as ~1', () => {
    expect(escapeJsonPointerToken('a/b')).toBe('a~1b')
    expect(escapeJsonPointerToken('a~b')).toBe('a~0b')
    expect(escapeJsonPointerToken('a~/b')).toBe('a~0~1b')
    expect(escapeJsonPointerToken('/users/{id}')).toBe('~1users~1{id}')
  })

  it('escapes ~ before / so an escaped-looking input stays literal', () => {
    expect(escapeJsonPointerToken('~1')).toBe('~01')
    expect(escapeJsonPointerToken('~0')).toBe('~00')
  })

  it('leaves the empty token and plain tokens unchanged', () => {
    expect(escapeJsonPointerToken('')).toBe('')
    expect(escapeJsonPointerToken('x-oa-sdk-operation')).toBe('x-oa-sdk-operation')
    expect(escapeJsonPointerToken('{id}')).toBe('{id}')
  })
})

describe('unescapeJsonPointerToken', () => {
  it('decodes ~1 as / and ~0 as ~', () => {
    expect(unescapeJsonPointerToken('a~1b')).toBe('a/b')
    expect(unescapeJsonPointerToken('a~0b')).toBe('a~b')
    expect(unescapeJsonPointerToken('a~0~1b')).toBe('a~/b')
  })

  it('decodes ~01 to ~1, not to /', () => {
    expect(unescapeJsonPointerToken('~01')).toBe('~1')
    expect(unescapeJsonPointerToken('~00')).toBe('~0')
    expect(unescapeJsonPointerToken('~10')).toBe('/0')
  })

  it('returns the empty token unchanged', () => {
    expect(unescapeJsonPointerToken('')).toBe('')
  })

  it('keeps malformed ~ sequences verbatim', () => {
    expect(unescapeJsonPointerToken('a~2b')).toBe('a~2b')
    expect(unescapeJsonPointerToken('a~')).toBe('a~')
    expect(unescapeJsonPointerToken('~~1')).toBe('~/')
  })

  it('agrees with the ordered replace(~1).replace(~0) idiom on every short input', () => {
    for (const token of allStrings(POINTER_ALPHABET, 5)) {
      expect(unescapeJsonPointerToken(token)).toBe(token.replace(/~1/g, '/').replace(/~0/g, '~'))
    }
  })

  it('inverts escapeJsonPointerToken for every short token', () => {
    for (const token of allStrings(POINTER_ALPHABET, 5)) {
      expect(unescapeJsonPointerToken(escapeJsonPointerToken(token))).toBe(token)
    }
  })
})

describe('appendJsonPointer / formatJsonPointer', () => {
  it('formats no tokens as the root pointer ""', () => {
    expect(formatJsonPointer([])).toBe('')
  })

  it('formats the empty token as "/"', () => {
    expect(formatJsonPointer([''])).toBe('/')
    expect(formatJsonPointer(['', ''])).toBe('//')
  })

  it('escapes tokens that contain / and ~', () => {
    expect(formatJsonPointer(['paths', '/users/{id}', 'get'])).toBe('/paths/~1users~1{id}/get')
    expect(formatJsonPointer(['components', 'schemas', 'a~b/c'])).toBe('/components/schemas/a~0b~1c')
  })

  it('formats numeric tokens as array indices', () => {
    expect(formatJsonPointer(['parameters', 0, 'schema'])).toBe('/parameters/0/schema')
  })

  it('appends to plain pointers and to # fragments', () => {
    expect(appendJsonPointer('', 'a/b')).toBe('/a~1b')
    expect(appendJsonPointer('', '')).toBe('/')
    expect(appendJsonPointer('#', 'paths')).toBe('#/paths')
    expect(appendJsonPointer('#/paths', '/pets')).toBe('#/paths/~1pets')
    expect(appendJsonPointer('/items', 3)).toBe('/items/3')
  })
})

describe('parseJsonPointer', () => {
  it('parses the root pointer "" to no tokens', () => {
    expect(parseJsonPointer('')).toEqual([])
  })

  it('parses empty tokens', () => {
    expect(parseJsonPointer('/')).toEqual([''])
    expect(parseJsonPointer('//')).toEqual(['', ''])
    expect(parseJsonPointer('/a/')).toEqual(['a', ''])
  })

  it('unescapes tokens that contain / and ~', () => {
    expect(parseJsonPointer('/paths/~1users~1{id}/get')).toEqual(['paths', '/users/{id}', 'get'])
    expect(parseJsonPointer('/~01')).toEqual(['~1'])
  })

  it('rejects a non-empty pointer without a leading /', () => {
    expect(parseJsonPointer('a/b')).toBeUndefined()
    expect(parseJsonPointer('#/a')).toBeUndefined()
  })

  it('rejects malformed ~ escapes', () => {
    expect(parseJsonPointer('/a~2')).toBeUndefined()
    expect(parseJsonPointer('/a~')).toBeUndefined()
    expect(parseJsonPointer('/~~1')).toBeUndefined()
  })

  it('round-trips token lists through formatJsonPointer', () => {
    const tokens = allStrings(POINTER_ALPHABET, 3)
    const lists: string[][] = [[], ...tokens.map(token => [token])]
    for (const first of tokens) {
      for (const second of tokens) lists.push([first, second])
    }
    for (const list of lists) {
      expect(parseJsonPointer(formatJsonPointer(list))).toEqual(list)
    }
  })
})

describe('JSON Reference URI fragments', () => {
  it('decodes the root fragment and escaped tokens', () => {
    expect(decodeJsonPointerFragment('#')).toEqual([])
    expect(decodeJsonPointerFragment('#/')).toEqual([''])
    expect(decodeJsonPointerFragment('#/paths/~1pets~1{id}')).toEqual(['paths', '/pets/{id}'])
  })

  it('percent-decodes before unescaping tokens', () => {
    expect(decodeJsonPointerFragment('#/%7E01')).toEqual(['~1'])
    expect(decodeJsonPointerFragment('#/a%20b')).toEqual(['a b'])
  })

  it('rejects non-fragments, relative fragments, and malformed escapes', () => {
    expect(decodeJsonPointerFragment('/a')).toBeUndefined()
    expect(decodeJsonPointerFragment('#a')).toBeUndefined()
    expect(decodeJsonPointerFragment('#/a~2')).toBeUndefined()
    expect(decodeJsonPointerFragment('#/%E0%A4%A')).toBeUndefined()
  })

  it('canonicalizes equivalent fragment spellings', () => {
    expect(canonicalJsonPointerFragment('#')).toBe('#')
    expect(canonicalJsonPointerFragment('#/%7E1')).toBe('#/~1')
    expect(canonicalJsonPointerFragment('#/%7E01')).toBe('#/~01')
    expect(canonicalJsonPointerFragment('#/a%20b')).toBe('#/a b')
    // Percent-decoding runs first, so an encoded slash is a token separator.
    expect(canonicalJsonPointerFragment('#/a%2Fb')).toBe('#/a/b')
  })

  it('resolves own properties only', () => {
    const document = { paths: { '/pets': { get: { operationId: 'listPets' } } } }
    expect(resolveJsonPointer(document, '#/paths/~1pets/get/operationId')).toBe('listPets')
    expect(resolveJsonPointer(document, '#/paths/constructor')).toBeUndefined()
    expect(resolveJsonPointer(document, '#')).toBe(document)
  })
})

describe('findNearestJsonPointerEntry', () => {
  const entries = new Map([
    ['#/components/schemas/User', 'user'],
    ['#/paths/~1users', 'users'],
    ['#/paths/~1users/get', 'users.get'],
  ])

  it('returns the entry stored under the pointer itself', () => {
    expect(findNearestJsonPointerEntry('#/components/schemas/User', entries))
      .toEqual({ pointer: '#/components/schemas/User', value: 'user' })
  })

  it('returns the entry of the nearest ancestor', () => {
    expect(findNearestJsonPointerEntry('#/components/schemas/User/properties/role/$ref', entries))
      .toEqual({ pointer: '#/components/schemas/User', value: 'user' })
    expect(findNearestJsonPointerEntry('#/paths/~1users/get/responses/200', entries))
      .toEqual({ pointer: '#/paths/~1users/get', value: 'users.get' })
    expect(findNearestJsonPointerEntry('#/paths/~1users/post', entries))
      .toEqual({ pointer: '#/paths/~1users', value: 'users' })
  })

  it('treats only token boundaries as ancestors', () => {
    // `~1users~1{id}` is one token, and `#/components/schemas/Use` is a string prefix, not a parent.
    expect(findNearestJsonPointerEntry('#/paths/~1users~1{id}/get', entries)).toBeUndefined()
    expect(findNearestJsonPointerEntry('#/components/schemas/UserList', entries)).toBeUndefined()
  })

  it('reaches the document root of fragments and plain pointers', () => {
    const roots = new Map([['#', 'fragment-root'], ['', 'pointer-root']])
    expect(findNearestJsonPointerEntry('#/a/b', roots)).toEqual({ pointer: '#', value: 'fragment-root' })
    expect(findNearestJsonPointerEntry('#', roots)).toEqual({ pointer: '#', value: 'fragment-root' })
    expect(findNearestJsonPointerEntry('/a/b', roots)).toEqual({ pointer: '', value: 'pointer-root' })
    expect(findNearestJsonPointerEntry('', roots)).toEqual({ pointer: '', value: 'pointer-root' })
  })

  it('keeps fragments and plain pointers apart', () => {
    expect(findNearestJsonPointerEntry('/components/schemas/User', entries)).toBeUndefined()
    expect(findNearestJsonPointerEntry('#/a', new Map([['/a', 'plain']]))).toBeUndefined()
  })

  it('finds the entry of a percent-encoded $ref fragment once it is canonicalized', () => {
    const fragment = canonicalJsonPointerFragment('#/components/schemas/Us%65r/properties/role')
    expect(fragment).toBe('#/components/schemas/User/properties/role')
    expect(findNearestJsonPointerEntry(fragment!, entries)).toEqual({ pointer: '#/components/schemas/User', value: 'user' })
  })

  it('returns undefined for malformed pointers', () => {
    const all = new Map([['#', 'root'], ['', 'root']])
    expect(findNearestJsonPointerEntry('#a', all)).toBeUndefined()
    expect(findNearestJsonPointerEntry('#/a~2b', all)).toBeUndefined()
    expect(findNearestJsonPointerEntry('a/b', all)).toBeUndefined()
  })

  it('matches a walk over the escaped string for every short well-formed fragment', () => {
    // Reference: strip one `/`-separated segment at a time, as spec-lens did before
    // the walk moved here. It is exact for well-formed pointers because escaped
    // tokens never contain `/`.
    const walk = (pointer: string, keys: ReadonlyMap<string, string>): string | undefined => {
      for (let candidate = pointer; ; candidate = candidate.slice(0, candidate.lastIndexOf('/'))) {
        if (keys.has(candidate)) return candidate
        if (candidate.lastIndexOf('/') < 0) return undefined
      }
    }
    const tokens = allStrings(['~', '/', 'a'], 2)
    const pointers = ['#']
    for (const first of tokens) {
      pointers.push(`#${formatJsonPointer([first])}`)
      for (const second of tokens) pointers.push(`#${formatJsonPointer([first, second])}`)
    }
    const keys = new Map(pointers.filter((_, index) => index % 3 === 1).map(pointer => [pointer, pointer]))
    for (const pointer of pointers) {
      expect(findNearestJsonPointerEntry(pointer, keys)?.pointer).toBe(walk(pointer, keys))
    }
  })
})

describe('package entries', () => {
  it('exports the same JSON Pointer helpers from the root and browser entries', () => {
    const names = [
      'appendJsonPointer',
      'canonicalJsonPointerFragment',
      'escapeJsonPointerToken',
      'findNearestJsonPointerEntry',
      'formatJsonPointer',
      'parseJsonPointer',
      'unescapeJsonPointerToken',
    ] as const
    for (const name of names) {
      expect(typeof rootEntry[name]).toBe('function')
      expect(browserEntry[name]).toBe(rootEntry[name])
    }
  })
})
