import { createHash } from 'node:crypto'

/**
 * The digest that binds `oa-sdk.typespec-ref-provenance.v1` to the restored
 * OpenAPI document it describes (`inputs.restoredOpenApiSha256`): sha256 of
 * the document serialized as JSON with object keys sorted by UTF-16 code unit.
 *
 * The provenance producer (`buildTypeSpecRefProvenance`) and every consumer
 * that checks the binding (`buildTypeSpecGeneratedGraphSemanticIndex`) use
 * this one definition, so the two sides cannot disagree on the serialization.
 */
export function typeSpecRestoredOpenApiSha256(document: unknown): string {
  return stableJsonSha256(document)
}

/** sha256 of a JSON value serialized with object keys sorted by UTF-16 code unit. */
export function stableJsonSha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
