import { describe, expect, it } from 'vitest'

import { isParsedDocument } from '../parsed-document.js'
import { parseDocument } from '../parse.js'
import type { OasDocument } from '../oas32-types.js'

const rawDocument: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Parsed document guard', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

describe('isParsedDocument', () => {
  it('distinguishes the Map-backed parser IR from a raw OpenAPI document', () => {
    expect(isParsedDocument(rawDocument)).toBe(false)
    expect(isParsedDocument(parseDocument(rawDocument))).toBe(true)
  })

  it('rejects partial lookalikes instead of narrowing them to ParsedDocument', () => {
    expect(isParsedDocument({
      openapi: '3.2.0',
      operations: [],
      routes: new Map(),
    })).toBe(false)
  })
})
