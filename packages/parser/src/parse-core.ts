import type {
  OasDocument,
  OasSecurityScheme,
  OasSchema,
  Referenceable,
} from './oas32-types.js'
import type { ParsedDocument, ParsedDocumentRefResolution } from './types.js'
import { createParsedDocumentRefResolution } from './parsed-document.js'
import { createSafeRecord } from './safe-record.js'
import { extractWebhookOperations, indexPathOperations } from './route-index.js'

/**
 * Build the ParsedDocument IR from a pipeline-resolved document.
 *
 * Operations, routes and webhooks come from the shared route-index builder
 * that `loadSchema` also uses.
 */
export function parseResolvedDocument(
  resolved: OasDocument,
  raw: OasDocument = resolved,
  resolution?: ParsedDocumentRefResolution,
): ParsedDocument {
  const { operations, routes } = indexPathOperations(resolved)
  const webhooks = extractWebhookOperations(resolved)

  const components = resolved.components ?? {}

  const tagMap = new Map<string, NonNullable<OasDocument['tags']>[number]>()
  for (const tag of resolved.tags ?? []) {
    tagMap.set(tag.name, tag)
  }

  const securitySchemes = createSafeRecord<OasSecurityScheme>()
  for (const [name, scheme] of Object.entries(components.securitySchemes ?? {})) {
    const resolvedScheme = deref(scheme)
    if (resolvedScheme) securitySchemes[name] = resolvedScheme
  }

  return {
    openapi: resolved.openapi,
    info: resolved.info,
    servers: resolved.servers ?? [],
    tags: tagMap,
    operations,
    routes,
    schemas: (components.schemas ?? {}) as Record<string, OasSchema>,
    securitySchemes,
    security: resolved.security ?? [],
    components: {
      responses: derefMap(components.responses),
      parameters: derefMap(components.parameters),
      requestBodies: derefMap(components.requestBodies),
      examples: derefMap(components.examples),
      headers: derefMap(components.headers),
      links: derefMap(components.links),
      callbacks: derefMap(components.callbacks),
      pathItems: components.pathItems ?? {},
      mediaTypes: derefMap(components.mediaTypes),
    },
    webhooks,
    raw,
    resolution: resolution ?? createParsedDocumentRefResolution({
      document: resolved,
      scope: 'custom',
    }),
  }
}

function deref<T>(item: Referenceable<T> | undefined): T | undefined {
  if (!item || typeof item !== 'object') return undefined
  const record = item as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, '$ref') && typeof record.$ref === 'string') return undefined
  return item as T
}

function derefMap<T>(map: Record<string, Referenceable<T>> | undefined): Record<string, T> {
  if (!map) return createSafeRecord<T>()
  const result = createSafeRecord<T>()
  for (const [key, value] of Object.entries(map)) {
    const resolved = deref(value)
    if (resolved) result[key] = resolved
  }
  return result
}
