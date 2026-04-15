import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

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
  filePath?: string
  pointer?: string
}

export type RefDocumentCache = Map<string, unknown>

export type RefResolverOptions = {
  entryPath?: string
  documentCache?: RefDocumentCache
  includeInternalFilePath?: boolean
}

export type ResolveRefRequest = {
  ref: string
  sourcePointer: string
  root: unknown
  basePath?: string
  stack?: readonly string[]
}

export type RefResolution = {
  ref: string
  kind: RefResolverKind
  sourcePointer: string
  resolved: boolean
  cacheKey: string
  documentCacheKey?: string
  basePath?: string
  filePath?: string
  pointer?: string
  target?: unknown
  documentRoot?: unknown
  diagnostic?: RefResolverDiagnostic
}

export interface RefResolver {
  resolve(request: ResolveRefRequest): RefResolution
  loadExternalDocument(filePath: string): unknown
}

export function createRefResolver(options: RefResolverOptions = {}): RefResolver {
  const documentCache = options.documentCache ?? new Map<string, unknown>()
  const includeInternalFilePath = options.includeInternalFilePath ?? true

  function loadExternalDocument(filePath: string): unknown {
    if (documentCache.has(filePath)) return documentCache.get(filePath)

    const document = parseExternalRefFile(filePath)
    documentCache.set(filePath, document)
    return document
  }

  function resolveRef(request: ResolveRefRequest): RefResolution {
    const stack = request.stack ?? []
    if (request.ref === '#' || request.ref.startsWith('#/')) {
      return resolveInternalRef(request, stack)
    }

    if (isRelativeRef(request.ref) && request.basePath) {
      return resolveExternalRef(request, stack)
    }

    return unresolved(request, 'unsupported', {
      code: 'unsupported-ref',
      ref: request.ref,
      message: `지원하지 않는 $ref 형식: ${request.ref}`,
    })
  }

  function resolveInternalRef(request: ResolveRefRequest, stack: readonly string[]): RefResolution {
    const pointer = request.ref
    const cacheKey = `<root>${pointer}`
    const filePath = includeInternalFilePath && request.basePath && request.basePath !== options.entryPath
      ? request.basePath
      : undefined

    if (stack.includes(cacheKey)) {
      return unresolved(request, 'internal', {
        code: 'ref-cycle',
        ref: request.ref,
        message: `순환 $ref 감지: ${request.ref}`,
        ...(filePath ? { filePath } : {}),
        pointer,
      }, { cacheKey, pointer, ...(filePath ? { filePath } : {}) })
    }

    const target = resolvePointer(pointer, request.root)
    if (target === undefined) {
      return unresolved(request, 'internal', {
        code: 'ref-not-found',
        ref: request.ref,
        message: `참조 대상을 찾을 수 없습니다: ${request.ref}`,
        ...(filePath ? { filePath } : {}),
        pointer,
      }, { cacheKey, pointer, ...(filePath ? { filePath } : {}) })
    }

    return {
      ref: request.ref,
      kind: 'internal',
      sourcePointer: request.sourcePointer,
      resolved: true,
      cacheKey,
      pointer,
      target,
      documentRoot: request.root,
      ...(request.basePath ? { basePath: request.basePath } : {}),
      ...(filePath ? { filePath } : {}),
    }
  }

  function resolveExternalRef(request: ResolveRefRequest, stack: readonly string[]): RefResolution {
    const [filePart, rawPointer] = request.ref.split('#')
    if (!filePart || !rawPointer) {
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
    const pointer = `#${rawPointer}`
    const cacheKey = `${filePath}${pointer}`
    const baseDetails = { cacheKey, documentCacheKey: filePath, basePath: filePath, filePath, pointer }

    if (stack.includes(cacheKey)) {
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
  }
}

function unresolved(
  request: ResolveRefRequest,
  kind: RefResolverKind,
  diagnostic: RefResolverDiagnostic,
  details: Partial<Omit<RefResolution, 'ref' | 'kind' | 'sourcePointer' | 'resolved' | 'diagnostic'>> = {},
): RefResolution {
  return {
    ref: request.ref,
    kind,
    sourcePointer: request.sourcePointer,
    resolved: false,
    cacheKey: `unsupported:${request.ref}`,
    ...details,
    diagnostic,
  }
}

export function isRelativeRef(ref: string): boolean {
  return ref.startsWith('./') || ref.startsWith('../')
}

export function resolvePointer(ref: string, root: unknown): unknown | undefined {
  if (ref === '#') return root
  const parts = ref
    .slice(2)
    .split('/')
    .map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))

  let current: unknown = root
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined
    const obj = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(obj, part)) return undefined
    current = obj[part]
  }
  return current
}

function parseExternalRefFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
}
