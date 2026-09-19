/**
 * @oa-sdk/tools — Schema Normalization and Validation
 *
 * Grounded in JSON Schema Draft 2020-12 and OpenAPI 3.1.
 * Supports TypeSpec emitted JSON Schemas, standalone type guards, and Zod schemas.
 */
import { z } from 'zod'
import type { ToolSchema } from './types.js'

/**
 * Standard JSON Schema Draft 2020-12 / OpenAPI 3.1 Object structure
 */
export interface JsonSchemaObject {
  $schema?: string | undefined
  type?: string | string[] | undefined
  properties?: Record<string, JsonSchemaProperty> | undefined
  required?: string[] | undefined
  description?: string | undefined
  additionalProperties?: boolean | Record<string, unknown> | undefined
  $defs?: Record<string, JsonSchemaObject> | undefined
  [key: string]: unknown
}

export interface JsonSchemaProperty {
  type?: string | string[] | undefined
  description?: string | undefined
  default?: unknown
  enum?: unknown[] | undefined
  items?: Record<string, unknown> | undefined
  $ref?: string | undefined
  [key: string]: unknown
}

/**
 * Check if a schema object is a Zod schema
 */
export function isZodSchema(schema: unknown): schema is z.ZodType<unknown> {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    ('_def' in schema || typeof (schema as Record<string, unknown>).safeParse === 'function')
  )
}

/**
 * Dereference a schema or embed components into $defs to ensure full client portability.
 */
export function dereferenceSchema(
  schema: JsonSchemaObject,
  components?: Record<string, JsonSchemaObject>,
  visited = new Set<string>(),
): JsonSchemaObject {
  if (!schema || typeof schema !== 'object') return schema

  // If this schema has a $ref and we have a component registry
  if (typeof schema.$ref === 'string' && components) {
    const refKey = schema.$ref.replace(/^#\/(?:components\/schemas|\$defs)\//, '')
    if (components[refKey] && !visited.has(refKey)) {
      visited.add(refKey)
      const resolved = dereferenceSchema(components[refKey]!, components, visited)
      return { ...resolved, description: schema.description ?? resolved.description }
    }
  }

  const result: JsonSchemaObject = { ...schema }

  if (result.properties) {
    const resolvedProps: Record<string, JsonSchemaProperty> = {}
    for (const [k, v] of Object.entries(result.properties)) {
      if (v && typeof v === 'object' && typeof v.$ref === 'string' && components) {
        const refKey = v.$ref.replace(/^#\/(?:components\/schemas|\$defs)\//, '')
        if (components[refKey] && !visited.has(refKey)) {
          visited.add(refKey)
          const resolved = dereferenceSchema(components[refKey] as JsonSchemaObject, components, visited)
          resolvedProps[k] = { ...resolved, description: v.description ?? resolved.description }
          continue
        }
      }
      resolvedProps[k] = v
    }
    result.properties = resolvedProps
  }

  return result
}

/**
 * Normalize any ToolSchema (TypeSpec JSON Schema, OpenAPI object, or Zod schema)
 * into a standard JSON Schema Draft 2020-12 / OpenAPI 3.1 object.
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

  // Case 1: Zod schema -> use Zod 4 built-in toJSONSchema or extraction
  if (isZodSchema(schema)) {
    try {
      const jsonSchema = (z as any).toJSONSchema
        ? (z as any).toJSONSchema(schema)
        : null

      if (jsonSchema && typeof jsonSchema === 'object') {
        return {
          type: 'object',
          properties: jsonSchema.properties ?? {},
          required: jsonSchema.required,
          description: jsonSchema.description,
          additionalProperties: jsonSchema.additionalProperties,
        }
      }
    } catch {
      // Fallback below if toJSONSchema throws on unsupported constructs
    }

    // Fallback: extract properties directly from Zod shape if available
    const shape = (schema as any).shape ?? ((schema as any)._def?.shape)
    if (shape && typeof shape === 'object') {
      const properties: Record<string, JsonSchemaProperty> = {}
      const required: string[] = []

      for (const [key, prop] of Object.entries(shape)) {
        const p = prop as any
        const desc = p.description ?? p._def?.description
        const typeName = p._def?.type ?? p._def?.typeName ?? 'string'
        const isOpt = typeof p.isOptional === 'function' ? p.isOptional() : false

        let propType = 'string'
        if (typeName.toLowerCase().includes('number')) propType = 'number'
        else if (typeName.toLowerCase().includes('boolean')) propType = 'boolean'
        else if (typeName.toLowerCase().includes('array')) propType = 'array'
        else if (typeName.toLowerCase().includes('object')) propType = 'object'

        properties[key] = {
          type: propType,
          description: desc,
        }

        if (!isOpt) {
          required.push(key)
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      }
    }
  }

  // Case 2: Plain JSON Schema object (from TypeSpec / OpenAPI)
  const obj = schema as Record<string, unknown>
  const properties = (obj.properties as Record<string, JsonSchemaProperty>) ?? {}
  const required = Array.isArray(obj.required) ? (obj.required as string[]) : undefined

  const normalized: JsonSchemaObject = {
    type: 'object',
    properties,
    required,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    $defs: obj.$defs as Record<string, JsonSchemaObject> | undefined,
  }

  if (components) {
    return dereferenceSchema(normalized, components)
  }

  return normalized
}

/**
 * Validation result contract
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Validate input against a ToolSchema with rich error messages
 */
export function validateToolInput<T>(schema: ToolSchema<T>, data: unknown): ValidationResult<T> {
  // Case 1: Zod schema with safeParse
  if (isZodSchema(schema) && typeof (schema as any).safeParse === 'function') {
    const res = (schema as any).safeParse(data)
    if (res.success) {
      return { success: true, data: res.data as T }
    }
    const issueMessages = res.error?.issues?.map((i: any) => `${i.path.join('.') || 'input'}: ${i.message}`).join(', ')
    const errMsg = issueMessages || res.error?.message || 'Validation failed'
    return { success: false, error: errMsg }
  }

  // Case 2: Custom validator object with validate type guard
  if (schema && typeof (schema as any).validate === 'function') {
    if ((schema as any).validate(data)) {
      return { success: true, data: data as T }
    }
    return { success: false, error: 'Validation failed against schema type guard' }
  }

  // Case 3: Plain JSON Schema object -> basic property & type validation
  const norm = normalizeJsonSchema(schema)
  if (typeof data !== 'object' || data === null) {
    return { success: false, error: `Input must be a JSON object, received ${typeof data}` }
  }

  const rec = data as Record<string, unknown>

  // Required field checks
  if (norm.required && norm.required.length > 0) {
    for (const req of norm.required) {
      if (rec[req] === undefined || rec[req] === null || rec[req] === '') {
        return { success: false, error: `Missing required field: "${req}"` }
      }
    }
  }

  // Type checks if properties are declared
  if (norm.properties) {
    for (const [key, prop] of Object.entries(norm.properties)) {
      const val = rec[key]
      if (val === undefined || val === null) continue

      const expected = Array.isArray(prop.type) ? prop.type[0] : prop.type
      if (expected === 'number' || expected === 'integer') {
        if (typeof val !== 'number' || Number.isNaN(val)) {
          return { success: false, error: `Field "${key}" must be a number, received ${typeof val}` }
        }
      } else if (expected === 'boolean') {
        if (typeof val !== 'boolean') {
          return { success: false, error: `Field "${key}" must be a boolean, received ${typeof val}` }
        }
      } else if (expected === 'string') {
        if (typeof val !== 'string') {
          return { success: false, error: `Field "${key}" must be a string, received ${typeof val}` }
        }
      } else if (expected === 'array') {
        if (!Array.isArray(val)) {
          return { success: false, error: `Field "${key}" must be an array, received ${typeof val}` }
        }
      }
    }
  }

  return { success: true, data: data as T }
}
