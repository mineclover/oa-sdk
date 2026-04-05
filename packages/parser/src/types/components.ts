/**
 * OAS 3.2 Components Object (§4.8.7) + Paths Object (§4.8.8)
 *
 * 참조: docs/references/oas32/05-components-paths.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasSchema } from './schema.js'
import type { OasResponse } from './responses.js'
import type { OasParameter } from './parameters.js'
import type { OasExample, OasLink } from './examples.js'
import type { OasRequestBody, OasMediaType } from './request-body.js'
import type { OasHeader } from './headers-tags.js'
import type { OasSecurityScheme } from './security.js'
import type { OasCallback } from './responses.js'
import type { OasPathItem } from './operations.js'

export type OasPaths = Record<string, Referenceable<OasPathItem>>

export type OasComponents = {
  schemas?: Record<string, OasSchema>
  responses?: Record<string, Referenceable<OasResponse>>
  parameters?: Record<string, Referenceable<OasParameter>>
  examples?: Record<string, Referenceable<OasExample>>
  requestBodies?: Record<string, Referenceable<OasRequestBody>>
  headers?: Record<string, Referenceable<OasHeader>>
  securitySchemes?: Record<string, Referenceable<OasSecurityScheme>>
  links?: Record<string, Referenceable<OasLink>>
  callbacks?: Record<string, Referenceable<OasCallback>>
  /** @since 3.2 */
  pathItems?: Record<string, OasPathItem>
  /** @since 3.2 */
  mediaTypes?: Record<string, Referenceable<OasMediaType>>
} & OasExtensions
