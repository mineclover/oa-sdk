import { describe, expect, it } from 'vitest'

import {
  getDpmGatewaySchemaValue,
  workflowTaxonomyProjectionCases,
} from './support/gateway-taxonomy-fixtures.js'
import { formatSchemaPath } from './support/schema-path.js'

describe('DPM gateway workflow taxonomy projection', () => {
  it('projects workflow response runtime taxonomies into the gateway schema', () => {
    for (const [schemaName, path, expected] of workflowTaxonomyProjectionCases) {
      expect(getDpmGatewaySchemaValue(schemaName, path), `${schemaName}.${formatSchemaPath(path)}`).toEqual([
        ...expected,
      ])
    }
  })
})
