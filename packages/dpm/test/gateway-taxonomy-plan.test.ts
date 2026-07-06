import { describe, expect, it } from 'vitest'

import {
  DPM_COMPILED_PLAN_VERSIONS,
  DPM_PLAN_STALE_REASONS,
} from '../src/index.js'
import { getDpmGatewaySchemaValue } from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

const compiledPlanTaxonomyProjectionCases = [
  ['DpmCompiledPlan', ['properties', 'planVersion', 'enum'], DPM_COMPILED_PLAN_VERSIONS],
  ['DpmCompiledPlan', ['properties', 'staleReasons', 'items', 'enum'], DPM_PLAN_STALE_REASONS],
] as const

describe('DPM gateway compiled plan taxonomy projection', () => {
  it('projects compiled plan runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of compiledPlanTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
