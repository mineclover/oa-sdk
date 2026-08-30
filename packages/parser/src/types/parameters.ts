/**
 * OAS 3.2 Parameter Object (§4.8.12)
 *
 * 참조: docs/references/oas32/07-parameters.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasSchema } from './schema.js'
import type { OasExample } from './examples.js'
import type { OasMediaType } from './request-body.js'

export type OasParameterIn = 'path' | 'query' | 'querystring' | 'header' | 'cookie'

export type OasParameter = {
  name: string
  in: OasParameterIn
  description?: string
  required?: boolean
  deprecated?: boolean
  allowEmptyValue?: boolean
  example?: unknown
  examples?: Record<string, Referenceable<OasExample>>

  // 직렬화
  style?: string
  explode?: boolean
  allowReserved?: boolean

  // 스키마 (schema 또는 content 중 하나)
  schema?: OasSchema
  content?: Record<string, Referenceable<OasMediaType>>
} & OasExtensions
