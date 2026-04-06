import type { OasDocument } from './oas32-types.js'
import { SchemaFolder } from './folder.js'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

/**
 * Internal $ref (#/...) 인라인 전개 Folder.
 *
 * - 외부 참조 (./file.yaml, ../file.json): basePath 옵션이 있으면 상대 경로 해결
 * - 순환 참조는 cycle stack으로 감지하여 빈 스키마({})로 대체
 * - $ref 와 함께 있는 다른 필드는 OAS 3.2 스펙에 따라 무시됨
 */
export class DerefFolder extends SchemaFolder {
  private readonly stack: string[] = []

  constructor(
    private readonly root: unknown,
    private readonly basePath?: string,
    private readonly fileCache?: Map<string, unknown>,
  ) {
    super()
  }

  protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
    // Internal ref
    if (ref.startsWith('#/')) {
      if (this.stack.includes(ref)) return {}

      const target = resolvePointer(ref, this.root)
      if (target === undefined) return node

      this.stack.push(ref)
      try {
        return this.fold(target)
      } finally {
        this.stack.pop()
      }
    }

    // External file ref (상대 경로)
    if (this.basePath && (ref.startsWith('./') || ref.startsWith('../'))) {
      const [filePart, pointer] = ref.split('#')
      if (!filePart || !pointer) return node

      const fullPath = resolve(dirname(this.basePath), filePart)

      // 순환 감지: 파일경로 + 포인터 조합
      const externalKey = `${fullPath}#${pointer}`
      if (this.stack.includes(externalKey)) return {}

      let fileContent = this.fileCache?.get(fullPath)
      if (!fileContent) {
        try {
          const raw = readFileSync(fullPath, 'utf-8')
          fileContent = JSON.parse(raw)
          this.fileCache?.set(fullPath, fileContent)
        } catch {
          return node // 파일 읽기 실패 — 원본 유지
        }
      }

      const target = resolvePointer('#' + pointer, fileContent)
      if (target === undefined) return node

      this.stack.push(externalKey)
      try {
        return this.fold(target)
      } finally {
        this.stack.pop()
      }
    }

    return node // 지원하지 않는 ref 타입 — 원본 유지
  }
}

/**
 * JSON Pointer (#/a/b/c) 로 root 내 값을 탐색.
 * RFC 6901: ~ → ~0, / → ~1 이스케이프 처리.
 */
function resolvePointer(ref: string, root: unknown): unknown | undefined {
  const parts = ref
    .slice(2) // '#/' 제거
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

/**
 * OpenAPI 스펙 내 $ref 를 재귀적으로 인라인 전개.
 *
 * options.basePath 지정 시 상대 경로 외부 $ref도 해결.
 * basePath 미지정 시 외부 ref는 원본 유지 (기존 동작과 동일).
 */
export function derefSpec<T = OasDocument>(spec: T, options?: { basePath?: string }): T {
  const cache = new Map<string, unknown>()
  return new DerefFolder(spec, options?.basePath, cache).fold(spec) as T
}
