/**
 * OAS 3.2 Security Scheme Object (§4.8.27) + OAuth Flows/Flow Objects
 *
 * 참조: docs/references/oas32/14-security.md
 */

import type { OasExtensions } from './common.js'

export type OasSecuritySchemeType = 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS'

export type OasSecurityScheme = {
  type: OasSecuritySchemeType
  description?: string
  /** type=apiKey 시 필수 */
  name?: string
  /** type=apiKey 시 필수: 'query' | 'header' | 'cookie' */
  in?: 'query' | 'header' | 'cookie'
  /** type=http 시 필수 */
  scheme?: string
  bearerFormat?: string
  /** type=oauth2 시 필수 */
  flows?: OasOAuthFlows
  /** type=openIdConnect 시 필수 */
  openIdConnectUrl?: string
  /** @since 3.2 */
  oauth2MetadataUrl?: string
  deprecated?: boolean
} & OasExtensions

export type OasOAuthFlows = {
  implicit?: OasOAuthFlow
  password?: OasOAuthFlow
  clientCredentials?: OasOAuthFlow
  authorizationCode?: OasOAuthFlow
  /** @since 3.2 — RFC 8628 Device Authorization */
  deviceAuthorization?: OasOAuthFlow
} & OasExtensions

export type OasOAuthFlow = {
  authorizationUrl?: string
  /** @since 3.2 — deviceAuthorization 시 필수 */
  deviceAuthorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes: Record<string, string>
} & OasExtensions

export type OasSecurityRequirement = Record<string, string[]>
