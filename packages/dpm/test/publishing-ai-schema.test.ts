import { describe, expect, it } from 'vitest'

import {
  createDpmPublishingContext,
} from '../src/index.js'
import {
  createPublishingCompiledPlan,
} from './support/publishing-fixtures.js'

describe('DPM publishing AI schema context', () => {
  it('publishes AI relationship context only from validated relationship steps', () => {
    const plan = createPublishingCompiledPlan()
    const context = createDpmPublishingContext({
      plan,
      includeExamples: true,
    })

    expect(context.kind).toBe('dpm.publishing-context.v1')
    expect(context.relationshipMetadata.map(relationship => relationship.name)).toEqual(
      plan.relationshipSteps.map(step => step.name),
    )
    expect(context.relationshipMetadata).toEqual([
      expect.objectContaining({
        name: 'rel_orders_customer',
        namespace: 'customer',
        cardinality: 'one_to_many',
        joinPredicate: 'public.orders.customer_no = public.customers.customer_no',
        readonly: true,
      }),
    ])
    expect(context.aiSchemaContext.relationships[0]).toMatchObject({
      name: 'rel_orders_customer',
      namespace: 'customer',
      cardinality: 'one_to_many',
      description: 'Join public.orders to public.customers through the customer namespace.',
      examples: [
        {
          child: 'public.orders.customer_no',
          parent: 'public.customers.customer_no',
        },
      ],
    })
    expect(context.aiSchemaContext.readonlyGrantHints).toEqual([
      'Use read-only access to the pseudonymized target dataset.',
      'Do not request source database, secret store, or token lookup access.',
    ])
  })
})
