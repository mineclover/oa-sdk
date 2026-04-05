/**
 * OAS 3.2 Header Object (§4.8.21) + Tag Object (§4.8.22)
 *
 * 참조: docs/references/oas32/11-headers-tags-refs.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasSchema } from './schema.js'
import type { OasExample } from './examples.js'
import type { OasMediaType } from './request-body.js'
import type { OasExternalDocs } from './operations.js'

export type OasHeader = {
  description?: string
  required?: boolean
  deprecated?: boolean
  example?: unknown
  examples?: Record<string, Referenceable<OasExample>>
  style?: string
  explode?: boolean
  schema?: OasSchema
  content?: Record<string, Referenceable<OasMediaType>>
} & OasExtensions

export type OasTag = {
  name: string
  /** @since 3.2 */
  summary?: string
  description?: string
  externalDocs?: OasExternalDocs
  /** @since 3.2 — 부모 태그 이름 */
  parent?: string
  /** @since 3.2 — 머신 판독 가능한 카테고리 */
  kind?: string
} & OasExtensions
