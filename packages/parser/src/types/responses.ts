/**
 * OAS 3.2 Responses Object (§4.8.16) + Response Object (§4.8.17) + Callback Object (§4.8.18)
 *
 * 참조: docs/references/oas32/09-responses.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasHeader } from './headers-tags.js'
import type { OasMediaType } from './request-body.js'
import type { OasLink } from './examples.js'
import type { OasPathItem } from './operations.js'

export type OasResponses = Record<string, Referenceable<OasResponse>>

export type OasResponse = {
  /** @since 3.2 */
  summary?: string
  description?: string
  headers?: Record<string, Referenceable<OasHeader>>
  content?: Record<string, Referenceable<OasMediaType>>
  links?: Record<string, Referenceable<OasLink>>
} & OasExtensions

export type OasCallback = Record<string, Referenceable<OasPathItem>>
