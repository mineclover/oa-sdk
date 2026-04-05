/**
 * OAS 3.2 Root Document (§4.8.1) + Info Object (§4.8.2) + Contact (§4.8.3) + License (§4.8.4)
 *
 * 참조: docs/references/oas32/03-document-structure.md
 */

import type { OasExtensions, Referenceable } from './common.js'
import type { OasServer } from './server.js'
import type { OasPaths, OasComponents } from './components.js'
import type { OasPathItem } from './operations.js'
import type { OasExternalDocs } from './operations.js'
import type { OasTag } from './headers-tags.js'
import type { OasSecurityRequirement } from './security.js'

export type OasDocument = {
  openapi: string
  /** @since 3.2 */
  $self?: string
  info: OasInfo
  jsonSchemaDialect?: string
  servers?: OasServer[]
  paths?: OasPaths
  /** @since 3.2 — incoming webhooks */
  webhooks?: Record<string, Referenceable<OasPathItem>>
  components?: OasComponents
  security?: OasSecurityRequirement[]
  tags?: OasTag[]
  externalDocs?: OasExternalDocs
} & OasExtensions

export type OasInfo = {
  title: string
  /** @since 3.2 */
  summary?: string
  description?: string
  termsOfService?: string
  contact?: OasContact
  license?: OasLicense
  version: string
} & OasExtensions

export type OasContact = {
  name?: string
  url?: string
  email?: string
} & OasExtensions

export type OasLicense = {
  name: string
  /** @since 3.2 — SPDX license expression */
  identifier?: string
  url?: string
} & OasExtensions
