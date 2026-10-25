import { loadSchema, type OasDocument } from '@oa-sdk/parser'

/** Independent contract goals; omitted purpose preserves legacy mixed-pipeline behavior. */
export type PipelinePurpose = 'api' | 'data' | 'interface'

export function isPipelinePurpose(value: unknown): value is PipelinePurpose {
  return value === 'api' || value === 'data' || value === 'interface'
}

/** Shared admission rule used by plugin builds and config-driven spec targets. */
export function assertPipelinePurpose(
  document: OasDocument | Record<string, unknown>,
  purpose?: PipelinePurpose,
): void {
  if (purpose === undefined) return

  const routes = loadSchema(document, [])
  const operations = [...routes.values()].reduce((count, methods) => count + methods.size, 0)
  const components = document.components
  const modelSchemas = components && typeof components === 'object' && 'schemas' in components
    ? components.schemas
    : undefined
  const schemas = modelSchemas && typeof modelSchemas === 'object' ? Object.keys(modelSchemas).length : 0

  if (purpose === 'data' && operations > 0) {
    throw new Error('Data pipelines must not contain HTTP operations; use a separate api/interface target.')
  }
  if (purpose === 'api' && operations === 0) {
    throw new Error('API pipelines require at least one HTTP operation; use purpose: "data" for model-only contracts.')
  }
  if ((purpose === 'data' || purpose === 'interface') && schemas === 0 && operations === 0) {
    throw new Error('The pipeline contains no emitted models or operations. For model-only TypeSpec, declare an @service namespace so the OpenAPI emitter includes its models.')
  }
}
