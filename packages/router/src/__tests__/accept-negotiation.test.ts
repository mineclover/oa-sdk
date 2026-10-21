import { describe, expect, it } from 'vitest'
import { negotiateResponseMediaType, RouterCodecRegistry, type RouterCodecAdapter } from '../codec/router-codec.js'

const codec = (mediaTypes: string[]): RouterCodecAdapter => ({
  mediaTypes,
  encode: () => new Uint8Array(),
  decode: () => null,
})

const JSON_TYPE = 'application/json'
const PROTOBUF = 'application/x-protobuf'
const MSGPACK = 'application/x-msgpack'

describe('negotiateResponseMediaType honors Accept weights', () => {
  it('never picks a type the client refused with q=0', () => {
    expect(negotiateResponseMediaType(`${PROTOBUF};q=0, ${JSON_TYPE}`, [JSON_TYPE, PROTOBUF])).toBe(JSON_TYPE)
    expect(negotiateResponseMediaType(`${PROTOBUF};q=0, */*`, [PROTOBUF, JSON_TYPE])).toBe(JSON_TYPE)
    expect(negotiateResponseMediaType(`${MSGPACK};q=0, ${JSON_TYPE};q=0.5`, [JSON_TYPE], new RouterCodecRegistry([codec([MSGPACK])])))
      .toBe(JSON_TYPE)
  })

  it('prefers the higher q over header order', () => {
    expect(negotiateResponseMediaType(`${JSON_TYPE};q=0.1, ${PROTOBUF}`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    expect(negotiateResponseMediaType(`${MSGPACK};q=0.2, ${JSON_TYPE};q=0.8`, [JSON_TYPE], new RouterCodecRegistry([codec([MSGPACK])])))
      .toBe(JSON_TYPE)
  })

  it('prefers the more specific range on a q tie, then header order', () => {
    expect(negotiateResponseMediaType(`*/*, ${PROTOBUF}`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    expect(negotiateResponseMediaType(`${PROTOBUF}, ${JSON_TYPE}`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
  })

  it('matches type/* ranges against the declared types, then the codec types', () => {
    expect(negotiateResponseMediaType('application/*', ['text/plain', JSON_TYPE])).toBe(JSON_TYPE)
    expect(negotiateResponseMediaType('text/*;q=0.5, application/*', ['text/plain', JSON_TYPE])).toBe(JSON_TYPE)
    expect(negotiateResponseMediaType('application/*', ['text/plain'], new RouterCodecRegistry([codec([MSGPACK])]))).toBe(MSGPACK)
  })

  it('weights each type by the most specific Accept range that matches it', () => {
    // JSON is named with q=0.1; x-protobuf only matches the wildcard, with the default weight of 1.
    expect(negotiateResponseMediaType(`${JSON_TYPE};q=0.1, */*`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    // The RFC 9110 §12.5.1 example: text/html weighs 0.3 through text/*, image/jpeg 0.5 through the wildcard.
    expect(negotiateResponseMediaType('text/*;q=0.3, text/plain;q=0.7, */*;q=0.5', ['text/html', 'image/jpeg'])).toBe('image/jpeg')
    expect(negotiateResponseMediaType('text/*;q=0.3, text/plain;q=0.7, */*;q=0.5', ['text/html', 'text/plain'])).toBe('text/plain')
    // A more specific range raises a type above the wildcard as well as lowering it.
    expect(negotiateResponseMediaType(`*/*;q=0.2, ${MSGPACK};q=0.9`, [JSON_TYPE], new RouterCodecRegistry([codec([MSGPACK])]))).toBe(MSGPACK)
  })

  it('never picks a type refused through a range', () => {
    expect(negotiateResponseMediaType('application/*;q=0, */*', [JSON_TYPE, 'text/plain'])).toBe('text/plain')
    expect(negotiateResponseMediaType('application/*;q=0, */*', [JSON_TYPE], new RouterCodecRegistry([codec([MSGPACK, 'text/csv'])])))
      .toBe('text/csv')
    // A more specific range overrides the refusal for the type it names.
    expect(negotiateResponseMediaType(`application/*;q=0, ${PROTOBUF};q=0.4, */*`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    // The lenient fallback skips types refused through a range, too.
    expect(negotiateResponseMediaType('application/*;q=0, image/png', [JSON_TYPE, 'text/plain'])).toBe('text/plain')
    // Every declared type refused through the wildcard: the first declared type, as for exact refusals.
    expect(negotiateResponseMediaType('*/*;q=0, image/png', [PROTOBUF, JSON_TYPE])).toBe(PROTOBUF)
  })

  it('answers the full wildcard with the server preference, JSON when nothing is declared', () => {
    expect(negotiateResponseMediaType('*/*', ['application/xml', JSON_TYPE])).toBe('application/xml')
    expect(negotiateResponseMediaType(`*/*, ${MSGPACK};q=0.5`, [], new RouterCodecRegistry([codec([MSGPACK])]))).toBe(JSON_TYPE)
  })

  it('parses parameters and weights leniently', () => {
    expect(negotiateResponseMediaType(`${JSON_TYPE}; charset=utf-8; q=0.3, ${PROTOBUF} ; Q = 0.9`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    // A malformed weight keeps the default weight of 1.
    expect(negotiateResponseMediaType(`${JSON_TYPE};q=0.5, ${PROTOBUF};q=high`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    expect(negotiateResponseMediaType('garbage, , text', [JSON_TYPE])).toBe(JSON_TYPE)
  })

  it('returns a declared type exactly as declared, whatever Accept the client sent', () => {
    const TEXT_UTF8 = 'text/plain; charset=utf-8'
    const declared = [TEXT_UTF8, JSON_TYPE]
    // The no-Accept path and every Accept path agree on the declared string, parameters included.
    for (const accept of [null, '*/*', 'text/plain', 'TEXT/Plain;q=0.8', 'text/*', 'text/html', `${JSON_TYPE};q=0`]) {
      expect(negotiateResponseMediaType(accept, declared)).toBe(TEXT_UTF8)
    }
    expect(negotiateResponseMediaType(`text/plain;q=0.2, ${JSON_TYPE}`, declared)).toBe(JSON_TYPE)
    // Case is kept as declared, too.
    expect(negotiateResponseMediaType('application/*', ['text/html', 'Application/Problem+JSON'])).toBe('Application/Problem+JSON')
    // Two declared types that share a type/subtype: the first one is returned.
    expect(negotiateResponseMediaType('text/plain', ['text/plain; charset=utf-8', 'text/plain; charset=iso-8859-1'])).toBe(TEXT_UTF8)
    // A declared type that a codec also serves is still returned as declared; a codec-only type as its registry key.
    const registry = new RouterCodecRegistry([codec(['Application/X-Msgpack; v=1'])])
    expect(negotiateResponseMediaType(MSGPACK, [`${MSGPACK}; v=2`], registry)).toBe(`${MSGPACK}; v=2`)
    expect(negotiateResponseMediaType(MSGPACK, [JSON_TYPE], registry)).toBe(MSGPACK)
  })

  it('falls back to a declared type the client did not refuse when nothing acceptable matches', () => {
    expect(negotiateResponseMediaType('text/html', [JSON_TYPE, PROTOBUF])).toBe(JSON_TYPE)
    expect(negotiateResponseMediaType(`${JSON_TYPE};q=0, text/html`, [JSON_TYPE, PROTOBUF])).toBe(PROTOBUF)
    // Every declared type refused: the lenient fallback still answers with the first declared type.
    expect(negotiateResponseMediaType(`${JSON_TYPE};q=0`, [JSON_TYPE])).toBe(JSON_TYPE)
  })
})
