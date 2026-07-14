import { describe, expect, it } from 'vitest'

import {
  createDpmApiBinding,
  createDpmApiObjectIdentity,
  createDpmDatabaseColumnIdentity,
  createDpmDataDefinitions,
  createDpmDataField,
  createDpmDataFieldIdentity,
} from '../src/index.js'

describe('DPM logical data definitions', () => {
  it('keeps logical field, database column, and API object identities separate', () => {
    const field = createDpmDataField({
      entity: 'customer',
      name: 'customerNo',
      type: 'string',
      storageRef: {
        table: 'public.customers',
        column: 'customer_no',
      },
    })
    const binding = createDpmApiBinding({
      dataField: {
        entity: 'customer',
        field: 'customerNo',
      },
      api: {
        artifactId: 'commerce-api',
        operationId: 'getCustomer',
        pointer: '#/paths/~1customers~1{customerId}/get/responses/200/content/application~1json/schema/properties/customerNo',
        versionHash: 'sha256:api-v1',
      },
      direction: 'response',
    })

    expect(field.identity).toBe('field:customer/customerNo')
    expect(createDpmDataFieldIdentity(binding.dataField)).toBe(field.identity)
    expect(field.storageRef).toEqual({
      table: 'public.customers',
      column: 'customer_no',
    })
    expect(createDpmDatabaseColumnIdentity(field.storageRef!)).toBe('db:public.customers#customer_no')
    expect(createDpmApiObjectIdentity(binding.api)).toBe(
      'api:commerce-api#operation:getCustomer:#/paths/~1customers~1{customerId}/get/responses/200/content/application~1json/schema/properties/customerNo@sha256:api-v1',
    )
    expect(binding.identity).toContain('binding:field:customer/customerNo@api:commerce-api')
    expect(binding.api.pointer).not.toBe(field.storageRef?.column)
  })

  it('rejects bindings that reference a field outside the data definition', () => {
    expect(() => createDpmDataDefinitions({
      fields: [{
        entity: 'customer',
        name: 'customerNo',
        type: 'string',
      }],
      apiBindings: [{
        dataField: {
          entity: 'order',
          field: 'customerNo',
        },
        api: {
          artifactId: 'commerce-api',
          pointer: '#/components/schemas/Order/properties/customerNo',
        },
        direction: 'response',
      }],
    })).toThrow('unknown data field field:order/customerNo')
  })

  it('rejects non-pointer API addresses at the model boundary', () => {
    expect(() => createDpmApiBinding({
      dataField: {
        entity: 'customer',
        field: 'customerNo',
      },
      api: {
        artifactId: 'commerce-api',
        pointer: '/paths/customers/get',
      },
      direction: 'response',
    })).toThrow('must be an OpenAPI JSON pointer')
  })
})
