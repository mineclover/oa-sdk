import { describe, expect, it } from 'vitest'

import { parseDocument } from '../../parser/src/index.js'
import {
  DPM_GATEWAY_OPERATION_IDS,
  getDpmGatewayOpenApiDocument,
} from '../src/index.js'
import {
  GATEWAY_OPENAPI_PATHS,
  GATEWAY_SECRET_BEARING_OPERATION_FRAGMENTS,
} from './support/gateway-contract-fixtures.js'

describe('DPM gateway OpenAPI contract', () => {
  it('parses as an OpenAPI 3.2 gateway artifact through the OA SDK parser path', () => {
    const document = getDpmGatewayOpenApiDocument()
    const parsed = parseDocument(document)

    expect(parsed.openapi).toBe('3.2.0')
    expect(parsed.operations.map(operation => operation.operationId).sort()).toEqual([
      ...DPM_GATEWAY_OPERATION_IDS,
    ].sort())
    expect(parsed.operations).toHaveLength(16)
  })

  it('models the full DPM gateway workflow without exposing secret-bearing operations', () => {
    const document = getDpmGatewayOpenApiDocument()

    expect(Object.keys(document.paths).sort()).toEqual([...GATEWAY_OPENAPI_PATHS].sort())
    const serialized = JSON.stringify(document).toLowerCase()

    for (const forbiddenFragment of GATEWAY_SECRET_BEARING_OPERATION_FRAGMENTS) {
      expect(serialized).not.toContain(forbiddenFragment)
    }
  })
})
