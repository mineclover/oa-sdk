import type { OasDocument } from './oas32-types.js'
import { runPipeline, DEFAULT_PASSES, type SpecPass } from './pipeline.js'
import type { RouteIndex } from './types.js'
import { buildRouteIndex } from './route-index.js'
export { HTTP_METHODS, matchRoute } from './route-match.js'

/**
 * Run the SpecPass pipeline and index the result by path and method.
 *
 * Returns the same RouteIndex as `parseDocument(spec, passes).routes`; both
 * use the shared route-index builder. It skips the rest of the
 * `ParsedDocument` IR, including `$ref` completeness evidence, so use
 * `parseDocument` when unresolved references must be detected.
 */
export function loadSchema(spec: unknown, passes: SpecPass[] = DEFAULT_PASSES): RouteIndex {
  const resolved = runPipeline(spec, passes) as OasDocument
  return buildRouteIndex(resolved)
}
