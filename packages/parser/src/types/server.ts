/**
 * OAS 3.2 Server Object (§4.8.5) + Server Variable Object (§4.8.6)
 *
 * 참조: docs/references/oas32/04-server.md
 */

import type { OasExtensions } from './common.js'

export type OasServer = {
  url: string
  description?: string
  /** @since 3.2 */
  name?: string
  variables?: Record<string, OasServerVariable>
} & OasExtensions

export type OasServerVariable = {
  enum?: string[]
  default: string
  description?: string
} & OasExtensions
