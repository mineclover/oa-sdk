import { loadSpecDocumentAsync } from './load-spec.js'
import { normalizeOpenApiDocument, type OpenApiCollectProfile } from './openapi-collect.js'

/**
 * The stable OpenAPI document of a spec, as `oa-gen normalize` writes it: an OpenAPI YAML/JSON
 * document as it is, or a TypeSpec (`.tsp`) entry point compiled to OpenAPI in memory, with its
 * keys sorted and, for a profile other than `generic`, the noise of that generator removed.
 *
 * `oa-gen init` creates the contract baseline of the enterprise archetype with it, so that the
 * baseline it writes is the one the scaffold's `oa-gen normalize` script rewrites.
 */
export async function loadNormalizedOpenApi(
  specPath: string,
  options: { rootDir?: string | undefined; profile?: OpenApiCollectProfile | undefined } = {},
): Promise<Record<string, unknown>> {
  const { document } = await loadSpecDocumentAsync(specPath, options.rootDir)
  return normalizeOpenApiDocument(document, { profile: options.profile ?? 'generic' })
}
