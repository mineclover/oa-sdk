import { describe, expect, it } from 'vitest'

import {
  createDpmPublishingContext,
} from '../src/index.js'
import {
  createPublishingCompiledPlan,
} from './support/publishing-fixtures.js'

describe('DPM publishing physical foreign key recommendations', () => {
  it('marks physical foreign key output as recommendations instead of mutations', () => {
    const context = createDpmPublishingContext({
      plan: createPublishingCompiledPlan(),
      includePhysicalForeignKeyRecommendations: true,
    })

    expect(context.physicalForeignKeyRecommendations).toEqual([
      {
        kind: 'physical_fk_recommendation',
        relationship: 'rel_orders_customer',
        childTable: 'public.orders',
        childColumns: ['customer_no'],
        parentTable: 'public.customers',
        parentColumns: ['customer_no'],
        applyMode: 'recommendation_only',
        mutation: 'none',
      },
    ])
  })
})
