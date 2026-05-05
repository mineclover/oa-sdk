/**
 * v0.3 — spec binding (`x-persona` projection).
 *
 * Personas matrix is the source of truth. The merged OpenAPI spec is a
 * derived projection that gets `x-persona` extension fields injected per
 * operation, plus an `info.x-persona-meta` summary block.
 *
 * Pure: no I/O. Takes a parsed spec + matrices, returns a new spec.
 *
 * Drift detection: computeExpectedBindings() returns the canonical
 * (operationId → personaId[]) map; validators can compare against an
 * existing binding artifact to detect stale .merged.persona.yaml.
 */

import type { DomainMatrix, Persona } from './types.js'
import { isHttpDomain } from './kind.js'

/** Minimal OpenAPI shape — we only touch paths/operations and info. */
export interface MinimalOpenApiDoc {
  info?: Record<string, unknown>
  paths?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export interface BindingMeta {
  version: string                  // personas registry version
  matrices: number
  personas: number
  implemented: number
  proposed: number
  generatedAt: string              // ISO timestamp
}

export interface BindOptions {
  /** Personas registry version, copied into x-persona-meta. */
  registryVersion: string
  /** Override the generation timestamp (for deterministic tests). */
  generatedAt?: string
  /** Mutate input doc in place (default false — returns deep copy). */
  inPlace?: boolean
}

/**
 * Build the canonical operationId → [personaId, ...] map from matrices.
 * Only `implemented` personas justify a binding.
 *
 * v0.13: skips non-`openapi-http` domains — their `maps_to` entries (e.g.
 * `cli:validate`) are synthetic and have no operationId in the OpenAPI spec.
 */
export function computeExpectedBindings(domains: DomainMatrix[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const matrix of domains) {
    if (!isHttpDomain(matrix)) continue
    for (const persona of matrix.personas) {
      if (persona.status !== 'implemented') continue
      for (const opId of persona.outcome?.maps_to ?? []) {
        const list = out.get(opId) ?? []
        if (!list.includes(persona.id)) list.push(persona.id)
        out.set(opId, list)
      }
    }
  }
  // sort persona ids per operation for deterministic output
  for (const [k, v] of out.entries()) out.set(k, [...v].sort())
  return out
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])

/**
 * Inject `x-persona: [persona-id, ...]` on every operation whose operationId
 * appears in the bindings map. Adds `info.x-persona-meta` summary.
 *
 * Operations without a binding receive `x-persona: []` (explicit unjustified
 * marker — easier to grep than "absent" property).
 */
export function applyBindings(
  doc: MinimalOpenApiDoc,
  domains: DomainMatrix[],
  options: BindOptions,
): MinimalOpenApiDoc {
  const target = options.inPlace ? doc : structuredClone(doc)
  const bindings = computeExpectedBindings(domains)

  for (const pathItem of Object.values(target.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      if (!op || typeof op !== 'object') continue
      const operation = op as { operationId?: string;[key: string]: unknown }
      if (!operation.operationId) continue
      const personas = bindings.get(operation.operationId) ?? []
      operation['x-persona'] = personas
    }
  }

  target.info = target.info ?? {}
  target.info['x-persona-meta'] = computeMeta(domains, options)

  return target
}

function computeMeta(domains: DomainMatrix[], options: BindOptions): BindingMeta {
  let personas = 0
  let implemented = 0
  let proposed = 0
  for (const m of domains) {
    for (const p of m.personas) {
      personas++
      if (p.status === 'implemented') implemented++
      else if (p.status === 'proposed') proposed++
    }
  }
  return {
    version: options.registryVersion,
    matrices: domains.length,
    personas,
    implemented,
    proposed,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  }
}

// ─── drift detection ──────────────────────────────────────────────────────

export interface BindingDrift {
  operationId: string
  expected: string[]
  actual: string[]
}

/**
 * Compare an existing bound spec against what matrices would currently
 * produce. Returns the operationIds whose x-persona disagrees.
 *
 * Used by validators to detect stale .merged.persona.yaml.
 */
export function detectDrift(
  boundDoc: MinimalOpenApiDoc,
  domains: DomainMatrix[],
): BindingDrift[] {
  const expected = computeExpectedBindings(domains)
  const drift: BindingDrift[] = []
  const seen = new Set<string>()

  for (const pathItem of Object.values(boundDoc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      if (!op || typeof op !== 'object') continue
      const operation = op as { operationId?: string; 'x-persona'?: unknown }
      if (!operation.operationId) continue
      seen.add(operation.operationId)
      const actual = Array.isArray(operation['x-persona'])
        ? [...operation['x-persona'] as unknown[]].filter((v): v is string => typeof v === 'string').sort()
        : []
      const want = expected.get(operation.operationId) ?? []
      if (!arraysEqual(actual, want)) {
        drift.push({ operationId: operation.operationId, expected: want, actual })
      }
    }
  }

  // operations expected by matrices but missing from spec → drift
  for (const [opId, want] of expected.entries()) {
    if (!seen.has(opId)) {
      drift.push({ operationId: opId, expected: want, actual: [] })
    }
  }

  return drift
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
