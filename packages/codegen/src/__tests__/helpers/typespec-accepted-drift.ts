import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  diffOpenApiDocuments,
  stableOpenApiStringify,
  type OpenApiNormalizedDiffEntry,
} from '../../cli/lib/openapi-normalized-diff.js'

export type AcceptedTypeSpecDriftEntry = Pick<OpenApiNormalizedDiffEntry, 'category' | 'kind' | 'pointer'> & {
  productionSha256: string
  restoredSha256: string
}

export function loadAcceptedTypeSpecDriftEntries(path: string): AcceptedTypeSpecDriftEntry[] {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    schemaVersion?: unknown
    entries?: unknown
  }
  if (manifest.schemaVersion !== 'oa-sdk.typespec-restored-drift.v2' || !Array.isArray(manifest.entries)) {
    throw new Error(`invalid accepted TypeSpec drift manifest: ${path}`)
  }
  return manifest.entries as AcceptedTypeSpecDriftEntry[]
}

export function createAcceptedTypeSpecDriftReport(
  productionDocument: Record<string, unknown>,
  restoredDocument: Record<string, unknown>,
): {
  diff: OpenApiNormalizedDiffEntry[]
  entries: AcceptedTypeSpecDriftEntry[]
} {
  const diff = diffOpenApiDocuments(productionDocument, restoredDocument)
  return {
    diff,
    entries: diff.map(entry => ({
      category: entry.category,
      kind: entry.kind,
      pointer: entry.pointer,
      productionSha256: hashOpenApiValue(readJsonPointer(productionDocument, entry.pointer), entry.pointer),
      restoredSha256: hashOpenApiValue(readJsonPointer(restoredDocument, entry.pointer), entry.pointer),
    })),
  }
}

function hashOpenApiValue(value: unknown, pointer: string): string {
  return createHash('sha256').update(stableOpenApiStringify(value, pointer)).digest('hex')
}

function readJsonPointer(document: Record<string, unknown>, pointer: string): unknown {
  if (pointer === '#') return document
  if (!pointer.startsWith('#/')) throw new Error(`unsupported JSON pointer: ${pointer}`)
  let value: unknown = document
  for (const segment of pointer.slice(2).split('/').map(decodeJsonPointerSegment)) {
    if (Array.isArray(value)) {
      value = value[Number(segment)]
      continue
    }
    if (isRecord(value)) {
      value = value[segment]
      continue
    }
    return undefined
  }
  return value
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
