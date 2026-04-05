/**
 * OAS 3.2 Example Object (§4.8.19) + Link Object (§4.8.20)
 *
 * 참조: docs/references/oas32/10-examples-links.md
 */

import type { OasExtensions } from './common.js'
import type { OasServer } from './server.js'

export type OasExample = {
  summary?: string
  description?: string
  /** @since 3.2 — 스키마 검증 대상 값 */
  dataValue?: unknown
  /** @since 3.2 — 와이어 포맷 직렬화 */
  serializedValue?: string
  externalValue?: string
  /** @deprecated 3.2에서 dataValue로 대체 */
  value?: unknown
} & OasExtensions

export type OasLink = {
  operationRef?: string
  operationId?: string
  parameters?: Record<string, unknown>
  requestBody?: unknown
  description?: string
  server?: OasServer
} & OasExtensions
