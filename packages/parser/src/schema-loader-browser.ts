import type { OasDocument } from './oas32-types.js'
import type { RouteIndex } from './types.js'
import { parseResolvedDocument } from './parse-core.js'

export function loadSchema(spec: unknown): RouteIndex {
  return parseResolvedDocument(spec as OasDocument).routes
}
