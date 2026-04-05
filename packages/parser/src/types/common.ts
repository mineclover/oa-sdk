/**
 * OAS 3.2 공통 타입
 *
 * 참조: docs/references/oas32/11-headers-tags-refs.md (§4.8.23 Reference Object)
 *       docs/references/oas32/02-extensions.md (x-* 확장)
 *
 * - Referenceable<T>: $ref 가능 위치
 * - OasReference: Reference Object (§4.8.23)
 * - Extensions: x-* 패턴
 */

export type OasReference = {
  $ref: string
  /** @since 3.2 */
  summary?: string
  /** @since 3.2 */
  description?: string
}

/** T | OasReference 유니온 — $ref 가능한 위치에 사용 */
export type Referenceable<T> = T | OasReference

/** x-* 확장 필드 시그니처 */
export type OasExtensions = { [key: `x-${string}`]: unknown }
