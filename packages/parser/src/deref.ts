import type { OasDocument } from './oas32-types.js'
import { SchemaFolder } from './folder.js'
import { createSafeRecord } from './safe-record.js'
import { RefExpansionMemo } from './ref-expansion-memo.js'
import { stepSchemaPath, type SchemaPathContext } from './recursion-guard.js'
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
  /**
   * 유효한 재귀 스키마의 순환 지점 ref. 진단 없이 cycleStrategy로 끊긴다.
   * 진입 문서(basePath) 기준 표기이며 preserve-ref 결과에 남는 `$ref`와 같다.
   * 같은 ref가 여러 번 보고될 수 있으며, 서로 다른 ref는 최소 한 번 보고된다.
   */
  onRecursiveRef?: (ref: string) => void
}

/**
 * Internal $ref (#/...) 인라인 전개 Folder.
 *
 * - 외부 참조 (./file.yaml, ../file.json): basePath 옵션이 있으면 상대 경로 해결
 * - 순환 참조는 cycle stack으로 감지하며 기본적으로 빈 스키마({})로 대체.
 *   stack 키는 (문서, pointer)다. 외부 문서 안의 `#/...`는 그 문서의 대상이고,
 *   외부 ref로 다시 들어온 진입 파일은 진입 문서와 같은 문서다 (RefResolution.cacheKey)
 * - 순환 경로가 instance 하위로 내려가면 유효한 재귀 스키마로 보고 진단하지 않는다.
 *   preserve-ref가 남기는 재귀 지점 `$ref`는 결과 문서의 ref이므로 진입 문서 기준으로
 *   다시 표기한다 (외부 파일 안의 표기는 그 파일 위치 기준이다). 진단된 순환은
 *   다른 진단 ref처럼 작성된 표기를 유지하고 진단의 sourceFilePath가 위치를 가리킨다
 * - $ref sibling 필드는 해소된 대상에 병합하여 구조 정보를 보존
 * - 같은 대상의 전개 결과는 RefExpansionMemo로 사용처 간에 공유한다.
 *   결과 트리는 동일한 하위 객체를 공유할 수 있다 (비순환 DAG).
 * - 해소하지 못한 `$ref`는 작성된 그대로 남기되 sibling 필드는 그 문서 기준으로
 *   전개한다 (deref-internal과 동일)
 */
export class DerefFolder extends SchemaFolder {
  private readonly memo = new RefExpansionMemo<DerefDiagnostic>()
  /** 현재 노드의 키를 해석할 문맥 (키워드 / 속성 이름 / 데이터) */
  private pathContext: SchemaPathContext = 'keyword'
  /** 현재 경로가 지난 instance 하위 키워드 수 */
  private descents = 0
  /** 전개 중인 대상별 진입 시점의 descents */
  private readonly descentsAtEntry = new Map<string, number>()
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
      // Diagnostic format only: internal-ref diagnostics carry `sourceFilePath`, not
      // `filePath`. Cycle keys still name the document the ref is in.
      includeInternalFilePath: false,
    })
  }

  protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
    const resolution = this.resolver.resolve({
      ref,
      sourcePointer: '#/$ref',
      root: this.root,
      ...(this.currentBasePath ? { basePath: this.currentBasePath } : {}),
      stack: this.memo.stackView,
    })

    if (resolution.diagnostic?.code === 'ref-cycle') {
      this.memo.noteCycle(resolution.cacheKey)
      if (this.isGuardedRecursion(resolution.cacheKey)) {
        // A recursion edge stays in the output document: name its target from there.
        const edge = this.resolver.entryRelativeRef(ref, this.currentBasePath)
        this.options.onRecursiveRef?.(edge)
        return this.resolveCycle(edge, node)
      }
      this.emitDiagnostic(resolution.diagnostic)
      return this.resolveCycle(ref, node)
    }
    if (resolution.diagnostic) this.emitDiagnostic(resolution.diagnostic)
    // The `$ref` stays as written, but the fields beside it belong to this
    // document and are dereferenced like any other node (as in deref-internal).
    if (!resolution.resolved) return this.foldChildren(node)

    const key = resolution.cacheKey
    const external = resolution.kind === 'external' && resolution.basePath
    const resolved = this.memo.expand(
      key,
      () => this.foldRefTarget(key, () => external
        ? this.foldExternalTarget(
            resolution.target,
            resolution.basePath!,
            resolution.documentRoot ?? resolution.target,
          )
        : this.fold(resolution.target)),
      diagnostic => this.emitDiagnostic(diagnostic),
      { cacheable: !external },
    )
    return mergeRefSiblings(resolved, this.foldSiblingFields(node))
  }

  protected override foldChildren(obj: Record<string, unknown>): Record<string, unknown> {
    const result = createSafeRecord<unknown>()
    for (const [key, value] of Object.entries(obj)) {
      result[key] = this.foldUnderKey(key, value)
    }
    return result
  }

  /** `key`의 값을 접는다. 키 문맥과 instance 하위 이동 수를 경로에 맞춰 유지한다. */
  private foldUnderKey(key: string, value: unknown): unknown {
    const parentContext = this.pathContext
    const step = stepSchemaPath(parentContext, key)
    this.pathContext = step.context
    if (step.descends) this.descents += 1
    try {
      return this.fold(value)
    } finally {
      this.pathContext = parentContext
      if (step.descends) this.descents -= 1
    }
  }

  /** ref 대상은 독립된 스키마 루트이므로 키워드 문맥에서 접고 진입 깊이를 기록한다. */
  private foldRefTarget(key: string, fold: () => unknown): unknown {
    const parentContext = this.pathContext
    this.pathContext = 'keyword'
    this.descentsAtEntry.set(key, this.descents)
    try {
      return fold()
    } finally {
      this.pathContext = parentContext
      this.descentsAtEntry.delete(key)
    }
  }

  /** 순환 대상에 진입한 뒤 instance 하위로 한 번 이상 내려왔으면 유효한 재귀다. */
  private isGuardedRecursion(key: string): boolean {
    const entry = this.descentsAtEntry.get(key)
    return entry !== undefined && this.descents > entry
  }

  private foldSiblingFields(node: Record<string, unknown>): Record<string, unknown> {
    const siblings = createSafeRecord<unknown>()
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') continue
      siblings[key] = this.foldUnderKey(key, value)
    }
    return siblings
  }

  private emitDiagnostic(diagnostic: DerefDiagnostic): void {
    this.memo.recordDiagnostic(diagnostic)
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
    folder.memo.seed(this.memo.stackKeys())
    for (const [key, descents] of this.descentsAtEntry) folder.descentsAtEntry.set(key, descents)
    folder.descents = this.descents
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
): { document: T; diagnostics: DerefDiagnostic[]; recursiveRefs: string[] } {
  const diagnostics: DerefDiagnostic[] = []
  const recursiveRefs = new Set<string>()
  const document = derefSpec(spec, {
    ...options,
    diagnostics,
    onRecursiveRef(ref) {
      recursiveRefs.add(ref)
      options.onRecursiveRef?.(ref)
    },
  })
  return { document, diagnostics, recursiveRefs: [...recursiveRefs] }
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
