/**
 * OAS 3.2 Schema Object (§4.8.24) + Discriminator Object
 *
 * JSON Schema Draft 2020-12 방언.
 * 참조: docs/references/oas32/12-schema.md
 */

import type { OasExtensions } from './common.js'
import type { OasXml } from './xml.js'
import type { OasExternalDocs } from './operations.js'

export type OasSchema = {
  // ── JSON Schema 메타 ─────────────────────────────────────────
  $schema?: string
  $id?: string
  $ref?: string
  $dynamicRef?: string
  $dynamicAnchor?: string
  $comment?: string
  title?: string
  description?: string
  deprecated?: boolean
  examples?: unknown[]
  default?: unknown

  // ── 타입 ────────────────────────────────────────────────────
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  format?: string

  // ── 숫자 ────────────────────────────────────────────────────
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number

  // ── 문자열 ──────────────────────────────────────────────────
  minLength?: number
  maxLength?: number
  pattern?: string
  contentMediaType?: string
  contentEncoding?: string
  contentSchema?: OasSchema

  // ── 배열 ────────────────────────────────────────────────────
  items?: OasSchema
  prefixItems?: OasSchema[]
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  contains?: OasSchema
  minContains?: number
  maxContains?: number

  // ── 객체 ────────────────────────────────────────────────────
  properties?: Record<string, OasSchema>
  required?: string[]
  additionalProperties?: OasSchema | boolean
  patternProperties?: Record<string, OasSchema>
  propertyNames?: OasSchema
  minProperties?: number
  maxProperties?: number
  dependentRequired?: Record<string, string[]>
  dependentSchemas?: Record<string, OasSchema>
  unevaluatedProperties?: OasSchema | boolean
  unevaluatedItems?: OasSchema | boolean

  // ── 조합 ────────────────────────────────────────────────────
  allOf?: OasSchema[]
  oneOf?: OasSchema[]
  anyOf?: OasSchema[]
  not?: OasSchema
  if?: OasSchema
  then?: OasSchema
  else?: OasSchema

  // ── OAS 확장 ────────────────────────────────────────────────
  discriminator?: OasDiscriminator
  xml?: OasXml
  externalDocs?: OasExternalDocs
  /** @deprecated Use JSON Schema `examples` instead */
  example?: unknown
  readOnly?: boolean
  writeOnly?: boolean
} & OasExtensions

export type OasDiscriminator = {
  propertyName: string
  mapping?: Record<string, string>
  /** @since 3.2 */
  defaultMapping?: string
} & OasExtensions
