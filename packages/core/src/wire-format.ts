/**
 * @oa-sdk/core/wire-format — Canonical JSON wire-format utility types.
 *
 * Inspired by Samchon (@samchon/typia) contract provenance & serialization primitives.
 * Provides compile-time recursive type transformations ensuring that:
 * - Network response payloads match pure JSON serialization (JsonPrimitive<T>)
 * - Client request parameter types accept plain data structures without methods (Resolved<T>)
 */

/**
 * Checks if two types are exactly equal.
 */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
    ? true
    : false

/**
 * Union of JavaScript built-in class types.
 */
export type NativeClass =
  | Date
  | Set<any>
  | Map<any, any>
  | WeakSet<any>
  | WeakMap<any, any>
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Blob
  | File
  | RegExp

interface IValueOf<T> {
  valueOf(): T
}

type IsValueOf<Instance, Object extends IValueOf<any>> = Instance extends Object
  ? Object extends IValueOf<infer Primitive>
    ? Instance extends Primitive
      ? false
      : true
    : false
  : false

/**
 * Extracts the primitive value type from boxed primitives (Boolean, Number, String).
 * Non-boxed types and literals are returned unchanged.
 */
export type ValueOf<Instance> =
  IsValueOf<Instance, Boolean> extends true
    ? boolean
    : IsValueOf<Instance, Number> extends true
      ? number
      : IsValueOf<Instance, String> extends true
        ? string
        : Instance

/**
 * Extracts non-function properties from a class or object type, filtering out methods.
 */
export type ClassProperties<T extends object> = {
  [K in keyof T as K extends symbol
    ? never
    : [T[K]] extends [never]
      ? never
      : [Exclude<T[K], undefined>] extends [never]
        ? K
        : Exclude<T[K], undefined> extends Function
          ? never
          : K]: T[K]
}

/**
 * Tests whether an array type is a tuple.
 */
export type IsTuple<T extends readonly any[]> = [T] extends [never]
  ? false
  : number extends T['length']
    ? T extends readonly [any, ...any[]]
      ? true
      : false
    : true

/**
 * Converts a type to its JSON-serializable primitive wire format:
 * - Strips functions, methods, symbols, and class prototypes
 * - Maps Date -> string
 * - Resolves toJSON() method return types recursively
 * - Unboxes boxed primitives (Boolean -> boolean, Number -> number, String -> string)
 * - Maps bigint -> never (bigint cannot be represented in standard JSON)
 * - Maps non-Date NativeClass (Map, Set, etc.) -> never
 * - Handles arrays, tuples, and plain objects recursively
 */
export type JsonPrimitive<T> =
  0 extends 1 & T
    ? any
    : [T] extends [never]
      ? never
      : unknown extends T
        ? unknown
        : JsonPrimitiveMain<T>

type JsonPrimitiveMain<T> =
  T extends [never]
    ? never
    : ValueOf<T> extends bigint
      ? never
      : ValueOf<T> extends boolean | number | string
        ? ValueOf<T>
        : T extends null | undefined | void
          ? T
          : T extends Function
            ? never
            : T extends symbol
              ? never
              : ValueOf<T> extends object
                ? T extends object
                  ? T extends Date
                    ? string
                    : T extends { toJSON(...args: any[]): infer R }
                      ? JsonPrimitive<R>
                      : T extends Exclude<NativeClass, Date>
                        ? never
                        : JsonPrimitiveObject<T>
                  : never
                : ValueOf<T>

type JsonPrimitiveObject<T extends object> =
  T extends readonly any[]
    ? IsTuple<T> extends true
      ? JsonPrimitiveTuple<T>
      : JsonPrimitive<T[number]>[]
    : {
        [K in keyof T as K extends symbol
          ? never
          : [T[K]] extends [never]
            ? never
            : [Exclude<T[K], undefined>] extends [never]
              ? K
              : Exclude<T[K], undefined> extends Function | symbol
                ? never
                : K]: JsonPrimitive<T[K]>
      }

type JsonPrimitiveTuple<T extends readonly any[]> =
  number extends T['length']
    ? JsonPrimitiveVariadicTuple<T>
    : T extends []
      ? []
      : T extends readonly []
        ? readonly []
        : T extends [infer F]
          ? [JsonPrimitive<F>]
          : T extends readonly [infer F]
            ? readonly [JsonPrimitive<F>]
            : T extends [infer F, ...infer Rest]
              ? [JsonPrimitive<F>, ...JsonPrimitiveTuple<Rest>]
              : T extends readonly [infer F, ...infer Rest]
                ? readonly [JsonPrimitive<F>, ...JsonPrimitiveTuple<Rest>]
                : T extends [(infer F)?]
                  ? [JsonPrimitive<F>?]
                  : T extends readonly [(infer F)?]
                    ? readonly [JsonPrimitive<F>?]
                    : T extends [(infer F)?, ...infer Rest]
                      ? [JsonPrimitive<F>?, ...JsonPrimitiveTuple<Rest>]
                      : T extends readonly [(infer F)?, ...infer Rest]
                        ? readonly [JsonPrimitive<F>?, ...JsonPrimitiveTuple<Rest>]
                        : []

type JsonPrimitiveVariadicTuple<T extends readonly any[]> = {
  [P in keyof T]: JsonPrimitive<T[P]>
}

/**
 * Converts a type to its resolved plain object form by stripping methods from class types,
 * while preserving Date, Set, Map, and primitive types. Useful for API client request parameters.
 */
export type Resolved<T> =
  0 extends 1 & T
    ? any
    : [T] extends [never]
      ? never
      : unknown extends T
        ? unknown
        : object extends T
          ? T
          : T extends readonly unknown[]
            ? ResolvedMain<T>
            : Equal<T, ResolvedMain<T>> extends true
              ? T
              : ResolvedMain<T>

type ResolvedMain<T, TupleStack = never> =
  T extends [never]
    ? never
    : ValueOf<T> extends boolean | number | bigint | string
      ? ValueOf<T>
      : T extends null | undefined | void
        ? T
        : T extends Function
          ? never
          : T extends object
            ? ResolvedObject<T, TupleStack>
            : ValueOf<T>

type ResolvedObject<T extends object, TupleStack> =
  T extends Array<infer U>
    ? IsTuple<T> extends true
      ? T extends TupleStack
        ? T
        : ResolvedArray<T, TupleStack | T>
      : Array<ResolvedMain<U, TupleStack>>
    : T extends ReadonlyArray<infer U>
      ? IsTuple<T> extends true
        ? T extends TupleStack
          ? T
          : ResolvedArray<T, TupleStack | T>
        : ReadonlyArray<ResolvedMain<U, TupleStack>>
      : T extends Set<infer U>
        ? Set<ResolvedMain<U, TupleStack>>
        : T extends Map<infer K, infer V>
          ? Map<ResolvedMain<K, TupleStack>, ResolvedMain<V, TupleStack>>
          : T extends ReadonlyMap<infer K, infer V>
            ? ReadonlyMap<ResolvedMain<K, TupleStack>, ResolvedMain<V, TupleStack>>
            : T extends ReadonlySet<infer U>
              ? ReadonlySet<ResolvedMain<U, TupleStack>>
              : T extends WeakSet<any> | WeakMap<any, any>
                ? never
                : T extends NativeClass
                  ? T
                  : {
                      [P in keyof T as P extends symbol
                        ? never
                        : [T[P]] extends [never]
                          ? never
                          : [Exclude<T[P], undefined>] extends [never]
                            ? P
                            : Exclude<T[P], undefined> extends Function
                              ? never
                              : P]: ResolvedMain<T[P], TupleStack>
                    }

type ResolvedArray<T extends readonly unknown[], TupleStack> = {
  [P in keyof T]: ResolvedMain<T[P], TupleStack>
}
