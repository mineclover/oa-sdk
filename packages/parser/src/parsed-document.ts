import type {
  CompleteParsedDocument,
  ParsedDocument,
  ParsedDocumentRefDiagnostic,
  ParsedDocumentRefResolution,
  ParsedDocumentRefResolutionScope,
} from './types.js'

export type CreateParsedDocumentRefResolutionOptions = {
  document: unknown
  scope: ParsedDocumentRefResolutionScope
  diagnostics?: readonly ParsedDocumentRefDiagnostic[]
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
    ...collectRemainingRefDiagnostics(options.document, options.diagnostics ?? []),
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
): ParsedDocumentRefDiagnostic[] {
  const diagnostics: ParsedDocumentRefDiagnostic[] = []

  visit(document, '#')
  return diagnostics

  function visit(value: unknown, pointer: string): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${index}`))
      return
    }
    if (!isRecord(value)) return

    const ref = typeof value['$ref'] === 'string' ? value['$ref'] : undefined
    const sourcePointer = `${pointer}/$ref`
    if (ref && !existing.some(diagnostic => diagnostic.ref === ref)) {
      if (ref === '#' || ref.startsWith('#/')) {
        const found = resolveInternalPointer(document, ref) !== undefined
        diagnostics.push({
          code: found ? 'unsupported-ref' : 'ref-not-found',
          ref,
          sourcePointer,
          pointer: ref,
          message: found
            ? `Internal $ref remains unresolved: ${ref}`
            : `Reference target was not found: ${ref}`,
        })
      } else if (!ref.startsWith('#')) {
        diagnostics.push({
          code: 'external-ref-unresolved',
          ref,
          sourcePointer,
          message: `External $ref requires a loader and remains unresolved: ${ref}`,
        })
      } else {
        diagnostics.push({
          code: 'unsupported-ref',
          ref,
          sourcePointer,
          message: `Unsupported internal $ref format: ${ref}`,
        })
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') continue
      visit(child, `${pointer}/${escapeJsonPointer(key)}`)
    }
  }
}

function resolveInternalPointer(root: unknown, ref: string): unknown {
  if (ref === '#') return root
  let value = root
  for (const segment of ref.slice(2).split('/').map(unescapeJsonPointer)) {
    if (!isRecord(value) && !Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
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

function escapeJsonPointer(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function unescapeJsonPointer(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
