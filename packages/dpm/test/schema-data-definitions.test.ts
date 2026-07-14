import Ajv2020 from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { readDpmJsonFixture } from './support/fixture-io.js'

const schemaUrl = new URL('../src/schema/dpm-manifest.schema.json', import.meta.url)
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8')) as Record<string, unknown>

describe('DPM data definition manifest contract', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(schema)

  it('accepts distinct logical data and API references', () => {
    const manifest = structuredClone(
      readDpmJsonFixture('valid/customer-orders.json'),
    ) as Record<string, any>
    manifest.data_definitions = {
      version: '1.0',
      fields: [{
        entity: 'customer',
        name: 'customerNo',
        type: 'string',
        storage_ref: {
          table: 'public.customers',
          column: 'customer_no',
        },
      }],
      api_bindings: [{
        data_field: {
          entity: 'customer',
          field: 'customerNo',
        },
        api: {
          artifact_id: 'commerce-api',
          operation_id: 'getCustomer',
          pointer: '#/paths/~1customers~1{customerId}/get/responses/200',
          version_hash: 'sha256:api-v1',
        },
        direction: 'response',
      }],
    }

    expect(validate(manifest), JSON.stringify(validate.errors, null, 2)).toBe(true)
  })

  it('rejects an API address that is not an OpenAPI JSON pointer', () => {
    const manifest = structuredClone(
      readDpmJsonFixture('valid/customer-orders.json'),
    ) as Record<string, any>
    manifest.data_definitions = {
      version: '1.0',
      fields: [{
        entity: 'customer',
        name: 'customerNo',
        type: 'string',
      }],
      api_bindings: [{
        data_field: {
          entity: 'customer',
          field: 'customerNo',
        },
        api: {
          artifact_id: 'commerce-api',
          pointer: '/paths/customers/get',
        },
        direction: 'response',
      }],
    }

    expect(validate(manifest)).toBe(false)
    expect((validate.errors ?? []).map(error => error.instancePath))
      .toContain('/data_definitions/api_bindings/0/api/pointer')
  })
})
