import type { ParsedDocument } from './types.js'

/**
 * Distinguish the parser IR from a raw OpenAPI document at runtime.
 *
 * Both shapes expose an `openapi` field, so that field cannot be used as a
 * discriminator. The parser IR owns Map-backed indexes and flattened operation
 * arrays that a raw OpenAPI document does not have.
 */
export function isParsedDocument(value: unknown): value is ParsedDocument {
  if (!isRecord(value)) return false

  return typeof value.openapi === 'string'
    && Array.isArray(value.servers)
    && value.tags instanceof Map
    && Array.isArray(value.operations)
    && value.routes instanceof Map
    && isRecord(value.schemas)
    && isRecord(value.securitySchemes)
    && Array.isArray(value.security)
    && isRecord(value.components)
    && Array.isArray(value.webhooks)
    && isRecord(value.raw)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
