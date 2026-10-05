import { derefSpec, type DerefOptions } from './deref.js'

/**
 * OpenAPI 스펙에 적용되는 단일 변환 단계.
 *
 * SWC의 Pass trait 에서 영감 받음:
 *   - 단일 책임 원칙: 각 Pass는 한 가지 변환만 수행
 *   - 조합 가능: runPipeline 으로 여러 Pass를 체인
 *   - name 필드로 디버깅/로깅 지원
 */
export interface SpecPass {
  readonly name: string
  /**
   * The pass resolves `$ref`s, as the deref pass does.
   *
   * A `$ref` such a pass leaves in its output is one it could not resolve. It
   * keeps the spelling of the document it was written in, which can be another
   * file the pass inlined, so it cannot be resolved against the output.
   * `parseDocument()` and `loadSchema()` therefore omit those references from
   * route entries when any pass of the pipeline sets this flag, and resolve
   * local references themselves otherwise. Set it on a custom pass that
   * resolves references, for example one that wraps `derefSpec()`.
   */
  readonly resolvesRefs?: boolean
  run<T>(spec: T): T
}

/**
 * 여러 Pass를 순서대로 실행.
 * 앞 Pass의 출력이 다음 Pass의 입력으로 전달됨.
 */
export function runPipeline<T>(spec: T, passes: SpecPass[]): T {
  return passes.reduce<T>((s, pass) => pass.run(s), spec)
}

/**
 * internal $ref 인라인 전개 Pass.
 */
export function createDerefPass(options: DerefOptions = {}): SpecPass {
  return {
    name: 'deref',
    resolvesRefs: true,
    run<T>(spec: T): T {
      return derefSpec(spec, options)
    },
  }
}

export const derefPass: SpecPass = createDerefPass()

export const DEFAULT_PASSES: SpecPass[] = [derefPass]
