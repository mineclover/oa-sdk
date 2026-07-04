import { describe, expect, it } from 'vitest'

import {
  createEntityDeclaration,
  createLogicalRelationship,
  renderEntityCanonicalKey,
  renderRelationshipCanonicalKey,
} from '../src/index.js'

describe('DPM entity and logical relationship model', () => {
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

  it('requires polymorphic relationships to declare a predicate and includes it in the canonical key', () => {
    expect(() =>
      createLogicalRelationship({
        name: 'rel_activities_customer',
        type: 'polymorphic',
        cardinality: 'many_to_one',
        parent: {
          table: 'public.customers',
          columns: ['customer_no'],
        },
        child: {
          table: 'public.activities',
          columns: ['object_id'],
        },
        namespace: 'customer',
        transformStrategy: 'entity_token',
        orphanPolicy: 'warn',
      }),
    ).toThrow('polymorphic relationships require conditionSql')

    const relationship = createLogicalRelationship({
      name: 'rel_activities_customer',
      type: 'polymorphic',
      cardinality: 'many_to_one',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.activities',
        columns: ['object_id'],
      },
      namespace: 'customer',
      transformStrategy: 'entity_token',
      orphanPolicy: 'warn',
      condition: {
        conditionSql: "object_type = 'CUSTOMER'",
      },
      canonicalKey: {
        components: ['object_id'],
      },
    })

    expect(renderRelationshipCanonicalKey(relationship, { object_id: 'C-001' })).toBe(
      'customer:predicate=object_type%20%3D%20%27CUSTOMER%27:object_id=C-001',
    )
  })

  it('requires temporal relationships to declare valid-time input or a documented absence', () => {
    expect(() =>
      createLogicalRelationship({
        name: 'rel_price_history_product',
        type: 'temporal',
        cardinality: 'many_to_one',
        parent: {
          table: 'public.products',
          columns: ['product_id'],
        },
        child: {
          table: 'public.price_history',
          columns: ['product_id'],
        },
        namespace: 'product',
        transformStrategy: 'entity_token',
        orphanPolicy: 'block',
        condition: {
          temporalCondition: 'valid_from <= observed_at and observed_at < valid_to',
        },
      }),
    ).toThrow('temporal relationships require validTimeColumn or validTimeAbsentReason')

    const relationship = createLogicalRelationship({
      name: 'rel_price_history_product',
      type: 'temporal',
      cardinality: 'many_to_one',
      parent: {
        table: 'public.products',
        columns: ['product_id'],
      },
      child: {
        table: 'public.price_history',
        columns: ['product_id'],
      },
      namespace: 'product',
      transformStrategy: 'entity_token',
      orphanPolicy: 'block',
      condition: {
        temporalCondition: 'valid_from <= observed_at and observed_at < valid_to',
      },
      temporal: {
        validTimeColumn: 'observed_at',
      },
    })

    expect(relationship.temporal).toEqual({ validTimeColumn: 'observed_at' })
  })
})
