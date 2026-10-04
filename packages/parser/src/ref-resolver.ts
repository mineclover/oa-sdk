import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { canonicalJsonPointerFragment, isJsonPointerFragment, resolveJsonPointer } from './json-pointer.js'
import type { RefStackView } from './ref-expansion-memo.js'

export type RefResolverKind = 'internal' | 'external' | 'unsupported'

export type RefResolverDiagnosticCode =
  | 'ref-cycle'
  | 'ref-not-found'
  | 'external-ref-read-failed'
  | 'external-ref-pointer-not-found'
  | 'unsupported-ref'

export type RefResolverDiagnostic = {
  code: RefResolverDiagnosticCode
  ref: string
  message: string
  sourcePointer?: string
  sourceFilePath?: string
  filePath?: string
  pointer?: string
  line?: number
  column?: number
}

export type RefDocumentCache = Map<string, unknown>

export type RefResolverOptions = {
  /** File of the in-memory entry document (`root` of requests without another `basePath`). */
  entryPath?: string
  documentCache?: RefDocumentCache
  /**
   * Report `filePath`/`documentCacheKey` for internal refs inside non-entry documents
   * (default true). Reporting only: `cacheKey` always names the target document.
   */
  includeInternalFilePath?: boolean
  lookupSourceLocation?: (filePath: string, pointer: string) => { line: number; column: number } | undefined
}

export type ResolveRefRequest = {
  ref: string
  sourcePointer: string
  root: unknown
  basePath?: string
  /** 현재 전개 중인 대상 cacheKey 목록. 크기가 큰 경우 `has` 조회 뷰를 넘긴다. */
  stack?: readonly string[] | RefStackView
}

export type RefResolution = {
  ref: string
  kind: RefResolverKind
  sourcePointer: string
  resolved: boolean
  /**
   * Target identity: document key + canonical pointer. The entry document is
   * `<root>` whether it is the in-memory root or its file reached through an
   * external ref; any other document is keyed by its file path. Cycle stacks
   * compare these keys, so the same pointer in two documents never collides.
   */
  cacheKey: string
  documentCacheKey?: string
  basePath?: string
  sourceFilePath?: string
  filePath?: string
  pointer?: string
  target?: unknown
  documentRoot?: unknown
  diagnostic?: RefResolverDiagnostic
}

export interface RefResolver {
  resolve(request: ResolveRefRequest): RefResolution
  loadExternalDocument(filePath: string): unknown
  /**
   * Spell `ref`, written in the document at `basePath`, so that it names the same
   * target from the entry document: `#...` for a target in the entry document,
   * otherwise the target file relative to the entry file's directory plus the
   * fragment as written. A ref written in the entry document, or any ref when
   * there is no `entryPath`, is returned unchanged.
   */
  entryRelativeRef(ref: string, basePath: string | undefined): string
}

const ENTRY_DOCUMENT_KEY = '<root>'

export function createRefResolver(options: RefResolverOptions = {}): RefResolver {
  const documentCache = options.documentCache ?? new Map<string, unknown>()
  const includeInternalFilePath = options.includeInternalFilePath ?? true
  const entryFilePath = options.entryPath === undefined ? undefined : resolve(options.entryPath)
  const documentKeys = new Map<string, string>()

  /** Cache key prefix of the document at `filePath`; the entry file is `<root>` however it is spelled. */
  function documentKey(filePath: string | undefined): string {
    if (!filePath || filePath === options.entryPath) return ENTRY_DOCUMENT_KEY
    let key = documentKeys.get(filePath)
    if (key === undefined) {
      key = resolve(filePath) === entryFilePath ? ENTRY_DOCUMENT_KEY : filePath
      documentKeys.set(filePath, key)
    }
    return key
  }

  function entryRelativeRef(ref: string, basePath: string | undefined): string {
    if (entryFilePath === undefined || basePath === undefined) return ref
    if (documentKey(basePath) === ENTRY_DOCUMENT_KEY) return ref

    const hashIndex = ref.indexOf('#')
    const filePart = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
    const fragment = hashIndex === -1 ? '' : ref.slice(hashIndex)
    if (filePart && !isRelativeRef(ref)) return ref

    const targetPath = filePart ? resolve(dirname(basePath), filePart) : basePath
    if (documentKey(targetPath) === ENTRY_DOCUMENT_KEY) return fragment || '#'
    return `${fileReference(dirname(entryFilePath), resolve(targetPath))}${fragment}`
  }

  function loadExternalDocument(filePath: string): unknown {
    if (documentCache.has(filePath)) return documentCache.get(filePath)

    const document = parseExternalRefFile(filePath)
    documentCache.set(filePath, document)
    return document
  }

  function resolveRef(request: ResolveRefRequest): RefResolution {
    const stack = request.stack ?? []
    let resolution: RefResolution
    if (isJsonPointerFragment(request.ref)) {
      resolution = resolveInternalRef(request, stack)
    } else if (isRelativeRef(request.ref) && request.basePath) {
      resolution = resolveExternalRef(request, stack)
    } else {
      resolution = unresolved(request, 'unsupported', {
        code: 'unsupported-ref',
        ref: request.ref,
        message: `지원하지 않는 $ref 형식: ${request.ref}`,
      })
    }

    return enrichResolutionDiagnosticLocation(resolution, options.lookupSourceLocation)
  }

  function resolveInternalRef(request: ResolveRefRequest, stack: RefStack): RefResolution {
    const pointer = canonicalJsonPointerFragment(request.ref) ?? request.ref
    const sourceFilePath = request.basePath
    const filePath = includeInternalFilePath && request.basePath && request.basePath !== options.entryPath
      ? request.basePath
      : undefined
    const cacheKey = `${documentKey(request.basePath)}${pointer}`
    const baseDetails = {
      cacheKey,
      pointer,
      ...(sourceFilePath ? { sourceFilePath } : {}),
      ...(filePath ? { filePath, documentCacheKey: filePath } : {}),
    }

    if (stackHas(stack, cacheKey)) {
      return unresolved(request, 'internal', {
        code: 'ref-cycle',
        ref: request.ref,
        message: `순환 $ref 감지: ${request.ref}`,
        pointer,
        ...(filePath ? { filePath } : {}),
      }, baseDetails)
    }

    const target = resolvePointer(pointer, request.root)
    if (target === undefined) {
      return unresolved(request, 'internal', {
        code: 'ref-not-found',
        ref: request.ref,
        message: `참조 대상을 찾을 수 없습니다: ${request.ref}`,
        pointer,
        ...(filePath ? { filePath } : {}),
      }, baseDetails)
    }

    return {
      ref: request.ref,
      kind: 'internal',
      sourcePointer: request.sourcePointer,
      resolved: true,
      ...baseDetails,
      target,
      documentRoot: request.root,
      ...(request.basePath ? { basePath: request.basePath } : {}),
    }
  }

  function resolveExternalRef(request: ResolveRefRequest, stack: RefStack): RefResolution {
    const hashIndex = request.ref.indexOf('#')
    const filePart = hashIndex === -1 ? request.ref : request.ref.slice(0, hashIndex)
    if (!filePart) {
      return unresolved(request, 'external', {
        code: 'unsupported-ref',
        ref: request.ref,
        message: `지원하지 않는 외부 $ref 형식: ${request.ref}`,
      })
    }

    const basePath = request.basePath
    if (!basePath) {
      return unresolved(request, 'unsupported', {
        code: 'unsupported-ref',
        ref: request.ref,
        message: `지원하지 않는 $ref 형식: ${request.ref}`,
      })
    }

    const filePath = resolve(dirname(basePath), filePart)
    // A relative JSON Reference may target the external resource itself. Both
    // `./path-item.yaml` and `./path-item.yaml#` therefore resolve to `#`.
    const fragment = hashIndex === -1 ? '' : request.ref.slice(hashIndex + 1)
    const rawPointer = fragment === '' ? '#' : `#${fragment}`
    const pointer = canonicalJsonPointerFragment(rawPointer) ?? rawPointer
    const cacheKey = `${documentKey(filePath)}${pointer}`
    const baseDetails = {
      cacheKey,
      documentCacheKey: filePath,
      basePath: filePath,
      sourceFilePath: basePath,
      filePath,
      pointer,
    }

    if (stackHas(stack, cacheKey)) {
      return unresolved(request, 'external', {
        code: 'ref-cycle',
        ref: request.ref,
        filePath,
        pointer,
        message: `순환 외부 $ref 감지: ${request.ref}`,
      }, baseDetails)
    }

    let document: unknown
    try {
      document = loadExternalDocument(filePath)
    } catch (err) {
      return unresolved(request, 'external', {
        code: 'external-ref-read-failed',
        ref: request.ref,
        filePath,
        pointer,
        message: err instanceof Error ? err.message : String(err),
      }, baseDetails)
    }

    const target = resolvePointer(pointer, document)
    if (target === undefined) {
      return unresolved(request, 'external', {
        code: 'external-ref-pointer-not-found',
        ref: request.ref,
        filePath,
        pointer,
        message: `외부 파일에서 참조 대상을 찾을 수 없습니다: ${request.ref}`,
      }, baseDetails)
    }

    return {
      ref: request.ref,
      kind: 'external',
      sourcePointer: request.sourcePointer,
      resolved: true,
      target,
      documentRoot: document,
      ...baseDetails,
    }
  }

  return {
    resolve: resolveRef,
    loadExternalDocument,
    entryRelativeRef,
  }
}

/** `$ref` file part naming `filePath` from `fromDirectory`, relative as `resolveExternalRef` reads it. */
function fileReference(fromDirectory: string, filePath: string): string {
  const path = relative(fromDirectory, filePath)
  // No relative path exists between filesystem roots (e.g. another Windows drive).
  if (isAbsolute(path)) return pathToFileURL(filePath).href
  const reference = path.split(sep).join('/')
  return reference.startsWith('../') ? reference : `./${reference}`
}

type RefStack = NonNullable<ResolveRefRequest['stack']>

function stackHas(stack: RefStack, key: string): boolean {
  return Array.isArray(stack) ? stack.includes(key) : (stack as RefStackView).has(key)
}

function unresolved(
  request: ResolveRefRequest,
  kind: RefResolverKind,
  diagnostic: RefResolverDiagnostic,
  details: Partial<Omit<RefResolution, 'ref' | 'kind' | 'sourcePointer' | 'resolved' | 'diagnostic'>> = {},
): RefResolution {
  const enrichedDiagnostic = {
    ...diagnostic,
    sourcePointer: diagnostic.sourcePointer ?? request.sourcePointer,
    ...(diagnostic.sourceFilePath !== undefined
      ? { sourceFilePath: diagnostic.sourceFilePath }
      : request.basePath ? { sourceFilePath: request.basePath } : {}),
  }
  return {
    ref: request.ref,
    kind,
    sourcePointer: request.sourcePointer,
    resolved: false,
    cacheKey: `unsupported:${request.ref}`,
    ...details,
    diagnostic: enrichedDiagnostic,
  }
}

function enrichResolutionDiagnosticLocation(
  resolution: RefResolution,
  lookupSourceLocation: RefResolverOptions['lookupSourceLocation'],
): RefResolution {
  if (!resolution.diagnostic || !lookupSourceLocation) return resolution
  const diagnostic = enrichDiagnosticLocation(resolution.diagnostic, lookupSourceLocation)
  if (diagnostic === resolution.diagnostic) return resolution
  return { ...resolution, diagnostic }
}

function enrichDiagnosticLocation(
  diagnostic: RefResolverDiagnostic,
  lookupSourceLocation: NonNullable<RefResolverOptions['lookupSourceLocation']>,
): RefResolverDiagnostic {
  const filePath = diagnostic.sourceFilePath ?? diagnostic.filePath
  const pointer = diagnostic.sourcePointer ?? diagnostic.pointer
  if (!filePath || !pointer || (diagnostic.line !== undefined && diagnostic.column !== undefined)) {
    return diagnostic
  }

  const location = lookupSourceLocation(filePath, pointer)
  if (!location) return diagnostic
  return {
    ...diagnostic,
    line: location.line,
    column: location.column,
  }
}

export function isRelativeRef(ref: string): boolean {
  const hashIndex = ref.indexOf('#')
  const filePart = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
  if (!filePart || filePart.startsWith('/') || filePart.startsWith('\\') || filePart.startsWith('//')) return false
  // Keep resolution local to the supplied base document: do not accept a URI
  // scheme (including Windows drive-letter paths) or query-bearing URI here.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(filePart) || filePart.includes('?')) return false
  return true
}

export function resolvePointer(ref: string, root: unknown): unknown | undefined {
  return resolveJsonPointer(root, ref)
}

function parseExternalRefFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
}
