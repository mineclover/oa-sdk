import type { OasDocument } from './oas32-types.js'
import { SchemaFolder } from './folder.js'
import { createSafeRecord } from './safe-record.js'
import {
  createRefResolver,
  type RefDocumentCache,
  type RefResolver,
  type RefResolverDiagnostic,
  type RefResolverDiagnosticCode,
} from './ref-resolver.js'

export type DerefDiagnosticCode = RefResolverDiagnosticCode

export type DerefDiagnostic = RefResolverDiagnostic

export type DerefCycleStrategy = 'empty-schema' | 'preserve-ref'

export type DerefOptions = {
  basePath?: string
  cycleStrategy?: DerefCycleStrategy
  diagnostics?: DerefDiagnostic[]
  onDiagnostic?: (diagnostic: DerefDiagnostic) => void
}

/**
 * Internal $ref (#/...) 인라인 전개 Folder.
 *
 * - 외부 참조 (./file.yaml, ../file.json): basePath 옵션이 있으면 상대 경로 해결
 * - 순환 참조는 cycle stack으로 감지하며 기본적으로 빈 스키마({})로 대체
 * - $ref sibling 필드는 해소된 대상에 병합하여 구조 정보를 보존
 */
export class DerefFolder extends SchemaFolder {
  private readonly stack: string[] = []
  private readonly root: unknown
  private readonly currentBasePath: string | undefined
  private readonly fileCache: RefDocumentCache
  private readonly resolver: RefResolver

  constructor(
    root: unknown,
    private readonly options: DerefOptions = {},
    fileCache?: RefDocumentCache,
    currentBasePath?: string,
  ) {
    super()
    this.root = root
    this.currentBasePath = currentBasePath ?? options.basePath
    this.fileCache = fileCache ?? new Map<string, unknown>()
    this.resolver = createRefResolver({
      ...(options.basePath ? { entryPath: options.basePath } : {}),
      documentCache: this.fileCache,
      includeInternalFilePath: false,
    })
  }

  protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
    const resolution = this.resolver.resolve({
      ref,
      sourcePointer: '#/$ref',
      root: this.root,
      ...(this.currentBasePath ? { basePath: this.currentBasePath } : {}),
      stack: this.stack,
    })

    if (resolution.diagnostic) this.emitDiagnostic(resolution.diagnostic)
    if (!resolution.resolved) {
      return resolution.diagnostic?.code === 'ref-cycle' ? this.resolveCycle(ref, node) : node
    }

    this.stack.push(resolution.cacheKey)
    try {
      const resolved = resolution.kind === 'external' && resolution.basePath
        ? this.foldExternalTarget(
            resolution.target,
            resolution.basePath,
            resolution.documentRoot ?? resolution.target,
          )
        : this.fold(resolution.target)
      return mergeRefSiblings(resolved, this.foldSiblingFields(node))
    } finally {
      this.stack.pop()
    }
  }

  private foldSiblingFields(node: Record<string, unknown>): Record<string, unknown> {
    const siblings = createSafeRecord<unknown>()
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') continue
      siblings[key] = this.fold(value)
    }
    return siblings
  }

  private emitDiagnostic(diagnostic: DerefDiagnostic): void {
    this.options.diagnostics?.push(diagnostic)
    this.options.onDiagnostic?.(diagnostic)
  }

  private resolveCycle(ref: string, node: Record<string, unknown>): unknown {
    const siblings = this.foldSiblingFields(node)
    if (this.options.cycleStrategy === 'preserve-ref') {
      return mergeRefSiblings({ $ref: ref }, siblings)
    }
    return mergeRefSiblings({}, siblings)
  }

  private foldExternalTarget(target: unknown, basePath: string, documentRoot: unknown): unknown {
    const folder = new DerefFolder(documentRoot, this.options, this.fileCache, basePath)
    folder.stack.push(...this.stack)
    return folder.fold(target)
  }
}

/**
 * OpenAPI 스펙 내 $ref 를 재귀적으로 인라인 전개.
 *
 * options.basePath 지정 시 상대 경로 외부 $ref도 해결.
 * basePath 미지정 시 외부 ref는 원본 유지 (기존 동작과 동일).
 */
export function derefSpec<T = OasDocument>(spec: T, options: DerefOptions = {}): T {
  const cache = new Map<string, unknown>()
  return new DerefFolder(spec, options, cache).fold(spec) as T
}

export function derefSpecWithDiagnostics<T = OasDocument>(
  spec: T,
  options: Omit<DerefOptions, 'diagnostics'> = {},
): { document: T; diagnostics: DerefDiagnostic[] } {
  const diagnostics: DerefDiagnostic[] = []
  const document = derefSpec(spec, { ...options, diagnostics })
  return { document, diagnostics }
}

function mergeRefSiblings(resolved: unknown, siblings: Record<string, unknown>): unknown {
  if (Object.keys(siblings).length === 0) return resolved
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return siblings

  const base = resolved as Record<string, unknown>
  return mergeSchemaLikeObjects(base, siblings)
}

function mergeSchemaLikeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base, ...overlay }

  for (const key of ['properties', 'patternProperties', 'dependentSchemas', 'dependentRequired', '$defs']) {
    const baseMap = asRecord(base[key])
    const overlayMap = asRecord(overlay[key])
    if (baseMap && overlayMap) result[key] = { ...baseMap, ...overlayMap }
  }

  if (Array.isArray(base['required']) && Array.isArray(overlay['required'])) {
    result['required'] = [...new Set([...base['required'], ...overlay['required']])]
  }

  return result
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
