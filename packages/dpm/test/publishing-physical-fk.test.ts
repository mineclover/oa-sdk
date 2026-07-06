import { describe, expect, it } from 'vitest'

import {
  createDpmPublishingContext,
} from '../src/index.js'
import {
  createPublishingCompiledPlan,
  expectedPublishingPhysicalForeignKeyRecommendations,
} from './support/publishing-fixtures.js'

describe('DPM publishing physical foreign key recommendations', () => {
  it('marks physical foreign key output as recommendations instead of mutations', () => {
    const context = createDpmPublishingContext({
      plan: createPublishingCompiledPlan(),
      includePhysicalForeignKeyRecommendations: true,
    })

    expect(context.physicalForeignKeyRecommendations).toEqual([
      ...expectedPublishingPhysicalForeignKeyRecommendations,
    ])
  })
})
