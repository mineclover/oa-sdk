import type {
  CompleteParsedDocument,
  ParsedDocument,
  ParsedDocumentRefDiagnostic,
  ParsedDocumentRefResolution,
  ParsedDocumentRefResolutionScope,
} from './types.js'
import { escapeJsonPointerToken, isJsonPointerFragment, resolveJsonPointer } from './json-pointer.js'
import { getOwnString } from './safe-record.js'

export type CreateParsedDocumentRefResolutionOptions = {
  document: unknown
  scope: ParsedDocumentRefResolutionScope
  diagnostics?: readonly ParsedDocumentRefDiagnostic[]
  /**
   * Refs the resolver cut as valid recursion (see `recursion-guard.ts`). With
   * `cycleStrategy: 'preserve-ref'` they remain in the document as recursion
   * edges and are not reported as unresolved.
   */
  recursiveRefs?: readonly string[]
}

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

/** Build stable completeness evidence from resolver diagnostics and remaining refs. */
export function createParsedDocumentRefResolution(
  options: CreateParsedDocumentRefResolutionOptions,
): ParsedDocumentRefResolution {
  const diagnostics = dedupeDiagnostics([
    ...(options.diagnostics ?? []),
    ...collectRemainingRefDiagnostics(
      options.document,
      options.diagnostics ?? [],
      options.recursiveRefs ?? [],
    ),
  ])

  return {
    status: diagnostics.length === 0 ? 'complete' : 'partial',
    scope: options.scope,
    diagnostics,
  }
}

export function isParsedDocumentComplete(value: unknown): value is CompleteParsedDocument {
  if (!isParsedDocument(value)) return false
  const resolution = value.resolution
  return resolution?.status === 'complete'
    && isResolutionScope(resolution.scope)
    && Array.isArray(resolution.diagnostics)
    && resolution.diagnostics.length === 0
}

/** Raised when a generator would otherwise silently consume an incomplete IR. */
export class IncompleteParsedDocumentError extends Error {
  override readonly name = 'IncompleteParsedDocumentError'

  constructor(
    readonly consumer: string,
    readonly resolution: ParsedDocumentRefResolution | undefined,
  ) {
    super(buildIncompleteDocumentMessage(consumer, resolution))
  }
}

export function assertParsedDocumentComplete(
  document: ParsedDocument,
  consumer = 'This operation',
): asserts document is CompleteParsedDocument {
  if (!isParsedDocumentComplete(document)) {
    throw new IncompleteParsedDocumentError(consumer, document.resolution)
  }
}

function collectRemainingRefDiagnostics(
  document: unknown,
  existing: readonly ParsedDocumentRefDiagnostic[],
  recursiveRefs: readonly string[],
): ParsedDocumentRefDiagnostic[] {
  const diagnostics: ParsedDocumentRefDiagnostic[] = []
  const coveredRefs = new Set([...existing.map(diagnostic => diagnostic.ref), ...recursiveRefs])
  // Deref output may share subtrees between use sites. A subtree without an
  // uncovered $ref yields no diagnostic at any pointer, so it is walked once.
  const cleanSubtrees = new WeakSet<object>()

  visit(document, ROOT_POINTER_PATH)
  return diagnostics

  function visit(value: unknown, path: PointerPath): boolean {
    if (!value || typeof value !== 'object') return false
    if (cleanSubtrees.has(value)) return false

    let found = false
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (visit(item, { parent: path, segment: String(index) })) found = true
      })
    } else {
      const record = value as Record<string, unknown>
      const ref = getOwnString(record, '$ref')
      if (ref && !coveredRefs.has(ref)) {
        found = true
        diagnostics.push(remainingRefDiagnostic(document, ref, `${formatPointerPath(path)}/$ref`))
      }
      for (const [key, child] of Object.entries(record)) {
        if (key === '$ref') continue
        if (visit(child, { parent: path, segment: escapeJsonPointerToken(key) })) found = true
      }
    }

    if (!found) cleanSubtrees.add(value)
    return found
  }
}

/** Pointer built only when a diagnostic needs it; walking stays O(nodes). */
type PointerPath = { parent: PointerPath | undefined; segment: string }

const ROOT_POINTER_PATH: PointerPath = { parent: undefined, segment: '#' }

function formatPointerPath(path: PointerPath): string {
  const segments: string[] = []
  for (let node: PointerPath | undefined = path; node; node = node.parent) segments.push(node.segment)
  return segments.reverse().join('/')
}

function remainingRefDiagnostic(
  document: unknown,
  ref: string,
  sourcePointer: string,
): ParsedDocumentRefDiagnostic {
  if (isJsonPointerFragment(ref)) {
    const found = resolveJsonPointer(document, ref) !== undefined
    return {
      code: found ? 'unsupported-ref' : 'ref-not-found',
      ref,
      sourcePointer,
      pointer: ref,
      message: found
        ? `Internal $ref remains unresolved: ${ref}`
        : `Reference target was not found: ${ref}`,
    }
  }
  if (!ref.startsWith('#')) {
    return {
      code: 'external-ref-unresolved',
      ref,
      sourcePointer,
      message: `External $ref requires a loader and remains unresolved: ${ref}`,
    }
  }
  return {
    code: 'unsupported-ref',
    ref,
    sourcePointer,
    message: `Unsupported internal $ref format: ${ref}`,
  }
}

function dedupeDiagnostics(
  diagnostics: readonly ParsedDocumentRefDiagnostic[],
): ParsedDocumentRefDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = [diagnostic.code, diagnostic.ref, diagnostic.sourcePointer ?? ''].join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildIncompleteDocumentMessage(
  consumer: string,
  resolution: ParsedDocumentRefResolution | undefined,
): string {
  if (!resolution) {
    return `${consumer} requires complete $ref resolution, but the ParsedDocument has no resolution metadata. Reparse the source document with @oa-sdk/parser.`
  }

  const details = resolution.diagnostics
    .slice(0, 3)
    .map(diagnostic => `${diagnostic.code} (${diagnostic.ref})`)
    .join(', ')
  const suffix = resolution.diagnostics.length > 3
    ? `, and ${resolution.diagnostics.length - 3} more`
    : ''
  return `${consumer} requires complete $ref resolution; received a partial ParsedDocument: ${details}${suffix}.`
}

function isResolutionScope(value: unknown): value is ParsedDocumentRefResolutionScope {
  return value === 'internal' || value === 'all' || value === 'custom'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
