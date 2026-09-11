/**
 * OpenAPI 3.2 Schema Object → Zod 4 code generation engine
 *
 * Implements SchemaAlgebra<string> for foldSchema traversal.
 * Supports:
 *   - Leaf types: string (formats, min/max, pattern, enum, const), integer (z.int(), bounds), number, boolean, null
 *   - Numeric bounds: exclusiveMinimum (.gt), exclusiveMaximum (.lt), minimum (.gte), maximum (.lte), multipleOf
 *   - Composite types:
 *       object: properties, required/optional, sealing (.strict, .catchall, .passthrough)
 *       array: prefixItems (z.tuple), items (.rest), minItems/maxItems
 *   - Combinator types:
 *       allOf: chained .and()
 *       oneOf: z.discriminatedUnion (with defaultMapping fallback) or z.union
 *       anyOf: z.union
 *       typeUnion: nullable unions (.nullable())
 *   - References:
 *       #/components/schemas/<Name> → z.lazy(() => <Name>Schema)
 *   - Metadata:
 *       .describe(), .default()
 */

import { foldSchema, type SchemaAlgebra, type OasSchema } from '@oa-sdk/parser'
import { escapeKey, quoteTypeScriptString, toTypeScriptIdentifier, pascalCase } from '@oa-sdk/core'

export interface Zod4AlgebraOptions {
  /** Map of #/components/schemas/Name or ref string -> schema identifier override */
  refNameOverrides?: Record<string, string>
  /** WeakMap storing default values stripped before foldSchema to prevent short-circuit */
  defaultValues?: WeakMap<OasSchema, unknown>
  /** Suffix for generated schema variables (default: 'Schema') */
  schemaSuffix?: string
  /** Whether to make objects strict by default if additionalProperties/unevaluatedProperties is omitted */
  strictObjects?: boolean
  /** Set of property names that act as discriminators in the spec */
  discriminatorProperties?: Set<string>
}

/**
 * Creates an independent OpenAPI 3.2 Schema → Zod 4 expression algebra.
 */
export function createZod4Algebra(options: Zod4AlgebraOptions = {}): SchemaAlgebra<string> {
  const refNameOverrides = { ...options.refNameOverrides }
  const defaultValues = options.defaultValues ?? new WeakMap<OasSchema, unknown>()
  const suffix = options.schemaSuffix ?? 'Schema'

  const algebra: SchemaAlgebra<string> = {
    string(s) {
      if (s.const !== undefined) {
        return wrapMetadata(s, `z.literal(${JSON.stringify(s.const)})`, defaultValues)
      }

      if (s.enum && s.enum.length > 0) {
        if (s.enum.every(v => typeof v === 'string')) {
          const enumValues = s.enum.map(v => JSON.stringify(String(v))).join(', ')
          return wrapMetadata(s, `z.enum([${enumValues}])`, defaultValues)
        }
        return wrapMetadata(
          s,
          `z.union([${s.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`,
          defaultValues,
        )
      }

      let expr = 'z.string()'

      if (s.format) {
        switch (s.format) {
          case 'uuid':
          case 'guid':
            expr += '.guid()'
            break
          case 'email':
            expr += '.email()'
            break
          case 'uri':
          case 'url':
          case 'uri-reference':
            expr += '.url()'
            break
          case 'date-time':
            expr += '.datetime()'
            break
          case 'date':
            expr += '.date()'
            break
          case 'time':
            expr += '.time()'
            break
          case 'duration':
            expr += '.duration()'
            break
          case 'ipv4':
            expr += '.ipv4()'
            break
          case 'ipv6':
            expr += '.ipv6()'
            break
          case 'cuid':
            expr += '.cuid()'
            break
          case 'cuid2':
            expr += '.cuid2()'
            break
          case 'ulid':
            expr += '.ulid()'
            break
          case 'nanoid':
            expr += '.nanoid()'
            break
        }
      }

      if (typeof s.minLength === 'number') expr += `.min(${s.minLength})`
      if (typeof s.maxLength === 'number') expr += `.max(${s.maxLength})`
      if (s.pattern) expr += `.regex(new RegExp(${JSON.stringify(s.pattern)}))`

      return wrapMetadata(s, expr, defaultValues)
    },

    integer(s) {
      if (s.const !== undefined) {
        return wrapMetadata(s, `z.literal(${JSON.stringify(s.const)})`, defaultValues)
      }
      if (s.enum && s.enum.length > 0) {
        return wrapMetadata(
          s,
          `z.union([${s.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`,
          defaultValues,
        )
      }

      let expr = 'z.int()'
      expr = applyNumericBounds(s, expr)
      return wrapMetadata(s, expr, defaultValues)
    },

    number(s) {
      if (s.const !== undefined) {
        return wrapMetadata(s, `z.literal(${JSON.stringify(s.const)})`, defaultValues)
      }
      if (s.enum && s.enum.length > 0) {
        return wrapMetadata(
          s,
          `z.union([${s.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`,
          defaultValues,
        )
      }

      let expr = 'z.number()'
      expr = applyNumericBounds(s, expr)
      return wrapMetadata(s, expr, defaultValues)
    },

    boolean(s) {
      if (s.const !== undefined) {
        return wrapMetadata(s, `z.literal(${JSON.stringify(s.const)})`, defaultValues)
      }
      if (s.enum && s.enum.length > 0) {
        return wrapMetadata(
          s,
          `z.union([${s.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`,
          defaultValues,
        )
      }
      return wrapMetadata(s, 'z.boolean()', defaultValues)
    },

    null(s) {
      return wrapMetadata(s, 'z.null()', defaultValues)
    },

    const_(value) {
      return `z.literal(${JSON.stringify(value)})`
    },

    object(s, properties) {
      const required = new Set(s.required ?? [])
      const entries = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))

      let body: string
      if (entries.length === 0) {
        body = 'z.object({})'
      } else {
        const fieldLines = entries.map(([key, propCode]) => {
          const isDiscriminatorProp =
            options.discriminatorProperties?.has(key) &&
            s.properties?.[key] &&
            typeof s.properties[key] === 'object' &&
            (('const' in (s.properties[key] as Record<string, unknown>)) ||
              ('enum' in (s.properties[key] as Record<string, unknown>)))
          const isRequired = required.has(key) || Boolean(isDiscriminatorProp)
          const expr = isRequired ? propCode : `${propCode}.optional()`
          return `  ${escapeKey(key)}: ${expr},`
        })
        body = `z.object({\n${fieldLines.join('\n')}\n})`
      }

      const isStrict =
        s.additionalProperties === false ||
        s.unevaluatedProperties === false ||
        isNeverSchema(s.additionalProperties) ||
        isNeverSchema(s.unevaluatedProperties) ||
        (options.strictObjects === true && s.additionalProperties === undefined && s.unevaluatedProperties === undefined)

      if (isStrict) {
        body += '.strict()'
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        const catchallSchema = foldSchema(s.additionalProperties as OasSchema, algebra)
        body += `.catchall(${catchallSchema})`
      } else if (s.unevaluatedProperties && typeof s.unevaluatedProperties === 'object') {
        const catchallSchema = foldSchema(s.unevaluatedProperties as OasSchema, algebra)
        body += `.catchall(${catchallSchema})`
      } else if (s.additionalProperties === true || s.unevaluatedProperties === true) {
        body += '.passthrough()'
      }

      return wrapMetadata(s, body, defaultValues)
    },

    array(s, items) {
      const itemsAsUnknown = s.items as unknown
      if (Array.isArray(s.prefixItems) && (s.prefixItems.length > 0 || itemsAsUnknown === false)) {
        const prefix = s.prefixItems.map(p => foldSchema(p, algebra))
        let expr = `z.tuple([${prefix.join(', ')}])`
        if (s.items && typeof s.items === 'object' && !Array.isArray(s.items)) {
          const restItem = foldSchema(s.items as OasSchema, algebra)
          expr += `.rest(${restItem})`
        } else if (itemsAsUnknown === true) {
          expr += '.rest(z.unknown())'
        }

        if (typeof s.minItems === 'number') {
          expr += `.check(z.minLength(${s.minItems}))`
        }
        if (typeof s.maxItems === 'number') {
          expr += `.check(z.maxLength(${s.maxItems}))`
        }
        return wrapMetadata(s, expr, defaultValues)
      }

      let expr = `z.array(${items ?? 'z.unknown()'})`
      if (typeof s.minItems === 'number') expr += `.min(${s.minItems})`
      if (typeof s.maxItems === 'number') expr += `.max(${s.maxItems})`
      return wrapMetadata(s, expr, defaultValues)
    },

    allOf(s, branches) {
      const siblingObj = foldSiblingProperties(s, 'allOf', algebra)
      const allBranches = siblingObj ? [...branches, siblingObj] : branches
      if (allBranches.length === 0) return 'z.unknown()'
      if (allBranches.length === 1) return wrapMetadata(s, allBranches[0]!, defaultValues)
      let expr = allBranches[0]!
      for (let i = 1; i < allBranches.length; i++) {
        expr = `${expr}.and(${allBranches[i]})`
      }
      return wrapMetadata(s, expr, defaultValues)
    },

    oneOf(s, branches) {
      if (s.discriminator?.propertyName) {
        let discBranches = branches
        if (s.discriminator.mapping && Object.keys(s.discriminator.mapping).length > 0) {
          discBranches = buildMappingBranches(
            s.discriminator.mapping,
            s.discriminator.propertyName,
            refNameOverrides,
            suffix,
          )
        }
        let discExpr = `z.discriminatedUnion(${JSON.stringify(s.discriminator.propertyName)}, [${discBranches.join(', ')}], { unionFallback: true })`
        if (s.discriminator.defaultMapping) {
          const defaultFallback = buildDiscriminatorFallback(
            s.discriminator.defaultMapping,
            s.discriminator.propertyName,
            refNameOverrides,
            suffix,
          )
          discExpr = `z.union([${discExpr}, ${defaultFallback}])`
        }
        const siblingObj = foldSiblingProperties(s, 'oneOf', algebra)
        if (siblingObj) {
          discExpr = `${siblingObj}.and(${discExpr})`
        }
        return wrapMetadata(s, discExpr, defaultValues)
      }

      const siblingObj = foldSiblingProperties(s, 'oneOf', algebra)
      let unionExpr: string
      if (branches.length === 0) unionExpr = 'z.never()'
      else if (branches.length === 1) unionExpr = branches[0]!
      else unionExpr = `z.union([${branches.join(', ')}])`

      if (siblingObj) {
        unionExpr = `${siblingObj}.and(${unionExpr})`
      }
      return wrapMetadata(s, unionExpr, defaultValues)
    },

    anyOf(s, branches) {
      const siblingObj = foldSiblingProperties(s, 'anyOf', algebra)
      let unionExpr: string
      if (branches.length === 0) unionExpr = 'z.unknown()'
      else if (branches.length === 1) unionExpr = branches[0]!
      else unionExpr = `z.union([${branches.join(', ')}])`

      if (siblingObj) {
        unionExpr = `${siblingObj}.and(${unionExpr})`
      }
      return wrapMetadata(s, unionExpr, defaultValues)
    },

    typeUnion(s, branches) {
      const isNullable = Array.isArray(s.type) && s.type.includes('null')
      const nonNullBranches = branches.filter(b => b !== 'z.null()')
      let base: string
      if (nonNullBranches.length === 0) {
        base = 'z.null()'
      } else if (nonNullBranches.length === 1) {
        base = nonNullBranches[0]!
      } else {
        base = `z.union([${nonNullBranches.join(', ')}])`
      }

      if (isNullable && base !== 'z.null()') {
        return wrapMetadata(s, `${base}.nullable()`, defaultValues)
      }
      return wrapMetadata(s, base, defaultValues)
    },

    ref(refString) {
      if (refNameOverrides[refString]) {
        const target = refNameOverrides[refString]!
        if (target.startsWith('z.')) return target
        return `z.lazy(() => ${target})`
      }
      const targetName = schemaNameFromRef(refString, suffix)
      return `z.lazy(() => ${targetName})`
    },

    example() {
      return 'z.unknown()'
    },

    default_() {
      return 'z.unknown()'
    },

    fallback(node) {
      if (node === true) return 'z.unknown()'
      if (node === false) return 'z.never()'
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const s = node as OasSchema
        if (s.const !== undefined) {
          return wrapMetadata(s, `z.literal(${JSON.stringify(s.const)})`, defaultValues)
        }
        if (s.enum && s.enum.length > 0) {
          if (s.enum.every(v => typeof v === 'string')) {
            const values = s.enum.map(v => JSON.stringify(String(v))).join(', ')
            return wrapMetadata(s, `z.enum([${values}])`, defaultValues)
          }
          return wrapMetadata(
            s,
            `z.union([${s.enum.map(v => `z.literal(${JSON.stringify(v)})`).join(', ')}])`,
            defaultValues,
          )
        }
        if (s.prefixItems || s.items) {
          return algebra.array(s, s.items ? foldSchema(s.items as OasSchema, algebra) : null)
        }
        if (s.properties || s.additionalProperties !== undefined || s.unevaluatedProperties !== undefined) {
          return algebra.object(s, {})
        }
      }
      return 'z.unknown()'
    },
  }

  return algebra
}

/**
 * Strips example and default fields from schema and nested sub-schemas to prevent
 * foldSchema's premature termination, while recording default values in a WeakMap.
 */
export function prepareSchemaForZod(
  schema: OasSchema,
  defaultValues: WeakMap<OasSchema, unknown>,
): OasSchema {
  if (!schema || typeof schema !== 'object') return schema

  const { example, default: def, ...rest } = schema as Record<string, unknown>
  const clean = { ...rest } as OasSchema

  if (def !== undefined) {
    defaultValues.set(clean, def)
  }

  if (clean.properties) {
    const nextProps: Record<string, OasSchema> = {}
    for (const [k, v] of Object.entries(clean.properties)) {
      nextProps[k] = prepareSchemaForZod(v, defaultValues)
    }
    clean.properties = nextProps
  }
  if (clean.items && typeof clean.items === 'object' && !Array.isArray(clean.items)) {
    clean.items = prepareSchemaForZod(clean.items as OasSchema, defaultValues)
  }
  if (Array.isArray(clean.prefixItems)) {
    clean.prefixItems = clean.prefixItems.map(p => prepareSchemaForZod(p, defaultValues))
  }
  if (Array.isArray(clean.allOf)) {
    clean.allOf = clean.allOf.map(p => prepareSchemaForZod(p, defaultValues))
  }
  if (Array.isArray(clean.oneOf)) {
    const discProp = clean.discriminator?.propertyName
    clean.oneOf = clean.oneOf.map(p => {
      const prepared = prepareSchemaForZod(p, defaultValues)
      if (
        discProp &&
        typeof prepared === 'object' &&
        prepared !== null &&
        prepared.properties &&
        discProp in prepared.properties
      ) {
        const req = new Set(prepared.required ?? [])
        req.add(discProp)
        prepared.required = Array.from(req)
      }
      return prepared
    })
  }
  if (Array.isArray(clean.anyOf)) {
    const discProp = clean.discriminator?.propertyName
    clean.anyOf = clean.anyOf.map(p => {
      const prepared = prepareSchemaForZod(p, defaultValues)
      if (
        discProp &&
        typeof prepared === 'object' &&
        prepared !== null &&
        prepared.properties &&
        discProp in prepared.properties
      ) {
        const req = new Set(prepared.required ?? [])
        req.add(discProp)
        prepared.required = Array.from(req)
      }
      return prepared
    })
  }
  if (clean.additionalProperties && typeof clean.additionalProperties === 'object') {
    clean.additionalProperties = prepareSchemaForZod(clean.additionalProperties as OasSchema, defaultValues)
  }
  if (clean.unevaluatedProperties && typeof clean.unevaluatedProperties === 'object') {
    clean.unevaluatedProperties = prepareSchemaForZod(clean.unevaluatedProperties as OasSchema, defaultValues)
  }
  if (clean.not && typeof clean.not === 'object') {
    clean.not = prepareSchemaForZod(clean.not as OasSchema, defaultValues)
  }
  if (clean.if && typeof clean.if === 'object') {
    clean.if = prepareSchemaForZod(clean.if as OasSchema, defaultValues)
  }
  if (clean.then && typeof clean.then === 'object') {
    clean.then = prepareSchemaForZod(clean.then as OasSchema, defaultValues)
  }
  if (clean.else && typeof clean.else === 'object') {
    clean.else = prepareSchemaForZod(clean.else as OasSchema, defaultValues)
  }

  return clean
}

/**
 * Converts an OpenAPI 3.2 Schema Object to a Zod 4 code expression string.
 */
export function schemaToZod(schema: OasSchema, options: Zod4AlgebraOptions = {}): string {
  const defaultValues = options.defaultValues ?? new WeakMap<OasSchema, unknown>()
  const clean = prepareSchemaForZod(schema, defaultValues)
  const discriminatorProperties = new Set<string>(options.discriminatorProperties ?? [])
  collectDiscriminatorProperties(clean, discriminatorProperties)
  const algebra = createZod4Algebra({ ...options, defaultValues, discriminatorProperties })
  return foldSchema(clean, algebra)
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function applyNumericBounds(s: OasSchema, baseExpr: string): string {
  let expr = baseExpr
  if (typeof s.exclusiveMinimum === 'number') {
    expr += `.gt(${s.exclusiveMinimum})`
  } else if (typeof s.minimum === 'number') {
    expr += `.gte(${s.minimum})`
  }

  if (typeof s.exclusiveMaximum === 'number') {
    expr += `.lt(${s.exclusiveMaximum})`
  } else if (typeof s.maximum === 'number') {
    expr += `.lte(${s.maximum})`
  }

  if (typeof s.multipleOf === 'number') {
    expr += `.multipleOf(${s.multipleOf})`
  }
  return expr
}

function wrapMetadata(
  s: OasSchema,
  expr: string,
  defaultValues: WeakMap<OasSchema, unknown>,
): string {
  let res = expr
  const rawSchema = s as Record<string, unknown>
  if (rawSchema.nullable === true && !res.endsWith('.nullable()') && res !== 'z.null()') {
    res = `${res}.nullable()`
  }
  const defVal = defaultValues.get(s) ?? s.default
  if (defVal !== undefined) {
    res = `${res}.default(${JSON.stringify(defVal)})`
  }
  if (s.description) {
    res = `${res}.describe(${JSON.stringify(s.description)})`
  }
  return res
}

function isNeverSchema(schema: unknown): boolean {
  if (schema === false) return true
  if (typeof schema !== 'object' || schema === null) return false
  const obj = schema as Record<string, unknown>
  if (typeof obj.not === 'object' && obj.not !== null && Object.keys(obj.not).length === 0) return true
  if (obj.type === 'never' || obj.not === true) return true
  return false
}

function schemaNameFromRef(ref: string, schemaSuffix = 'Schema'): string {
  const parts = ref.split('/')
  const raw = parts[parts.length - 1] ?? 'Unknown'
  const decoded = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~')
  const ident = toTypeScriptIdentifier(pascalCase(decoded))
  return `${ident}${schemaSuffix}`
}

function resolveRefString(ref: string, algebra: SchemaAlgebra<string>): string {
  if (ref.startsWith('#/')) {
    return algebra.ref(ref)
  }
  return algebra.ref(`#/components/schemas/${ref}`)
}

function buildDiscriminatorFallback(
  defaultMapping: string,
  propertyName: string,
  refNameOverrides: Record<string, string>,
  suffix: string,
): string {
  let targetIdent: string
  const fullRef = defaultMapping.startsWith('#/') ? defaultMapping : `#/components/schemas/${defaultMapping}`
  if (refNameOverrides[defaultMapping]) {
    targetIdent = refNameOverrides[defaultMapping]!
    targetIdent = targetIdent.replace(/^z\.lazy\(\(\)\s*=>\s*/, '').replace(/\)$/, '')
  } else if (refNameOverrides[fullRef]) {
    targetIdent = refNameOverrides[fullRef]!
    targetIdent = targetIdent.replace(/^z\.lazy\(\(\)\s*=>\s*/, '').replace(/\)$/, '')
  } else {
    targetIdent = schemaNameFromRef(defaultMapping, suffix)
  }
  return `z.lazy(() => 'extend' in ${targetIdent} ? ${targetIdent}.extend({ ${escapeKey(propertyName)}: z.string().optional() }) : ${targetIdent})`
}

export function buildMappingBranches(
  mapping: Record<string, string>,
  propertyName: string,
  refNameOverrides: Record<string, string>,
  suffix: string,
): string[] {
  return Object.entries(mapping).map(([key, ref]) => {
    let targetIdent: string
    const fullRef = ref.startsWith('#/') ? ref : `#/components/schemas/${ref}`
    if (refNameOverrides[ref]) {
      targetIdent = refNameOverrides[ref]!.replace(/^z\.lazy\(\(\)\s*=>\s*/, '').replace(/\)$/, '')
    } else if (refNameOverrides[fullRef]) {
      targetIdent = refNameOverrides[fullRef]!.replace(/^z\.lazy\(\(\)\s*=>\s*/, '').replace(/\)$/, '')
    } else {
      targetIdent = schemaNameFromRef(ref, suffix)
    }
    return `z.lazy(() => 'extend' in ${targetIdent} ? ${targetIdent}.extend({ ${escapeKey(propertyName)}: z.literal(${JSON.stringify(key)}) }) : ${targetIdent})`
  })
}

export function collectDiscriminatorProperties(node: unknown, props: Set<string>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectDiscriminatorProperties(item, props)
    return
  }
  const obj = node as Record<string, any>
  if (obj.discriminator && typeof obj.discriminator === 'object' && typeof obj.discriminator.propertyName === 'string') {
    props.add(obj.discriminator.propertyName)
  }
  for (const val of Object.values(obj)) {
    collectDiscriminatorProperties(val, props)
  }
}

function foldSiblingProperties(
  s: OasSchema,
  omittedKey: 'allOf' | 'oneOf' | 'anyOf',
  algebra: SchemaAlgebra<string>,
): string | null {
  if (!s.properties && s.additionalProperties === undefined && s.unevaluatedProperties === undefined) {
    return null
  }
  const {
    [omittedKey]: _,
    description,
    default: _def,
    example,
    title,
    $comment,
    ...siblingSchema
  } = s as Record<string, unknown>
  const siblingObject = {
    ...siblingSchema,
    type: 'object',
  } as OasSchema
  return foldSchema(siblingObject, algebra)
}
