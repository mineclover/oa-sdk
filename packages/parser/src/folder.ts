/**
 * SchemaFolder — OpenAPI 스펙 트리를 재귀 순회하며 새 노드를 반환하는 Fold 패턴 기반 클래스.
 *
 * SWC의 Fold trait 에서 영감 받음:
 *   - 소유권 기반: 원본 노드를 변경하지 않고 새 노드를 반환
 *   - 서브클래스에서 foldRef / foldObject 를 오버라이드해 동작 커스터마이징
 *   - foldChildren 은 기본 재귀 구현을 제공 (noop_visit 대응)
 *
 * 노드 분류:
 *   - primitive (string, number, boolean, null): 리프 노드, 그대로 반환
 *   - array: 각 항목을 fold 재귀 처리
 *   - { $ref: "..." }: foldRef 호출
 *   - 일반 object: foldObject 호출 (기본: 모든 값을 fold 재귀 처리)
 */
export abstract class SchemaFolder {
  /**
   * 노드 진입점. 타입 분류 후 적절한 fold 메서드로 위임.
   */
  fold(node: unknown): unknown {
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(item => this.fold(item))

    const obj = node as Record<string, unknown>

    if (typeof obj['$ref'] === 'string') {
      return this.foldRef(obj['$ref'], obj)
    }

    return this.foldObject(obj)
  }

  /**
   * $ref 노드 처리.
   * 기본 구현: 원본 유지 (no-op).
   * 오버라이드하여 ref 해석, 인라인 전개 등 구현.
   */
  protected foldRef(ref: string, node: Record<string, unknown>): unknown {
    return node
  }

  /**
   * 일반 객체 처리.
   * 기본 구현: 모든 값을 재귀적으로 fold (foldChildren).
   * 오버라이드하여 특정 키만 처리하거나 추가 변환 삽입.
   */
  protected foldObject(obj: Record<string, unknown>): Record<string, unknown> {
    return this.foldChildren(obj)
  }

  /**
   * 객체의 모든 값을 재귀 처리하여 새 객체 반환.
   * SWC의 fold_children_with 대응.
   */
  protected foldChildren(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = this.fold(v)
    }
    return result
  }
}
