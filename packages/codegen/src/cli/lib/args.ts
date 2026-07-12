/** CLI args에서 타입 안전하게 값을 추출하는 헬퍼 */

import type { CommandArgValue } from './types.js'

type Args = Record<string, CommandArgValue>

/** required string 옵션. undefined면 throw (runCommand에서 이미 검증하지만 타입 보장용) */
export function str(args: Args, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new Error(`missing required option: --${key}`)
  return v
}

/** optional string 옵션 */
export function optStr(args: Args, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

/** repeatable string 옵션 */
export function optStrArray(args: Args, key: string): string[] {
  const v = args[key]
  if (typeof v === 'string') return [v]
  if (Array.isArray(v) && v.every(item => typeof item === 'string')) return [...v]
  return []
}

/** boolean 플래그 */
export function bool(args: Args, key: string): boolean {
  return args[key] === true
}

/** 문서화된 enum 옵션을 검증하고 기본값을 적용합니다. */
export function choice<T extends string>(
  args: Args,
  key: string,
  values: readonly T[],
  defaultValue: T,
): T {
  const value = optStr(args, key)
  if (value === undefined) return defaultValue
  if ((values as readonly string[]).includes(value)) return value as T
  throw new Error(`--${key} 값은 ${values.join(' | ')} 중 하나여야 합니다: ${value}`)
}
