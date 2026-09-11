/**
 * Dynamic Runtime Validator for OpenAPI 3.2 schemas using Zod 4's native z.fromJSONSchema.
 *
 * Provides in-memory schema validation for zero-build testing, dynamic routing,
 * and mock-server usage by normalizing OAS 3.2 JSON Schema Draft 2020-12 constructs
 * ($ref rewriting, unevaluatedProperties adaptation, $defs dictionary linking).
 */

import { z } from 'zod'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

/**
 * Normalizes an OpenAPI 3.2 schema AST or node for consumption by Zod 4's `z.fromJSONSchema`:
 * 1. Rewrites `#/components/schemas/<Name>` and `#/schemas/<Name>` references to `#/$defs/<Name>`.
 * 2. Normalizes `unevaluatedProperties: false` (or `{ not: {} }`) to `additionalProperties: false`
 *    to prevent native unsupported keyword errors in Zod 4 while preserving object sealing.
 * 3. Normalizes `nullable: true` (OAS 3.0 legacy) to Draft 2020-12 type unions (`[type, 'null']`).
 * 4. Preserves cycle safety across recursive in-memory JavaScript objects.
 *
 * @param node Schema or AST node to normalize
 * @param doc Optional parent OpenAPI document for context
 * @param seen WeakMap to prevent circular object traversal loops
 * @returns Normalized JSON Schema Draft 2020-12 compliant structure
 */
export function normalizeOasForZodRuntime(
  node: unknown,
  doc?: unknown,
  seen: WeakMap<object, any> = new WeakMap<object, any>()
): unknown {
  if (!node || typeof node !== 'object') {
    return node
  }

  if (seen.has(node as object)) {
    return seen.get(node as object)
  }

  if (Array.isArray(node)) {
    const arr: any[] = []
    seen.set(node, arr)
    for (const item of node) {
      arr.push(normalizeOasForZodRuntime(item, doc, seen))
    }
    return arr
  }

  const obj = node as Record<string, any>
  const result: Record<string, any> = {}
  seen.set(obj, result)

  for (const [key, val] of Object.entries(obj)) {
    if (key === '$ref' && typeof val === 'string') {
      result[key] = val
        .replace(/^#\/components\/schemas\//, '#/$defs/')
        .replace(/^#\/schemas\//, '#/$defs/')
    } else if (key === 'unevaluatedProperties') {
      // unevaluatedProperties is converted to additionalProperties below
    } else if (key === 'additionalProperties') {
      if (val === false) {
        result.additionalProperties = false
      } else if (
        typeof val === 'object' &&
        val !== null &&
        'not' in val &&
        typeof val.not === 'object' &&
        val.not !== null &&
        Object.keys(val.not).length === 0
      ) {
        result.additionalProperties = false
      } else {
        result.additionalProperties = normalizeOasForZodRuntime(val, doc, seen)
      }
    } else if (key === 'nullable' && val === true) {
      // Legacy OAS 3.0 nullable -> Draft 2020-12 type union
      if (typeof obj.type === 'string' && obj.type !== 'null') {
        result.type = [obj.type, 'null']
      } else if (Array.isArray(obj.type) && !obj.type.includes('null')) {
        result.type = [...obj.type, 'null']
      }
    } else {
      result[key] = normalizeOasForZodRuntime(val, doc, seen)
    }
  }

  // Handle unevaluatedProperties adaptation
  if ('unevaluatedProperties' in obj) {
    if (result.additionalProperties === undefined) {
      const uVal = obj.unevaluatedProperties
      if (
        uVal === false ||
        (typeof uVal === 'object' &&
          uVal !== null &&
          'not' in uVal &&
          typeof uVal.not === 'object' &&
          uVal.not !== null &&
          Object.keys(uVal.not).length === 0)
      ) {
        result.additionalProperties = false
      } else if (typeof uVal === 'object' && uVal !== null) {
        result.additionalProperties = normalizeOasForZodRuntime(uVal, doc, seen)
      }
    }
  }

  return result
}

/**
 * Creates a dynamic Zod 4 validator instance for a standalone or document-linked OAS schema.
 *
 * @param targetSchema Target OpenAPI 3.2 schema object
 * @param doc Optional OpenAPI document to provide component schema `$defs` resolution
 * @returns Zod 4 schema instance capable of `.parse()` and `.safeParse()`
 */
export function createDynamicZodValidator(
  targetSchema: OasSchema,
  doc?: OasDocument
): z.ZodTypeAny {
  const normalizedTarget = normalizeOasForZodRuntime(targetSchema, doc)

  if (typeof normalizedTarget === 'boolean') {
    return z.fromJSONSchema(normalizedTarget)
  }

  if (doc) {
    const rawSchemas = ((doc.components?.schemas ??
      (doc as any).schemas ??
      (doc as any).$defs ??
      {}) as Record<string, OasSchema>)

    const normalizedDefs: Record<string, any> = {}
    for (const [name, s] of Object.entries(rawSchemas)) {
      normalizedDefs[name] = normalizeOasForZodRuntime(s, doc)
    }

    const targetObj = normalizedTarget as Record<string, any>
    const rootSchema = {
      ...targetObj,
      $defs: {
        ...normalizedDefs,
        ...(typeof targetObj.$defs === 'object' && targetObj.$defs !== null ? targetObj.$defs : {}),
      },
    }
    return z.fromJSONSchema(rootSchema)
  }

  return z.fromJSONSchema(normalizedTarget as Record<string, any>)
}

/**
 * Creates an in-memory dictionary of executable Zod 4 validators for all component schemas
 * in an OpenAPI 3.2 document. Resolves cross-component and circular references via `$defs`.
 *
 * @param doc OpenAPI 3.2 document
 * @returns Dictionary mapping component schema names to executable Zod 4 schemas
 */
export function createRuntimeZodValidators(doc: OasDocument): Record<string, z.ZodTypeAny> {
  const rawSchemas = ((doc.components?.schemas ??
    (doc as any).schemas ??
    (doc as any).$defs ??
    {}) as Record<string, OasSchema>)

  const normalizedDefs: Record<string, any> = {}
  for (const [name, s] of Object.entries(rawSchemas)) {
    normalizedDefs[name] = normalizeOasForZodRuntime(s, doc)
  }

  const validators: Record<string, z.ZodTypeAny> = {}
  for (const name of Object.keys(rawSchemas)) {
    const rootSchema = {
      $defs: normalizedDefs,
      $ref: `#/$defs/${name}`,
    }
    validators[name] = z.fromJSONSchema(rootSchema)
  }

  return validators
}
