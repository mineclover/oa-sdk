import { describe, expect, it } from 'vitest'
import { prepareCodegenDocument } from '../index.js'

type Document = Record<string, unknown>

function validDocument(): Document {
  return {
    openapi: '3.2.0',
    info: { title: 'test', version: '1' },
    paths: {},
    components: { schemas: { Value: { type: 'string' } } },
  }
}

describe('prepareCodegenDocument', () => {
  it('returns fatal findings without throwing', () => {
    const result = prepareCodegenDocument({ components: { schemas: [] } })
    expect(result.fatal.length).toBeGreaterThan(0)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'structure/schemas-object', severity: 'error' }),
    ]))
  })

  it('keeps non-fatal findings in diagnostics and out of fatal', () => {
    const result = prepareCodegenDocument({
      ...validDocument(),
      paths: { '/unused': { get: { responses: {} } } },
    }, { failOnSeverity: 'error' })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.fatal.every(item => item.severity === 'error')).toBe(true)
  })

  it('returns identical data when caller force handling is changed', () => {
    const document = validDocument()
    const normal = prepareCodegenDocument(document)
    const forced = prepareCodegenDocument(document, { force: true } as never)
    expect(forced).toEqual(normal)
  })

  it('prunes in-memory object cycles and reports them', () => {
    const document = validDocument()
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    document.components = { schemas: { Value: cycle } }
    const result = prepareCodegenDocument(document, { normalize: false })
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'structure/circular-anchor' }),
    ]))
    expect(result.document).not.toBe(document)
  })

  it('honors normalize on and off', () => {
    const document = {
      ...validDocument(),
      zeta: 1,
      alpha: 2,
    }
    const normalized = prepareCodegenDocument(document, { normalize: true })
    const untouched = prepareCodegenDocument(document, { normalize: false })
    expect(Object.keys(normalized.document)).not.toEqual(Object.keys(untouched.document))
  })
})
