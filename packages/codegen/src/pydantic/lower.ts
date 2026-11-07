/** S3 — lower prepared schemas to fact-only Pydantic IR. */
import { foldSchema, type OasSchema, type SchemaAlgebra } from '@oa-sdk/parser'
import { parseRefTarget, type SchemaGraphAnalysis } from '../schema-graph/index.js'
import type {
  PyConstraints,
  PyDecl,
  PyField,
  PyModelDecl,
  PyModuleIR,
  PyOpenness,
  PyTypeExpr,
  PydanticDiagnostic,
} from './ir.js'
import type { PreparedPydanticDocument } from './prepare.js'

type SchemaRecord = Record<string, unknown>

type LiteralValue = string | number | boolean | null

export interface PydanticLowerContext {
  analysis: SchemaGraphAnalysis
  pointerOf: WeakMap<object, string>
  inlineDecls: PyDecl[]
  diagnostics: PydanticDiagnostic[]
  defaultValues?: WeakMap<object, unknown>
  examples?: WeakMap<object, unknown[]>
  ownerName?: string | undefined
  propertyPath?: string | undefined
  componentNames?: Set<string>
  modelNames?: Set<string>
  declaredInline?: WeakMap<object, string>
  currentSchema?: unknown
}

function asRecord(value: unknown): SchemaRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as SchemaRecord
    : {}
}

function schemaPointer(schema: unknown, context: PydanticLowerContext): string {
  if (schema !== null && typeof schema === 'object') {
    const direct = context.pointerOf.get(schema)
    if (direct !== undefined) return direct
  }
  if (context.currentSchema !== null && typeof context.currentSchema === 'object') {
    return context.pointerOf.get(context.currentSchema) ?? '/'
  }
  return '/'
}

function addDiagnostic(
  context: PydanticLowerContext,
  code: `pydantic/${string}`,
  severity: PydanticDiagnostic['severity'],
  schema: unknown,
  message: string,
): void {
  context.diagnostics.push({
    code,
    severity,
    pointer: schemaPointer(schema, context),
    message,
  })
}

function metadata(schema: OasSchema, context: PydanticLowerContext): SchemaRecord {
  const source = asRecord(schema)
  const result: SchemaRecord = {}
  if (typeof source.description === 'string') result.description = source.description
  if (typeof source.deprecated === 'boolean') result.deprecated = source.deprecated
  const examples = context.examples?.get(schema as object)
    ?? (Array.isArray(source.examples)
      ? source.examples
      : source.example === undefined ? undefined : [source.example])
  if (examples !== undefined) result.examples = [...examples]
  const extensions = Object.fromEntries(
    Object.entries(source).filter(([key]) => key.startsWith('x-')),
  )
  if (Object.keys(extensions).length > 0) result.extensions = extensions
  const defaultValue = context.defaultValues?.get(schema as object)
    ?? source.default
  if (defaultValue !== undefined) result.schemaDefault = { json: defaultValue }
  return result
}

function literalValues(value: unknown): LiteralValue[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every(item => (
    item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  ))) return undefined
  return value as LiteralValue[]
}

function schemaConstraints(schema: OasSchema): PyConstraints {
  const source = asRecord(schema)
  const constraints: PyConstraints = {}
  if (typeof source.minLength === 'number') constraints.minLength = source.minLength
  if (typeof source.maxLength === 'number') constraints.maxLength = source.maxLength
  if (typeof source.minimum === 'number') constraints.ge = source.minimum
  if (typeof source.maximum === 'number') constraints.le = source.maximum
  if (typeof source.exclusiveMinimum === 'number') constraints.gt = source.exclusiveMinimum
  if (typeof source.exclusiveMaximum === 'number') constraints.lt = source.exclusiveMaximum
  if (typeof source.multipleOf === 'number') constraints.multipleOf = source.multipleOf
  if (typeof source.pattern === 'string') {
    constraints.pattern = { source: source.pattern, python: null }
  }
  if (typeof source.minItems === 'number') constraints.minLength = source.minItems
  if (typeof source.maxItems === 'number') constraints.maxLength = source.maxItems
  if (source.uniqueItems === true) constraints.uniqueItems = true
  return constraints
}

function withConstraints(schema: OasSchema, type: PyTypeExpr): PyTypeExpr {
  const constraints = schemaConstraints(schema)
  return Object.keys(constraints).length === 0
    ? type
    : { kind: 'constrained', base: type, constraints }
}

function noneType(): PyTypeExpr {
  return { kind: 'builtin', name: 'None' }
}

function anyType(): PyTypeExpr {
  return { kind: 'builtin', name: 'Any' }
}

function nullableParts(schema: OasSchema): { nullable: boolean; schema: OasSchema } {
  const source = asRecord(schema)
  if (source.nullable === true) return { nullable: true, schema }
  if (Array.isArray(source.type) && source.type.includes('null')) {
    const types = source.type.filter(item => item !== 'null')
    return {
      nullable: true,
      schema: { ...source, type: types.length === 1 ? types[0] : types } as OasSchema,
    }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = source[key]
    if (!Array.isArray(branches)) continue
    const nonNull = branches.filter(branch => asRecord(branch).type !== 'null')
    if (nonNull.length !== branches.length) {
      return { nullable: true, schema: { ...source, [key]: nonNull } as OasSchema }
    }
  }
  return { nullable: false, schema }
}

function unsupportedKeywords(schema: OasSchema, context: PydanticLowerContext): void {
  const source = asRecord(schema)
  for (const key of ['if', 'then', 'else', 'patternProperties', 'dependentSchemas', 'propertyNames']) {
    if (source[key] !== undefined) {
      addDiagnostic(
        context,
        'pydantic/unsupported-keyword',
        'warning',
        schema,
        `Unsupported schema keyword: ${key}`,
      )
    }
  }
  if (source.not !== undefined && JSON.stringify(source.not) !== '{}') {
    addDiagnostic(
      context,
      'pydantic/unsupported-keyword',
      'warning',
      schema,
      'Unsupported schema keyword: not',
    )
  }
}

function unresolvedRef(ref: string, schema: unknown, context: PydanticLowerContext): PyTypeExpr {
  const target = parseRefTarget(ref)
  if (target !== null && context.componentNames?.has(target)) return { kind: 'ref', target }
  addDiagnostic(context, 'pydantic/unresolved-ref', 'error', schema, `Unresolved schema reference: ${ref}`)
  return anyType()
}

function lowerInlineObject(schema: OasSchema, context: PydanticLowerContext): PyTypeExpr {
  const existing = context.declaredInline?.get(schema as object)
  if (existing !== undefined) return { kind: 'ref', target: existing }
  const name = `${context.ownerName ?? 'Inline'}/${context.propertyPath ?? 'object'}`
  context.declaredInline?.set(schema as object, name)
  context.inlineDecls.push(buildModelDecl(name, schema, context, 'inline'))
  return { kind: 'ref', target: name }
}

function scalarType(
  schema: OasSchema,
  base: 'string' | 'integer' | 'number',
  context: PydanticLowerContext,
): PyTypeExpr {
  const values = literalValues(asRecord(schema).enum)
  if (values !== undefined) return { kind: 'literal', values }
  const source = asRecord(schema)
  return withConstraints(schema, {
    kind: 'scalar',
    base,
    ...(typeof source.format === 'string' ? { format: source.format } : {}),
    ...(typeof source.contentEncoding === 'string' ? { contentEncoding: source.contentEncoding } : {}),
    pointer: schemaPointer(schema, context),
  })
}

function allOfType(
  schema: OasSchema,
  branches: PyTypeExpr[],
  context: PydanticLowerContext,
): PyTypeExpr {
  const source = asRecord(schema)
  const hasObjectBranch = Array.isArray(source.allOf)
    && source.allOf.some(branch => {
      const record = asRecord(branch)
      return record.properties !== undefined || record.type === 'object'
    })
  if (source.properties !== undefined || source.type === 'object' || hasObjectBranch) {
    return lowerInlineObject(schema, context)
  }
  const allOf = Array.isArray(source.allOf) ? source.allOf : []
  const allModelRefs = allOf.length > 0 && allOf.every(branch => {
    const target = parseRefTarget(asRecord(branch).$ref)
    return target !== null && context.modelNames?.has(target)
  })
  if (allModelRefs) return lowerInlineObject(schema, context)
  if (branches.length === 1) return branches[0] ?? anyType()
  addDiagnostic(
    context,
    'pydantic/allof-flattened',
    'warning',
    schema,
    'Non-object allOf was flattened to its first branch',
  )
  return branches[0] ?? anyType()
}

/** `SchemaAlgebra` producing IR type expressions; object nodes become inline declarations. */
export function createPydanticAlgebra(context: PydanticLowerContext): SchemaAlgebra<PyTypeExpr> {
  return {
    string: schema => scalarType(schema, 'string', context),
    integer: schema => scalarType(schema, 'integer', context),
    number: schema => scalarType(schema, 'number', context),
    boolean: schema => {
      const values = literalValues(asRecord(schema).enum)
      return values === undefined
        ? withConstraints(schema, { kind: 'builtin', name: 'bool' })
        : { kind: 'literal', values }
    },
    null: () => noneType(),
    const_: value => {
      const values = literalValues([value])
      return { kind: 'literal', values: values ?? [null] }
    },
    ref: ref => unresolvedRef(ref, context.currentSchema ?? { $ref: ref }, context),
    example: () => anyType(),
    default_: () => anyType(),
    fallback: node => {
      const source = asRecord(node)
      const values = literalValues(source.enum)
      if (values !== undefined) return { kind: 'literal', values }
      if (source.properties !== undefined) return lowerInlineObject(node as OasSchema, context)
      if (source.additionalProperties !== undefined && typeof source.additionalProperties === 'object') {
        return { kind: 'dict', value: schemaToPyType(source.additionalProperties as OasSchema, context) }
      }
      return anyType()
    },
    object: (schema) => {
      const source = asRecord(schema)
      if (source.additionalProperties !== undefined
        && typeof source.additionalProperties === 'object'
        && source.properties === undefined) {
        return { kind: 'dict', value: schemaToPyType(source.additionalProperties as OasSchema, context) }
      }
      return lowerInlineObject(schema, context)
    },
    array: (schema, items) => {
      const source = asRecord(schema)
      if (Array.isArray(source.prefixItems)) {
        const tupleItems = source.prefixItems.map((item, index) => {
          const previousPath = context.propertyPath
          context.propertyPath = `${previousPath ?? 'tuple'}/${index}`
          const result = schemaToPyType(item as OasSchema, context)
          context.propertyPath = previousPath
          return result
        })
        const rest = typeof source.items === 'object' && source.items !== null
          ? schemaToPyType(source.items as OasSchema, context)
          : null
        return withConstraints(schema, { kind: 'tuple', items: tupleItems, rest })
      }
      return withConstraints(schema, { kind: 'list', item: items ?? anyType() })
    },
    allOf: (schema, branches) => allOfType(schema, branches, context),
    oneOf: (schema, branches) => withConstraints(schema, {
      kind: 'union',
      members: branches.length === 0 ? [anyType()] : branches,
      discriminator: asRecord(asRecord(schema).discriminator).propertyName as string | null ?? null,
    }),
    anyOf: (schema, branches) => withConstraints(schema, {
      kind: 'union',
      members: branches.length === 0 ? [anyType()] : branches,
      discriminator: asRecord(asRecord(schema).discriminator).propertyName as string | null ?? null,
    }),
    typeUnion: (schema, branches) => withConstraints(schema, {
      kind: 'union',
      members: branches.filter(branch => !(branch.kind === 'builtin' && branch.name === 'None')),
      discriminator: null,
    }),
  }
}

/** Lowers one schema in isolation. */
export function schemaToPyType(schema: OasSchema, context: PydanticLowerContext): PyTypeExpr {
  unsupportedKeywords(schema, context)
  const source = asRecord(schema)
  if (source.default !== undefined) context.defaultValues?.set(schema as object, source.default)
  if (Array.isArray(source.examples)) context.examples?.set(schema as object, source.examples)
  const nullable = nullableParts(schema)
  const clean = { ...asRecord(nullable.schema) }
  delete clean.default
  delete clean.example
  const previous = context.currentSchema
  context.currentSchema = schema
  let result = foldSchema(clean as OasSchema, createPydanticAlgebra(context))
  context.currentSchema = previous
  if (result.kind === 'literal') result = withConstraints(nullable.schema, result)
  if (nullable.nullable && !(result.kind === 'union'
    && result.members.some(member => member.kind === 'builtin' && member.name === 'None'))) {
    result = { kind: 'union', members: [result, noneType()], discriminator: null }
  }
  return result
}

function openness(schema: OasSchema, context: PydanticLowerContext): PyOpenness {
  const source = asRecord(schema)
  const additional = source.additionalProperties ?? source.unevaluatedProperties
  if (additional === false) return { kind: 'closed' }
  if (asRecord(additional).not !== undefined && JSON.stringify(asRecord(additional).not) === '{}') {
    return { kind: 'closed' }
  }
  if (additional !== undefined && typeof additional === 'object' && additional !== null) {
    return { kind: 'typed-map', value: schemaToPyType(additional as OasSchema, context) }
  }
  return { kind: 'open' }
}

function buildField(
  owner: string,
  wireName: string,
  schema: OasSchema,
  required: boolean,
  context: PydanticLowerContext,
): PyField {
  const previousOwner = context.ownerName
  const previousPath = context.propertyPath
  context.ownerName = owner
  context.propertyPath = wireName
  const nullable = nullableParts(schema)
  const rawType = schemaToPyType(nullable.schema, context)
  context.ownerName = previousOwner
  context.propertyPath = previousPath
  let type: PyTypeExpr = rawType
  if (rawType.kind === 'union' && rawType.members.some(member => member.kind === 'builtin' && member.name === 'None')) {
    const members = rawType.members.filter(member => !(member.kind === 'builtin' && member.name === 'None'))
    type = members.length === 1
      ? members[0]!
      : { kind: 'union', members, discriminator: rawType.discriminator }
  }
  const facts = metadata(schema, context)
  if (required && facts.schemaDefault !== undefined) {
    addDiagnostic(
      context,
      'pydantic/default-on-required',
      'info',
      schema,
      `Default value on required field '${wireName}' is ignored`,
    )
  }
  return {
    wireName,
    attribute: null,
    alias: null,
    type,
    required,
    nullable: nullable.nullable,
    ...(facts.schemaDefault === undefined ? {} : { schemaDefault: facts.schemaDefault as { json: unknown } }),
    default: null,
    rejectExplicitNull: null,
    ...(typeof facts.description === 'string' ? { description: facts.description } : {}),
    ...(typeof facts.deprecated === 'boolean' ? { deprecated: facts.deprecated } : {}),
    ...(Array.isArray(facts.examples) ? { examples: facts.examples } : {}),
    ...(asRecord(facts.extensions).constructor === Object && Object.keys(asRecord(facts.extensions)).length > 0
      ? { extensions: facts.extensions as Record<string, unknown> }
      : {}),
    pointer: schemaPointer(schema, context),
  }
}

function buildModelDecl(
  name: string,
  schema: OasSchema,
  context: PydanticLowerContext,
  origin: 'component' | 'inline',
): PyModelDecl {
  unsupportedKeywords(schema, context)
  const source = asRecord(schema)
  const required = new Set(typeof source.required === 'object' && Array.isArray(source.required)
    ? source.required.filter((item): item is string => typeof item === 'string')
    : [])
  const properties = asRecord(source.properties)
  const fields: PyField[] = []
  for (const [wireName, child] of Object.entries(properties)) {
    fields.push(buildField(name, wireName, child as OasSchema, required.has(wireName), context))
  }
  const bases: string[] = []
  if (Array.isArray(source.allOf)) {
    for (const branch of source.allOf) {
      const branchRecord = asRecord(branch)
      const target = parseRefTarget(branchRecord.$ref)
      if (target !== null && context.modelNames?.has(target)) {
        bases.push(target)
      } else if (branchRecord.properties !== undefined) {
        const branchRequired = new Set(typeof branchRecord.required === 'object' && Array.isArray(branchRecord.required)
          ? branchRecord.required.filter((item): item is string => typeof item === 'string')
          : [])
        for (const [wireName, child] of Object.entries(asRecord(branchRecord.properties))) {
          const isRequired = required.has(wireName) || branchRequired.has(wireName)
          fields.push(buildField(name, wireName, child as OasSchema, isRequired, context))
        }
      } else {
        addDiagnostic(
          context,
          'pydantic/allof-flattened',
          'warning',
          branch,
          'allOf branch was flattened into the model',
        )
      }
    }
  }
  const facts = metadata(schema, context)
  const family = context.analysis.discriminatorFamilies.find(item => (
    item.base === name || item.variants.some(variant => variant.schema === name)
  ))
  const variant = family?.variants.find(item => item.schema === name)
  return {
    kind: 'model',
    name,
    pyName: null,
    origin,
    bases,
    fields,
    openness: openness(schema, context),
    extra: null,
    regexEngine: null,
    ...(family === undefined ? {} : {
      discriminator: {
        propertyName: family.propertyName,
        role: family.base === name ? 'base' : 'variant',
        ...(variant === undefined ? {} : { tag: variant.tag }),
      },
    }),
    ...(typeof facts.description === 'string' ? { description: facts.description } : {}),
    ...(typeof facts.deprecated === 'boolean' ? { deprecated: facts.deprecated } : {}),
    ...(asRecord(facts.extensions).constructor === Object && Object.keys(asRecord(facts.extensions)).length > 0
      ? { extensions: facts.extensions as Record<string, unknown> }
      : {}),
    pointer: schemaPointer(schema, context),
  }
}

function recordPointers(value: unknown, context: PydanticLowerContext, pointer = ''): void {
  if (value === null || typeof value !== 'object') return
  context.pointerOf.set(value, pointer || '/')
  if (Array.isArray(value)) {
    value.forEach((item, index) => recordPointers(item, context, `${pointer}/${index}`))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1')
    recordPointers(child, context, `${pointer}/${escaped}`)
  }
}

function isModelSchema(schema: OasSchema): boolean {
  const source = asRecord(schema)
  return source.properties !== undefined || source.type === 'object' || Array.isArray(source.allOf)
}

/** Lowers `prepared.schemas` in `analysis.order`. */
export function lowerToPyIr(
  prepared: PreparedPydanticDocument,
  analysis: SchemaGraphAnalysis,
  module: string,
): PyModuleIR {
  const names = Object.keys(prepared.schemas)
  const modelNames = new Set(names.filter(name => isModelSchema(prepared.schemas[name]!)))
  const context: PydanticLowerContext = {
    analysis,
    pointerOf: new WeakMap(),
    inlineDecls: [],
    diagnostics: prepared.diagnostics.map(diagnostic => ({ ...diagnostic })),
    defaultValues: new WeakMap(),
    examples: new WeakMap(),
    componentNames: new Set(names),
    modelNames,
    declaredInline: new WeakMap(),
  }
  recordPointers(prepared.document, context)
  const declarations: PyDecl[] = []
  for (const name of analysis.order) {
    const schema = prepared.schemas[name]
    if (schema === undefined) continue
    const source = asRecord(schema)
    let declaration: PyDecl
    if (modelNames.has(name)) {
      declaration = buildModelDecl(name, schema, context, 'component')
    } else {
      const values = literalValues(source.enum)
      if (values !== undefined) {
        declaration = {
          kind: 'enum',
          name,
          pyName: null,
          values,
          repr: null,
          members: null,
          ...metadata(schema, context),
          pointer: schemaPointer(schema, context),
        }
      } else {
        declaration = {
          kind: 'alias',
          name,
          pyName: null,
          origin: 'component',
          type: schemaToPyType(schema, context),
          ...metadata(schema, context),
          pointer: schemaPointer(schema, context),
        }
      }
    }
    declarations.push(...context.inlineDecls.splice(0), declaration)
  }
  return {
    irVersion: 1,
    module,
    decls: declarations,
    rebuild: [...analysis.recursive].sort((left, right) => left.localeCompare(right)),
    imports: null,
    diagnostics: context.diagnostics,
  }
}
