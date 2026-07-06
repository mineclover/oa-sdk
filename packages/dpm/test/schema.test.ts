import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DPM_MANIFEST_SCHEMA_ID } from '../src/index.js'
import {
  manifestSchemaInvalidFixtureCases,
  manifestSchemaValidFixtureNames,
  readManifestSchemaFixture,
} from './support/manifest-schema-fixtures.js'

const schemaUrl = new URL('../src/schema/dpm-manifest.schema.json', import.meta.url)
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as Record<string, unknown>

describe('DPM manifest JSON Schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)

  it('uses the stable DPM v1 schema id', () => {
    expect(schema['$id']).toBe(DPM_MANIFEST_SCHEMA_ID)
  })

  it('accepts relationship-first manifest fixtures', () => {
    for (const fixtureName of manifestSchemaValidFixtureNames) {
      expect(validate(readManifestSchemaFixture('valid', fixtureName)), fixtureName).toBe(true)
    }
  })

  it.each(manifestSchemaInvalidFixtureCases)('rejects invalid fixture %s', (fixtureName, expectedPath) => {
    const valid = validate(readManifestSchemaFixture('invalid', fixtureName))
    const errorPaths = (validate.errors ?? []).map((error) => error.instancePath)

    expect(valid).toBe(false)
    expect(errorPaths).toContain(expectedPath)
  })
})
