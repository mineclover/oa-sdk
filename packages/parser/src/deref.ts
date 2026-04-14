import type { OasDocument } from './oas32-types.js'
import { SchemaFolder } from './folder.js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { resolvePointer as resolveJsonPointer } from './ref-graph.js'

export type DerefDiagnosticCode =
  | 'ref-cycle'
  | 'ref-not-found'
  | 'external-ref-read-failed'
  | 'external-ref-pointer-not-found'
  | 'unsupported-ref'

export type DerefDiagnostic = {
  code: DerefDiagnosticCode
  ref: string
  message: string
  filePath?: string
  pointer?: string
}

export type DerefOptions = {
  basePath?: string
  diagnostics?: DerefDiagnostic[]
  onDiagnostic?: (diagnostic: DerefDiagnostic) => void
}

/**
 * Internal $ref (#/...) 인라인 전개 Folder.
 *
 * - 외부 참조 (./file.yaml, ../file.json): basePath 옵션이 있으면 상대 경로 해결
 * - 순환 참조는 cycle stack으로 감지하여 빈 스키마({})로 대체
 * - $ref sibling 필드는 해소된 대상에 병합하여 구조 정보를 보존
 */
export class DerefFolder extends SchemaFolder {
  private readonly stack: string[] = []
  private readonly root: unknown
  private readonly currentBasePath: string | undefined

  constructor(
    root: unknown,
    private readonly options: DerefOptions = {},
    private readonly fileCache?: Map<string, unknown>,
    currentBasePath?: string,
  ) {
    super()
    this.root = root
    this.currentBasePath = currentBasePath ?? options.basePath
  }

  protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
    // Internal ref
    if (ref === '#' || ref.startsWith('#/')) {
      if (this.stack.includes(ref)) {
        this.emitDiagnostic({
          code: 'ref-cycle',
          ref,
          message: `순환 $ref 감지: ${ref}`,
          pointer: ref,
        })
        return mergeRefSiblings({}, this.foldSiblingFields(node))
      }

      const target = resolveJsonPointer(ref, this.root)
      if (target === undefined) {
        this.emitDiagnostic({
          code: 'ref-not-found',
          ref,
          message: `참조 대상을 찾을 수 없습니다: ${ref}`,
          pointer: ref,
        })
        return node
      }

      this.stack.push(ref)
      try {
        return mergeRefSiblings(this.fold(target), this.foldSiblingFields(node))
      } finally {
        this.stack.pop()
      }
    }

    // External file ref (상대 경로)
    if (this.currentBasePath && (ref.startsWith('./') || ref.startsWith('../'))) {
      const [filePart, pointer] = ref.split('#')
      if (!filePart || !pointer) {
        this.emitDiagnostic({
          code: 'unsupported-ref',
          ref,
          message: `지원하지 않는 외부 $ref 형식: ${ref}`,
        })
        return node
      }

      const fullPath = resolve(dirname(this.currentBasePath), filePart)

      // 순환 감지: 파일경로 + 포인터 조합
      const externalKey = `${fullPath}#${pointer}`
      if (this.stack.includes(externalKey)) {
        this.emitDiagnostic({
          code: 'ref-cycle',
          ref,
          filePath: fullPath,
          pointer: `#${pointer}`,
          message: `순환 외부 $ref 감지: ${ref}`,
        })
        return mergeRefSiblings({}, this.foldSiblingFields(node))
      }

      let fileContent = this.fileCache?.get(fullPath)
      if (!fileContent) {
        try {
          fileContent = parseExternalRefFile(fullPath)
          this.fileCache?.set(fullPath, fileContent)
        } catch (err) {
          this.emitDiagnostic({
            code: 'external-ref-read-failed',
            ref,
            filePath: fullPath,
            pointer: `#${pointer}`,
            message: err instanceof Error ? err.message : String(err),
          })
          return node // 파일 읽기 실패 — 원본 유지
        }
      }

      const target = resolveJsonPointer('#' + pointer, fileContent)
      if (target === undefined) {
        this.emitDiagnostic({
          code: 'external-ref-pointer-not-found',
          ref,
          filePath: fullPath,
          pointer: `#${pointer}`,
          message: `외부 파일에서 참조 대상을 찾을 수 없습니다: ${ref}`,
        })
        return node
      }

      this.stack.push(externalKey)
      try {
        return mergeRefSiblings(this.foldExternalTarget(target, fullPath), this.foldSiblingFields(node))
      } finally {
        this.stack.pop()
      }
    }

    if (!ref.startsWith('#/')) {
      this.emitDiagnostic({
        code: 'unsupported-ref',
        ref,
        message: `지원하지 않는 $ref 형식: ${ref}`,
      })
    }

    return node // 지원하지 않는 ref 타입 — 원본 유지
  }

  private foldSiblingFields(node: Record<string, unknown>): Record<string, unknown> {
    const siblings: Record<string, unknown> = {}
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

  private foldExternalTarget(target: unknown, basePath: string): unknown {
    const folder = new DerefFolder(this.root, this.options, this.fileCache, basePath)
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

function parseExternalRefFile(path: string): unknown {
  const raw = readFileSync(path, 'utf-8')
  if (path.endsWith('.json')) return JSON.parse(raw)
  return parseYaml(raw)
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
