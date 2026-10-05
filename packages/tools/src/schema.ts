/**
 * @oa-sdk/tools — Schema Normalization and Validation
 *
 * Grounded in JSON Schema Draft 2020-12 and OpenAPI 3.1.
 * Supports TypeSpec emitted JSON Schemas, standalone type guards, and Zod schemas.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { z } from 'zod'
import type { ToolSchema } from './types.js'

/**
 * Standard JSON Schema Draft 2020-12 / OpenAPI 3.1 Object structure.
 *
 * The index signature intentionally keeps vocabulary extensions (for example
 * `format`, `minLength`, `oneOf`, `allOf`, and vendor extensions) intact while
 * normalizing schemas. Validation is delegated to the same Draft 2020-12
 * implementation for every JSON Schema input.
 */
export interface JsonSchemaObject {
  $schema?: string | undefined
  $id?: string | undefined
  $ref?: string | undefined
  type?: string | string[] | undefined
  properties?: Record<string, JsonSchemaProperty> | undefined
  required?: string[] | undefined
  description?: string | undefined
  additionalProperties?: boolean | Record<string, unknown> | undefined
  $defs?: Record<string, JsonSchemaObject> | undefined
  [key: string]: unknown
}

export interface JsonSchemaProperty {
  $ref?: string | undefined
  type?: string | string[] | undefined
  description?: string | undefined
  default?: unknown
  enum?: unknown[] | undefined
  items?: Record<string, unknown> | undefined
  properties?: Record<string, JsonSchemaProperty> | undefined
  required?: string[] | undefined
  additionalProperties?: boolean | Record<string, unknown> | undefined
  [key: string]: unknown
}

/**
 * Check if a schema object is a Zod schema
 */
export function isZodSchema(schema: unknown): schema is z.ZodType<unknown> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    ('_def' in schema || '_zod' in schema) &&
    typeof (schema as Record<string, unknown>).safeParse === 'function'
  )
}

/**
 * Read a property of an arbitrary value without asserting its shape. Functions
 * carry properties too: a callable validator can expose safeParse/parse/validate.
 */
function readProperty(value: unknown, key: string): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? Reflect.get(value, key)
    : undefined
}

/** Return `key` as a callable bound to `target`, or undefined when it is not a function. */
function readMethod(target: unknown, key: string): ((input: unknown) => unknown) | undefined {
  const method = readProperty(target, key)
  if (typeof method !== 'function') return undefined
  return (input: unknown): unknown => Reflect.apply(method, target, [input])
}

/** Resolve the component name in a local JSON Schema/OpenAPI reference. */
function refName(ref: string): string | undefined {
  const match = ref.match(/^#\/(?:components\/schemas|\$defs)\/(.+)$/)
  return match?.[1]
}

/** Keep component definitions available for recursive references after expansion. */
function attachComponents(schema: JsonSchemaObject, components: Record<string, JsonSchemaObject>): JsonSchemaObject {
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite)
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string') return value.replace(/^#\/components\/schemas\//, '#/$defs/')
      return value
    }
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = rewrite(child)
    }
    return result
  }
  const expanded = rewrite(schema) as JsonSchemaObject
  expanded.$defs = { ...components, ...(expanded.$defs ?? {}) }
  return rewrite(expanded) as JsonSchemaObject
}

/**
 * Dereference a schema or embed components into $defs to ensure full client portability.
 *
 * References are resolved recursively across composition keywords (`oneOf`,
 * `allOf`, `items`, etc.), rather than only direct object properties. A reference
 * that points back to an active parent is retained so recursive schemas remain
 * finite and can still be compiled by the validator.
 */
export function dereferenceSchema(
  schema: JsonSchemaObject,
  components?: Record<string, JsonSchemaObject>,
  visited = new Set<string>(),
): JsonSchemaObject {
  if (!components || !schema || typeof schema !== 'object') return schema

  const visit = (value: unknown, active: Set<string>): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item, active))
    if (!value || typeof value !== 'object') return value

    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string') {
      const name = refName(record.$ref)
      const target = name === undefined ? undefined : components[name]
      if (name !== undefined && target && !active.has(name)) {
        const next = new Set(active)
        next.add(name)
        // Local metadata beside a $ref is legal in JSON Schema 2020-12. Keep it
        // when expanding the target (description is the common OpenAPI case).
        const merged = { ...target, ...record }
        delete merged.$ref
        return visit(merged, next)
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(record)) {
      result[key] = visit(child, active)
    }
    return result
  }

  return visit(schema, visited) as JsonSchemaObject
}

/**
 * Normalize any ToolSchema (TypeSpec JSON Schema, OpenAPI object, or Zod schema)
 * into a standard JSON Schema Draft 2020-12 / OpenAPI 3.1 object.
 *
 * Normalization is lossless for JSON Schema vocabularies: constraints such as
 * enum, format, min/max, patterns, and composition keywords are retained.
 */
export function normalizeJsonSchema(
  schema: ToolSchema,
  components?: Record<string, JsonSchemaObject>,
): JsonSchemaObject {
  if (!schema) {
    return {
      type: 'object',
      properties: {},
    }
  }

  // Case 1: Zod schema -> use the instance toJSONSchema conversion
  if (isZodSchema(schema)) {
    try {
      // Zod 4 exposes this conversion on every schema instance. Calling the
      // instance method avoids making the optional zod peer a runtime import.
      // Older Zod versions have no lossless conversion and fail explicitly.
      const toJSONSchema = readMethod(schema, 'toJSONSchema')
      const jsonSchema = toJSONSchema === undefined ? null : toJSONSchema(undefined)

      if (jsonSchema && typeof jsonSchema === 'object') {
        const normalized = { ...(jsonSchema as JsonSchemaObject) }
        return components ? attachComponents(dereferenceSchema(normalized, components), components) : normalized
      }
    } catch {
      // Conversion errors are surfaced below; never emit a lossy shape.
    }

    // Do not silently degrade a Zod schema into a lossy object shape. Zod 4
    // exposes a complete JSON Schema conversion above; older Zod versions can
    // still be validated directly through safeParse, but normalization must be
    // explicit so generated contracts never claim constraints they dropped.
    throw new Error(
      'Unable to convert Zod schema to JSON Schema without losing constraints; ' +
        'use Zod 4 or provide a JSON Schema object explicitly',
    )
  }

  // Case 2: Plain JSON Schema object (from TypeSpec / OpenAPI). Spread the
  // complete schema so no constraint is silently discarded.
  const obj = schema as Record<string, unknown>
  const normalized: JsonSchemaObject = { ...(obj as JsonSchemaObject) }

  // Tool inputs conventionally use an object when no keyword establishes a
  // root shape. Preserve explicit primitive/composition schemas unchanged.
  if (
    normalized.type === undefined &&
    normalized.$ref === undefined &&
    normalized.oneOf === undefined &&
    normalized.anyOf === undefined &&
    normalized.allOf === undefined &&
    normalized.not === undefined &&
    normalized.enum === undefined &&
    normalized.const === undefined
  ) {
    normalized.type = 'object'
  }
  if (obj.properties && typeof obj.properties === 'object') {
    normalized.properties = obj.properties as Record<string, JsonSchemaProperty>
  }
  if (obj.required !== undefined && Array.isArray(obj.required)) {
    normalized.required = obj.required as string[]
  }
  if (obj.$defs && typeof obj.$defs === 'object') {
    normalized.$defs = obj.$defs as Record<string, JsonSchemaObject>
  }

  return components ? attachComponents(dereferenceSchema(normalized, components), components) : normalized
}

/** Validation result contract */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/** A compiled validator shared by all plain JSON Schema validation paths. */
export interface JsonSchemaValidator<T = unknown> {
  validate(data: unknown): ValidationResult<T>
}

function formatAjvPath(instancePath: string): string {
  if (!instancePath) return 'input'
  return `input${instancePath.replace(/\/([^/]+)/g, '.$1').replace(/~1/g, '/').replace(/~0/g, '~')}`
}

function formatValidationError(error: ErrorObject): string {
  const path = formatAjvPath(error.instancePath)
  if (error.keyword === 'required') {
    return `Missing required field: "${path === 'input' ? error.params.missingProperty : `${path}.${error.params.missingProperty}`}"`
  }
  if (error.keyword === 'additionalProperties') {
    return `${path} contains unknown field "${error.params.additionalProperty}"`
  }
  if (error.keyword === 'enum') return `${path} must be one of the allowed enum values`
  if (error.keyword === 'const') return `${path} must equal the schema constant`
  if (error.keyword === 'type') return `${path} must be ${error.params.type}`
  if (error.keyword === 'format') return `${path} must match format ${error.params.format}`
  if (error.message) return `${path} ${error.message}`
  return `${path} failed ${error.keyword} validation`
}

/**
 * Compile a JSON Schema Draft 2020-12 validator. This is the one validator
 * abstraction used by `validateToolInput`; every standard constraint is checked
 * by Ajv, including refs, composition, formats, and length/range keywords.
 */
// Cached validators are keyed by schema identity; the caller's T names the
// shape that schema validates, so the cache stores them as JsonSchemaValidator<unknown>.
const validatorCache = new WeakMap<object, WeakMap<object, JsonSchemaValidator<unknown>>>()
const undefinedComponentsCache = new WeakMap<object, JsonSchemaValidator<unknown>>()

export function createJsonSchemaValidator<T = unknown>(
  schema: JsonSchemaObject,
  components?: Record<string, JsonSchemaObject>,
): JsonSchemaValidator<T> {
  const cached = components
    ? validatorCache.get(schema)?.get(components)
    : undefinedComponentsCache.get(schema)
  if (cached) return cached as JsonSchemaValidator<T>

  const normalized = normalizeJsonSchema(schema as ToolSchema, components)
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: true,
  })
  addFormats(ajv)

  let validate: ValidateFunction
  try {
    validate = ajv.compile(normalized as Record<string, unknown>)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON Schema'
    const invalid: JsonSchemaValidator<T> = {
      validate: () => ({ success: false, error: `Invalid schema: ${message}` }),
    }
    if (components) {
      const byComponent = validatorCache.get(schema) ?? new WeakMap<object, JsonSchemaValidator<unknown>>()
      byComponent.set(components, invalid)
      validatorCache.set(schema, byComponent)
    } else {
      undefinedComponentsCache.set(schema, invalid)
    }
    return invalid
  }

  const compiled: JsonSchemaValidator<T> = {
    validate(data: unknown): ValidationResult<T> {
      if (validate(data)) return { success: true, data: data as T }
      const errors = validate.errors ?? []
      return {
        success: false,
        error: errors.map(formatValidationError).join(', ') || 'Validation failed',
      }
    },
  }
  if (components) {
    const byComponent = validatorCache.get(schema) ?? new WeakMap<object, JsonSchemaValidator<unknown>>()
    byComponent.set(components, compiled)
    validatorCache.set(schema, byComponent)
  } else {
    undefinedComponentsCache.set(schema, compiled)
  }
  return compiled
}

/** Join Zod-style issues as "path: message" pairs. */
function describeIssues(error: unknown): string | undefined {
  const issues = readProperty(error, 'issues')
  if (!Array.isArray(issues)) return undefined
  const messages = issues.map((issue: unknown) => {
    const path = readProperty(issue, 'path')
    const location = (Array.isArray(path) ? path.map(String).join('.') : '') || 'input'
    return `${location}: ${String(readProperty(issue, 'message'))}`
  })
  return messages.join(', ') || undefined
}

function describeSafeParseError(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = readProperty(error, 'message')
  return typeof message === 'string' ? message : String(error ?? 'Validation failed')
}

/**
 * Validate input against a ToolSchema with rich error messages.
 *
 * The schema is the authority for T: a successful result carries the value the
 * schema accepted (or produced, for transforming validators) as T.
 */
export function validateToolInput<T>(
  schema: ToolSchema<T>,
  data: unknown,
  components?: Record<string, JsonSchemaObject>,
): ValidationResult<T> {
  const safeParse = readMethod(schema, 'safeParse')

  // Case 1: Zod schema with safeParse
  if (isZodSchema(schema) && safeParse !== undefined) {
    const res = safeParse(data)
    if (readProperty(res, 'success')) return { success: true, data: readProperty(res, 'data') as T }
    const error = readProperty(res, 'error')
    const message = readProperty(error, 'message')
    return { success: false, error: describeIssues(error) || (typeof message === 'string' && message) || 'Validation failed' }
  }

  // Case 2: Custom validator objects. Keep these contracts useful even when
  // they are not Zod: safeParse is preferred, parse may transform the value,
  // and validate is a boolean/type-guard fallback.
  if (safeParse !== undefined) {
    const res = safeParse(data)
    if (readProperty(res, 'success')) return { success: true, data: readProperty(res, 'data') as T }
    return { success: false, error: describeSafeParseError(readProperty(res, 'error')) }
  }
  const parse = readMethod(schema, 'parse')
  if (parse !== undefined) {
    try {
      return { success: true, data: parse(data) as T }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Validation failed' }
    }
  }
  const validate = readMethod(schema, 'validate')
  if (validate !== undefined) {
    if (validate(data)) return { success: true, data: data as T }
    return { success: false, error: 'Validation failed against schema type guard' }
  }

  // Case 3: Plain JSON Schema object. The same compiled validator handles
  // primitive roots as well as object roots and all supported JSON Schema
  // vocabularies.
  return createJsonSchemaValidator<T>(schema as JsonSchemaObject, components).validate(data)
}
