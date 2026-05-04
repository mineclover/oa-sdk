/**
 * Filesystem loaders for registry, traits, and per-domain matrices.
 * Pure I/O — no validation logic.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import type { Registry, TraitVocabulary, DomainMatrix, DataModelPersona } from './types.js'

const __dir = dirname(fileURLToPath(import.meta.url))

export function defaultPackageRoot(): string {
  return join(__dir, '..')
}

export function loadRegistry(packageRoot: string = defaultPackageRoot()): Registry {
  const path = join(packageRoot, 'src', 'registry.yaml')
  return parse(readFileSync(path, 'utf8')) as Registry
}

export function loadTrait(vocabularyRef: string, packageRoot: string = defaultPackageRoot()): TraitVocabulary {
  const path = join(packageRoot, 'src', vocabularyRef)
  return parse(readFileSync(path, 'utf8')) as TraitVocabulary
}

export function loadAllTraits(registry: Registry, packageRoot: string = defaultPackageRoot()): Map<string, TraitVocabulary> {
  const map = new Map<string, TraitVocabulary>()
  for (const bucket of Object.values(registry.buckets)) {
    for (const [dim, spec] of Object.entries(bucket.dimensions)) {
      if (spec.vocabulary) {
        map.set(dim, loadTrait(spec.vocabulary, packageRoot))
      }
    }
  }
  return map
}

export function loadDomain(name: string, packageRoot: string = defaultPackageRoot()): DomainMatrix {
  const path = join(packageRoot, 'src', 'domains', `${name}.personas.yaml`)
  return parse(readFileSync(path, 'utf8')) as DomainMatrix
}

export function listDomains(packageRoot: string = defaultPackageRoot()): string[] {
  const dir = join(packageRoot, 'src', 'domains')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.personas.yaml'))
    .map(f => f.replace('.personas.yaml', ''))
    .sort()
}

export function loadAllDomains(packageRoot: string = defaultPackageRoot()): DomainMatrix[] {
  return listDomains(packageRoot).map(n => loadDomain(n, packageRoot))
}

// ─── data-modeling personas ──────────────────────────────────────────────

export function listDataModels(packageRoot: string = defaultPackageRoot()): string[] {
  const dir = join(packageRoot, 'src', 'data-models')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.persona.yaml'))
    .map(f => f.replace('.persona.yaml', ''))
    .sort()
}

export function loadDataModel(name: string, packageRoot: string = defaultPackageRoot()): DataModelPersona {
  const path = join(packageRoot, 'src', 'data-models', `${name}.persona.yaml`)
  return parse(readFileSync(path, 'utf8')) as DataModelPersona
}

export function loadAllDataModels(packageRoot: string = defaultPackageRoot()): DataModelPersona[] {
  return listDataModels(packageRoot).map(n => loadDataModel(n, packageRoot))
}

export interface OperationInfo {
  operationId: string
  path: string
  method: string
  /** Status code keys declared in the operation's `responses` (e.g. "200", "401", "default"). */
  responses: Set<string>
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'])

/**
 * Load operations (id + path + method + declared response status codes) from a
 * merged OpenAPI spec. Returns null if the spec file does not exist.
 *
 * Used by validators (maps_to existence + expects ⊆ responses) and coverage
 * (response status orphan detection).
 */
export function loadOperationsFromMergedSpec(specPath: string): Map<string, OperationInfo> | null {
  if (!existsSync(specPath)) return null
  const doc = parse(readFileSync(specPath, 'utf8')) as {
    paths?: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>
  }
  const out = new Map<string, OperationInfo>()
  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      if (!op || typeof op !== 'object' || typeof op.operationId !== 'string') continue
      out.set(op.operationId, {
        operationId: op.operationId,
        path,
        method,
        responses: new Set(Object.keys(op.responses ?? {})),
      })
    }
  }
  return out
}

/**
 * @deprecated use loadOperationsFromMergedSpec — kept for tests that only need ids.
 */
export function loadOperationIdsFromMergedSpec(specPath: string): Set<string> | null {
  const ops = loadOperationsFromMergedSpec(specPath)
  return ops === null ? null : new Set(ops.keys())
}
