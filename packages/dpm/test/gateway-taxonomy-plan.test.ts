import { describe, expect, it } from 'vitest'

import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
} from '../src/index.js'
import { getDpmGatewaySchema } from './support/gateway-taxonomy-fixtures.js'

describe('DPM gateway compiled plan taxonomy projection', () => {
  it('projects compiled plan runtime taxonomies into the gateway schema', () => {
    const compiledPlanSchema = getDpmGatewaySchema('DpmCompiledPlan')

    expect(compiledPlanSchema.properties.planVersion.enum).toEqual([...DPM_COMPILED_PLAN_VERSIONS])
    expect(compiledPlanSchema.properties.staleReasons.items.enum).toEqual([...DPM_PLAN_STALE_REASONS])
  })
})
