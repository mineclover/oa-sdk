/**
 * Re-exports canonical wire-format safety utility types from @oa-sdk/core.
 */
import type { JsonPrimitive, Resolved } from '@oa-sdk/core'

export type {
  ValueOf,
  ClassProperties,
  JsonPrimitive,
  Resolved,
  Equal,
  NativeClass,
  IsTuple,
} from '@oa-sdk/core'

export interface ClientResponse<TBody = unknown, THeaders = Record<string, unknown>> {
  readonly status: number
  readonly ok: boolean
  readonly body: TBody
  readonly headers: THeaders
}

/**
 * Simulates runtime wire serialization according to JSON specifications.
 */
export function toWireJson<T>(input: T): JsonPrimitive<T> {
  if (input === null || input === undefined) {
    return input as any
  }
  if (typeof input === 'bigint') {
    throw new TypeError('Do not know how to serialize a BigInt')
  }
  if (typeof input === 'function' || typeof input === 'symbol') {
    return undefined as any
  }
  if (input instanceof Date) {
    return input.toISOString() as any
  }
  if (typeof (input as any).toJSON === 'function') {
    return toWireJson((input as any).toJSON())
  }
  if (Array.isArray(input)) {
    return input.map(item => toWireJson(item)) as any
  }
  if (typeof input === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'function' || typeof value === 'symbol') {
        continue
      }
      result[key] = toWireJson(value)
    }
    return result as any
  }
  return input as any
}

/**
 * Strips class methods and prototype chain to produce clean resolved parameter data.
 */
export function toResolved<T>(input: T): Resolved<T> {
  if (input === null || input === undefined) {
    return input as any
  }
  if (typeof input === 'function' || typeof input === 'symbol') {
    return undefined as any
  }
  if (input instanceof Date) {
    return input as any
  }
  if (Array.isArray(input)) {
    return input.map(item => toResolved(item)) as any
  }
  if (typeof input === 'object') {
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'function' || typeof value === 'symbol') {
        continue
      }
      result[key] = toResolved(value)
    }
    return result as any
  }
  return input as any
}
