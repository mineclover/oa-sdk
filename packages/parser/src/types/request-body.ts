/**
 * OAS 3.2 Request Body Object (§4.8.13) + Media Type Object (§4.8.14) + Encoding Object (§4.8.15)
 *
 * 참조: docs/references/oas32/08-request-body.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasSchema } from './schema.js'
import type { OasExample } from './examples.js'
import type { OasHeader } from './headers-tags.js'

export type OasRequestBody = {
  description?: string
  content: Record<string, Referenceable<OasMediaType>>
  required?: boolean
} & OasExtensions

export type OasMediaType = {
  schema?: OasSchema
  /** @since 3.2 — 순차 미디어 아이템 스키마 (SSE, NDJSON 등) */
  itemSchema?: OasSchema
  example?: unknown
  examples?: Record<string, Referenceable<OasExample>>
  encoding?: Record<string, OasEncoding>
  /** @since 3.2 — positional encoding */
  prefixEncoding?: OasEncoding[]
  /** @since 3.2 — array item encoding */
  itemEncoding?: OasEncoding
} & OasExtensions

export type OasEncoding = {
  contentType?: string
  headers?: Record<string, Referenceable<OasHeader>>
  style?: string
  explode?: boolean
  allowReserved?: boolean
  /** @since 3.2 — nested encoding */
  encoding?: Record<string, OasEncoding>
  /** @since 3.2 */
  prefixEncoding?: OasEncoding[]
  /** @since 3.2 */
  itemEncoding?: OasEncoding
} & OasExtensions
