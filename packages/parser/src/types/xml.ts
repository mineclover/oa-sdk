/**
 * OAS 3.2 XML Object (§4.8.25)
 *
 * 참조: docs/references/oas32/13-xml.md
 */

import type { OasExtensions } from './common.js'

export type OasXmlNodeType = 'element' | 'attribute' | 'text' | 'cdata' | 'none'

export type OasXml = {
  /** @since 3.2 — replaces attribute/wrapped */
  nodeType?: OasXmlNodeType
  name?: string
  namespace?: string
  prefix?: string
  /** @deprecated Use nodeType instead */
  attribute?: boolean
  /** @deprecated Use nodeType instead */
  wrapped?: boolean
} & OasExtensions
