/**
 * v0.4 — persona-driven response resolver.
 *
 * Pure functions that, given (personaId, operationId, spec, domains), return
 * the response a persona expects to receive: status code + body example +
 * content-type. This is the bridge between the persona matrix and any HTTP
 * mock or e2e harness.
 *
 * Design: matrices are SoT. The bound spec (.merged.persona.yaml) is a
 * derived projection — but we accept the plain merged spec too, since `maps_to`
 * lives in the matrix.
 */

import { statusMatches } from './validate.js'
import type { MinimalOpenApiDoc } from './bind.js'
import type { DomainMatrix, Persona } from './types.js'

export interface ResolvedPersonaResponse {
  personaId: string
  operationId: string
  path: string
  method: string
  status: number
  /** Selected content-type (e.g. "application/json"). Null if response has no content. */
  contentType: string | null
  /** Resolved body example, or null if none could be derived. */
  body: unknown | null
  /** Response schema for the chosen content-type, if available. */
  schema?: unknown
  /** Headers declared on the response (e.g. Retry-After for 429). */
  headers: Record<string, unknown>
  /** Notes — why this status / why null body / etc. */
  source: 'examples-default' | 'value' | 'example' | 'schema-example' | 'none'
}

export interface ResolveOptions {
  spec: MinimalOpenApiDoc
  domains: DomainMatrix[]
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])

export function findPersona(personaId: string, domains: DomainMatrix[]): { matrix: DomainMatrix; persona: Persona } | null {
  for (const matrix of domains) {
    const persona = matrix.personas.find(p => p.id === personaId)
    if (persona) return { matrix, persona }
  }
  return null
}

export function findOperation(spec: MinimalOpenApiDoc, operationId: string): { path: string; method: string; operation: Record<string, unknown> } | null {
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      if (!op || typeof op !== 'object') continue
      const operation = op as { operationId?: string }
      if (operation.operationId === operationId) {
        return { path, method, operation: operation as Record<string, unknown> }
      }
    }
  }
  return null
}

export function listPersonasForOperation(operationId: string, domains: DomainMatrix[]): Persona[] {
  const out: Persona[] = []
  for (const matrix of domains) {
    for (const persona of matrix.personas) {
      if (persona.status !== 'implemented') continue
      const ids = persona.outcome?.maps_to ?? []
      if (ids.includes(operationId)) out.push(persona)
    }
  }
  return out
}

export function resolvePersonaResponse(
  personaId: string,
  operationId: string,
  options: ResolveOptions,
): ResolvedPersonaResponse | null {
  const found = findPersona(personaId, options.domains)
  if (!found) return null
  const { persona } = found

  const expects = persona.outcome?.expects ?? []
  if (expects.length === 0) return null            // persona must claim a status

  const ids = persona.outcome?.maps_to ?? []
  if (!ids.includes(operationId)) return null      // persona doesn't claim this operation

  const op = findOperation(options.spec, operationId)
  if (!op) return null

  const expectedStatus = expects[0]!               // primary expected status
  const responses = (op.operation['responses'] ?? {}) as Record<string, unknown>
  const declaredKeys = new Set(Object.keys(responses))

  if (!statusMatches(expectedStatus, declaredKeys)) return null

  // Find matching response key: exact > range > default
  const responseKey = pickResponseKey(expectedStatus, declaredKeys)
  if (!responseKey) return null

  const responseRaw = responses[responseKey] as Record<string, unknown> | undefined
  if (!responseRaw) return null
  const response = followRef(options.spec, responseRaw)

  const { contentType, body, schema, source } = pickContentAndBody(response, options.spec)
  const headers = (response['headers'] as Record<string, unknown> | undefined) ?? {}

  const result: ResolvedPersonaResponse = {
    personaId,
    operationId,
    path: op.path,
    method: op.method.toLowerCase(),
    status: expectedStatus,
    contentType,
    body,
    headers,
    source,
  }
  if (schema !== undefined) result.schema = schema
  return result
}

/**
 * Follow `$ref` once. The merged spec produced by `pnpm merge` keeps refs
 * intact; we only need single-level resolution for `#/components/responses/X`,
 * `#/components/schemas/X`, etc. (Multi-hop refs would need a loop guard.)
 */
function followRef(spec: MinimalOpenApiDoc, node: Record<string, unknown>): Record<string, unknown> {
  const ref = node['$ref']
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node
  const parts = ref.slice(2).split('/')
  let cur: unknown = spec
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return node                          // ref not resolvable — return original
    }
  }
  return (cur && typeof cur === 'object') ? (cur as Record<string, unknown>) : node
}

function pickResponseKey(expected: number, declared: Set<string>): string | null {
  const exact = String(expected)
  if (declared.has(exact)) return exact
  if (expected >= 100 && expected <= 599) {
    const range = `${Math.floor(expected / 100)}XX`
    if (declared.has(range)) return range
  }
  if (declared.has('default')) return 'default'
  return null
}

interface ContentSelection {
  contentType: string | null
  body: unknown | null
  schema?: unknown
  source: ResolvedPersonaResponse['source']
}

/**
 * Body resolution priority (matches OAS 3.2 + mock-server convention):
 *   1. examples.default.dataValue
 *   2. examples.default.value
 *   3. example
 *   4. schema.example
 *   else null with source: 'none'
 */
function pickContentAndBody(response: Record<string, unknown>, spec: MinimalOpenApiDoc): ContentSelection {
  const content = response['content'] as Record<string, Record<string, unknown>> | undefined
  if (!content) return { contentType: null, body: null, source: 'none' }

  const [contentType, mediaTypeRaw] = Object.entries(content)[0] ?? [null, undefined]
  if (!contentType || !mediaTypeRaw) return { contentType: null, body: null, source: 'none' }

  const mediaType = followRef(spec, mediaTypeRaw)
  const schemaRaw = mediaType['schema']
  const schema = schemaRaw && typeof schemaRaw === 'object' ? followRef(spec, schemaRaw as Record<string, unknown>) : schemaRaw

  // examples block
  const examples = mediaType['examples'] as Record<string, Record<string, unknown>> | undefined
  if (examples) {
    const first = examples['default'] ?? Object.values(examples)[0]
    if (first) {
      if ('dataValue' in first) {
        const result: ContentSelection = { contentType, body: first['dataValue'], source: 'examples-default' }
        if (schema !== undefined) result.schema = schema
        return result
      }
      if ('value' in first) {
        const result: ContentSelection = { contentType, body: first['value'], source: 'value' }
        if (schema !== undefined) result.schema = schema
        return result
      }
    }
  }

  if ('example' in mediaType) {
    const result: ContentSelection = { contentType, body: mediaType['example'], source: 'example' }
    if (schema !== undefined) result.schema = schema
    return result
  }

  if (schema && typeof schema === 'object' && 'example' in (schema as Record<string, unknown>)) {
    return { contentType, body: (schema as Record<string, unknown>)['example'], schema, source: 'schema-example' }
  }

  const result: ContentSelection = { contentType, body: null, source: 'none' }
  if (schema !== undefined) result.schema = schema
  return result
}
