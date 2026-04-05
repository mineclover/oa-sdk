import type { OasDocument } from './oas32-types.js'
import { SchemaFolder } from './folder.js'

/**
 * Internal $ref (#/...) 인라인 전개 Folder.
 *
 * - 외부 참조 (./foo.yaml, https://...) 는 지원 안 함 — 원본 유지
 * - 순환 참조는 cycle stack으로 감지하여 빈 스키마({})로 대체
 * - $ref 와 함께 있는 다른 필드는 OAS 3.2 스펙에 따라 무시됨
 */
export class DerefFolder extends SchemaFolder {
  private readonly stack: string[] = []

  constructor(private readonly root: unknown) {
    super()
  }

  protected override foldRef(ref: string, node: Record<string, unknown>): unknown {
    // 외부 참조 — 지원 불가, 원본 유지
    if (!ref.startsWith('#/')) return node

    // 순환 참조 감지
    if (this.stack.includes(ref)) return {}

    const target = resolvePointer(ref, this.root)
    if (target === undefined) return node // 존재하지 않는 ref — 원본 유지

    this.stack.push(ref)
    try {
      return this.fold(target)
    } finally {
      this.stack.pop()
    }
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
 * OpenAPI 스펙 내 internal $ref 를 재귀적으로 인라인 전개.
 */
export function derefSpec<T = OasDocument>(spec: T): T {
  return new DerefFolder(spec).fold(spec) as T
}
