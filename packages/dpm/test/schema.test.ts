import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DPM_MANIFEST_SCHEMA_ID } from '../src/index.js'
import { readDpmJsonFixture } from './support/fixture-io.js'

const schemaUrl = new URL('../src/schema/dpm-manifest.schema.json', import.meta.url)
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as Record<string, unknown>

function readFixture(kind: 'valid' | 'invalid', name: string): unknown {
  return readDpmJsonFixture(`${kind}/${name}`)
}

describe('DPM manifest JSON Schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)

  it('uses the stable DPM v1 schema id', () => {
    expect(schema['$id']).toBe(DPM_MANIFEST_SCHEMA_ID)
  })

  it('accepts a relationship-first manifest fixture', () => {
    expect(validate(readFixture('valid', 'customer-orders.json'))).toBe(true)
  })

  it.each([
    ['direct-identifier-keep.json', '/columns/0'],
    ['foreign-identifier-missing-relationship.json', '/columns/0'],
    ['legacy-relationship-from-to.json', '/relationships/0'],
    ['non-approved-relationship.json', '/relationships/0/status'],
  ])('rejects invalid fixture %s', (fixtureName, expectedPath) => {
    const valid = validate(readFixture('invalid', fixtureName))
    const errorPaths = (validate.errors ?? []).map((error) => error.instancePath)

    expect(valid).toBe(false)
    expect(errorPaths).toContain(expectedPath)
  })
})
