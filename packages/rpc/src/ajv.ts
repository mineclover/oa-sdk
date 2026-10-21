import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import type { OasSchema } from '@oa-sdk/parser'
import type { RpcContract, RpcSchemaCheck, RpcValidator } from './types.js'

/** Structural subset of an Ajv instance the validator compiles with. */
export type AjvLike = {
  compile(schema: object): {
    (value: unknown): boolean
    errors?: ErrorObject[] | null | undefined
  }
}

export type AjvValidatorOptions = {
  /**
   * Ajv instance to compile with, e.g. one with `ajv-formats` added. The default is an Ajv 2020-12
   * instance with `strict: false` (OpenAPI keywords such as `example` or `discriminator` are
   * ignored) and without format validation.
   */
  ajv?: AjvLike
}

/**
 * Validates RPC input and output with Ajv (JSON Schema 2020-12, the OpenAPI 3.1+ dialect).
 *
 * A binary value described the OpenAPI 3.0 way, `{ type: 'string', format: 'binary' }`, reaches
 * the validator as what the HTTP codec made of it (a `Uint8Array` request body, a `File`
 * multipart part, a `Blob` client input), not as a JSON string. Such subschemas are compiled
 * without their `type` and `format`, so any value is accepted there; `required` and the other
 * keywords still apply. The contract itself is not modified.
 */
export function createAjvValidator(options: AjvValidatorOptions = {}): RpcValidator {
  const ajv: AjvLike = options.ajv ?? new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
  // Component schemas are rewritten once per contract, not once per compiled procedure schema.
  const componentSchemas = new WeakMap<RpcContract['schemas'], Record<string, unknown>>()
  return (schema: OasSchema, contract: RpcContract): RpcSchemaCheck => {
    let schemas = componentSchemas.get(contract.schemas)
    if (schemas === undefined) {
      schemas = copySchemaMap(contract.schemas, new WeakMap())
      componentSchemas.set(contract.schemas, schemas)
    }
    const root = copySchema(schema, new WeakMap())
    // `#/components/schemas/*` references resolve against the root of the compiled schema.
    const validate = ajv.compile({ ...(isRecord(root) ? root : {}), components: { schemas } })
    return (value) => {
      if (validate(value)) return []
      return (validate.errors ?? []).map(error => ({
        path: error.instancePath === '' ? '/' : error.instancePath,
        message: describe(error),
      }))
    }
  }
}

function describe(error: ErrorObject): string {
  if (error.keyword === 'required') return `missing required property "${String(error.params.missingProperty)}"`
  if (error.keyword === 'additionalProperties') return `unknown property "${String(error.params.additionalProperty)}"`
  return error.message ?? error.keyword
}

// ─── Binary subschemas ──────────────────────────────────────────────────────

/** How a keyword holds subschemas: one schema, an array of schemas, or a map of named schemas. */
type SubschemaShape = 'schema' | 'list' | 'map'

const SUBSCHEMA_KEYWORDS: ReadonlyMap<string, SubschemaShape> = new Map<string, SubschemaShape>([
  ['items', 'schema'],
  ['additionalItems', 'schema'],
  ['contains', 'schema'],
  ['propertyNames', 'schema'],
  ['additionalProperties', 'schema'],
  ['unevaluatedProperties', 'schema'],
  ['unevaluatedItems', 'schema'],
  ['not', 'schema'],
  ['if', 'schema'],
  ['then', 'schema'],
  ['else', 'schema'],
  ['contentSchema', 'schema'],
  ['prefixItems', 'list'],
  ['allOf', 'list'],
  ['anyOf', 'list'],
  ['oneOf', 'list'],
  ['properties', 'map'],
  ['patternProperties', 'map'],
  ['dependentSchemas', 'map'],
  ['$defs', 'map'],
  ['definitions', 'map'],
])

/** Copies already made, so shared and cyclic subschemas are copied once. */
type SchemaCopies = WeakMap<object, Record<string, unknown>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `{ type: 'string', format: 'binary' }`, also with a type list such as `['string', 'null']`. */
function isBinaryString(schema: Record<string, unknown>): boolean {
  if (schema.format !== 'binary') return false
  return schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))
}

/**
 * Copies a schema with every binary string subschema reduced to its other keywords. Data
 * keywords such as `const`, `enum`, `default` and `examples` are copied as they are; boolean
 * schemas are returned unchanged.
 */
function copySchema(value: unknown, copies: SchemaCopies): unknown {
  if (!isRecord(value)) return value
  const known = copies.get(value)
  if (known !== undefined) return known
  const copy: Record<string, unknown> = {}
  copies.set(value, copy)
  const binary = isBinaryString(value)
  for (const [keyword, entry] of Object.entries(value)) {
    if (binary && (keyword === 'type' || keyword === 'format')) continue
    defineOwn(copy, keyword, copyKeyword(SUBSCHEMA_KEYWORDS.get(keyword), entry, copies))
  }
  return copy
}

function copyKeyword(shape: SubschemaShape | undefined, entry: unknown, copies: SchemaCopies): unknown {
  if (shape === undefined) return entry
  // `items` may still be an array of schemas in older dialects.
  if (Array.isArray(entry)) return shape === 'map' ? entry : entry.map(item => copySchema(item, copies))
  if (shape === 'schema') return copySchema(entry, copies)
  return shape === 'map' && isRecord(entry) ? copySchemaMap(entry, copies) : entry
}

function copySchemaMap(record: Record<string, unknown>, copies: SchemaCopies): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [name, schema] of Object.entries(record)) defineOwn(copy, name, copySchema(schema, copies))
  return copy
}

/** Property names come from the contract; a `__proto__` property must stay a property. */
function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}
