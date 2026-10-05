import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseMockHeaders, parseSpec } from '../user-input.js'

const MINIMAL_SPEC = {
  openapi: '3.2.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {},
}

/** JSON text with `info` written twice; JSON.parse keeps the last value, the YAML parser rejects it. */
function jsonWithDuplicateInfo(document: Record<string, unknown>): string {
  const body = JSON.stringify(document).slice(1, -1)
  return `{"info":{"title":"Draft","version":"0.0.0"},${body}}`
}

describe('parseSpec', () => {
  it('reads YAML and JSON specs that declare openapi', () => {
    expect(parseSpec(stringifyYaml(MINIMAL_SPEC))).toEqual(MINIMAL_SPEC)
    expect(parseSpec(JSON.stringify(MINIMAL_SPEC))).toEqual(MINIMAL_SPEC)
  })

  it('falls back to JSON for text the YAML parser rejects and keeps the openapi requirement', () => {
    const duplicateKeys = jsonWithDuplicateInfo(MINIMAL_SPEC)
    expect(() => parseYaml(duplicateKeys)).toThrow()
    expect(parseSpec(duplicateKeys)).toEqual(MINIMAL_SPEC)

    const { openapi: _openapi, ...withoutOpenapi } = MINIMAL_SPEC
    expect(parseSpec(jsonWithDuplicateInfo(withoutOpenapi))).toBeNull()
    expect(parseSpec(jsonWithDuplicateInfo({ ...withoutOpenapi, swagger: '2.0' }))).toBeNull()
    expect(parseSpec(jsonWithDuplicateInfo({ ...MINIMAL_SPEC, openapi: '' }))).toBeNull()
  })

  it('reads documents that are not OpenAPI objects, or not parseable, as null', () => {
    expect(parseSpec(stringifyYaml({ info: MINIMAL_SPEC.info }))).toBeNull()
    expect(parseSpec('- openapi\n- 3.2.0\n')).toBeNull()
    expect(parseSpec('just text')).toBeNull()
    expect(parseSpec('')).toBeNull()
    expect(parseSpec('{"openapi": ')).toBeNull()
  })
})

describe('parseMockHeaders', () => {
  it('reads blank text as no custom headers', () => {
    expect(parseMockHeaders('')).toEqual({})
    expect(parseMockHeaders('  \n\t')).toEqual({})
  })

  it('reads string, number, and boolean values as fetch would stringify them', () => {
    expect(parseMockHeaders('{"Authorization": "Bearer t", "X-Retry": 3, "X-Debug": true, "X-Ratio": 0.5}')).toEqual({
      Authorization: 'Bearer t',
      'X-Retry': '3',
      'X-Debug': 'true',
      'X-Ratio': '0.5',
    })
  })

  it('keeps a header named __proto__ as an ordinary entry', () => {
    const headers = parseMockHeaders('{"__proto__": "x", "X-Other": "y"}')
    expect(Object.keys(headers)).toEqual(['__proto__', 'X-Other'])
    expect(headers['__proto__']).toBe('x')
  })

  it('names the header whose value is null, an object, or an array', () => {
    expect(() => parseMockHeaders('{"X-Ok": "1", "X-Null": null}')).toThrow('Header "X-Null" must be a string, number, or boolean (got null)')
    expect(() => parseMockHeaders('{"X-Nested": {"a": 1}}')).toThrow('Header "X-Nested" must be a string, number, or boolean (got object)')
    expect(() => parseMockHeaders('{"X-List": ["a", "b"]}')).toThrow('Header "X-List" must be a string, number, or boolean (got array)')
  })

  it('rejects JSON that is not a header map', () => {
    for (const text of ['["a"]', '"Bearer t"', '42', 'null']) {
      expect(() => parseMockHeaders(text)).toThrow(new TypeError('Headers must be a JSON object of header names to values'))
    }
  })

  it('reports text that is not JSON instead of ignoring it', () => {
    expect(() => parseMockHeaders('{"X-Token": "abc",}')).toThrow(SyntaxError)
    expect(() => parseMockHeaders('X-Token: abc')).toThrow(/^Headers must be valid JSON: /)
  })
})
