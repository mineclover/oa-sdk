import { bundleExternalRefs } from './bundle-external-refs.js'
import { loadSpecDocumentAsync } from './load-spec.js'
import { normalizeOpenApiDocument, type OpenApiCollectProfile } from './openapi-collect.js'

/**
 * The stable OpenAPI document of a spec, as `oa-gen normalize` writes it: an OpenAPI YAML/JSON
 * document with the files its `$ref`s name copied in (`bundleExternalRefs`), or a TypeSpec (`.tsp`)
 * entry point compiled to OpenAPI in memory, with its keys sorted and, for a profile other than
 * `generic`, the noise of that generator removed. It stands alone wherever it is written.
 *
 * `oa-gen init` creates the contract baseline of the enterprise archetype with it, so that the
 * baseline it writes is the one the scaffold's `oa-gen normalize` script rewrites, and a snapshot
 * of the whole contract even when the spec spans several files.
 */
export async function loadNormalizedOpenApi(
  specPath: string,
  options: { rootDir?: string | undefined; profile?: OpenApiCollectProfile | undefined } = {},
): Promise<Record<string, unknown>> {
  const { document, path } = await loadSpecDocumentAsync(specPath, options.rootDir)
  return normalizeOpenApiDocument(bundleExternalRefs(document, path), { profile: options.profile ?? 'generic' })
}
