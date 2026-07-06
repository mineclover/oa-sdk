import { describe, expect, it } from 'vitest'

import {
  compiledPlanTaxonomyProjectionCases,
  getDpmGatewaySchemaValue,
} from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

describe('DPM gateway compiled plan taxonomy projection', () => {
  it('projects compiled plan runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of compiledPlanTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
