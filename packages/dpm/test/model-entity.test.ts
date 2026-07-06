import { describe, expect, it } from 'vitest'

import {
  createEntityDeclaration,
  renderEntityCanonicalKey,
} from '../src/index.js'

describe('DPM entity model', () => {
  it('renders a single-column entity canonical key from the entity root key only', () => {
    const entity = createEntityDeclaration({
      name: 'customer',
      namespace: 'customer',
      root: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      keyStrategy: {
        type: 'single_column',
        canonicalColumns: ['customer_no'],
      },
      transform: {
        type: 'deterministic_token',
        namespace: 'customer',
        prefix: 'CUST',
        reversible: true,
      },
    })

    expect(entity.identity).toBe('entity:customer/customer')
    expect(renderEntityCanonicalKey(entity, { customer_no: 'C-001' })).toBe('customer:customer_no=C-001')
    expect(entity).not.toHaveProperty('child')
    expect(entity).not.toHaveProperty('childColumns')
  })

  it('renders composite and tenant-scoped entity canonical keys deterministically', () => {
    const entity = createEntityDeclaration({
      name: 'account_customer',
      namespace: 'customer',
      root: {
        table: 'public.customers',
        columns: ['tenant_id', 'customer_no'],
      },
      keyStrategy: {
        type: 'composite',
        canonicalColumns: ['customer_no'],
        tenant: {
          columns: ['tenant_id'],
        },
        separator: ':',
      },
      transform: {
        type: 'deterministic_token',
        namespace: 'customer',
        prefix: 'CUST',
        reversible: true,
      },
    })

    expect(
      renderEntityCanonicalKey(entity, {
        customer_no: 'C:001',
        tenant_id: 'tenant:west',
      }),
    ).toBe('customer:tenant_id=tenant%3Awest:customer_no=C%3A001')
  })
})
