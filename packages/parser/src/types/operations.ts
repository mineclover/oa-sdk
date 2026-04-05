/**
 * OAS 3.2 Path Item Object (§4.8.9) + Operation Object (§4.8.10) + External Documentation Object (§4.8.11)
 *
 * 참조: docs/references/oas32/06-operations.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasServer } from './server.js'
import type { OasParameter } from './parameters.js'
import type { OasRequestBody } from './request-body.js'
import type { OasResponses } from './responses.js'
import type { OasCallback } from './responses.js'
import type { OasSecurityRequirement } from './security.js'

export type OasExternalDocs = {
  description?: string
  url: string
} & OasExtensions

export type OasPathItem = {
  $ref?: string
  summary?: string
  description?: string
  get?: OasOperation
  put?: OasOperation
  post?: OasOperation
  delete?: OasOperation
  options?: OasOperation
  head?: OasOperation
  patch?: OasOperation
  trace?: OasOperation
  /** @since 3.2 — QUERY HTTP method */
  query?: OasOperation
  /** @since 3.2 — custom HTTP methods */
  additionalOperations?: Record<string, OasOperation>
  servers?: OasServer[]
  parameters?: Referenceable<OasParameter>[]
} & OasExtensions

export type OasOperation = {
  tags?: string[]
  summary?: string
  description?: string
  externalDocs?: OasExternalDocs
  operationId?: string
  parameters?: Referenceable<OasParameter>[]
  requestBody?: Referenceable<OasRequestBody>
  responses?: OasResponses
  callbacks?: Record<string, Referenceable<OasCallback>>
  deprecated?: boolean
  security?: OasSecurityRequirement[]
  servers?: OasServer[]
} & OasExtensions
