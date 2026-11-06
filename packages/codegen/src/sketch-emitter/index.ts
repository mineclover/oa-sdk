/**
 * @fileoverview Intent-Unit Module: Standard TypeSpec (.tsp) Interface Sketch Multi-Target Emitter
 * @intent INTENT-OA-SKETCH-CODEGEN
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-03
 *
 * Emits JSON Schema 2020-12 (`x-evidence`, `x-oa-sdk-intent`, `x-oa-sdk-derived-from`),
 * OpenAPI 3.1.0, Mermaid classDiagram (`.mmd`), and `not implemented` contract stubs
 * (`sketch_stub.ts` & `sketch_stub.py`) from a standard `.tsp` file or `InterfaceSketchIr`.
 *
 * Every artifact references only what it defines: JSON Schema refs point into `$defs`,
 * OpenAPI refs into `components.schemas`, and a type the sketch does not declare is emitted
 * as an unconstrained schema tagged `x-oa-sdk-sketch-unresolved-type` instead of a dangling
 * `$ref`. Enum members carry their TypeSpec values (`Red: "red"` emits `"red"`), and the
 * Python stub imports on Python 3.10+ whatever the field order (`@dataclass(kw_only=True)`).
 */

import {
  INTERFACE_SKETCH_IR_VERSION,
  parseTypeSpecSketch,
  type InterfaceSketchIr,
  type SketchModelIr,
  type SketchUnionOrEnumIr,
} from '@oa-sdk/surface-ir'
import { parseSketchTypeExpression, type SketchTypeExpression } from './type-expression.js'
import { pythonIdentifier } from '../python-identifier.js'

export type SketchEmittedArtifacts = {
  ir: InterfaceSketchIr
  jsonSchema: Record<string, unknown>
  openApi: Record<string, unknown>
  mermaid: string
  tsStub: string
  pyStub: string
}

type SketchMember = SketchUnionOrEnumIr['members'][number]

const JSON_SCHEMA_REF_PREFIX = '#/$defs/'
const OPENAPI_REF_PREFIX = '#/components/schemas/'
const UNRESOLVED_TYPE_EXTENSION = 'x-oa-sdk-sketch-unresolved-type'

export const INTERFACE_SKETCH_IR_V1_VERSION = 'oa-sdk.interface-sketch-ir.v1' as const

/**
 * An Interface Sketch IR written by an earlier release (`oa-sdk.interface-sketch-ir.v1`, for
 * example saved `oa-gen sketch verify --format json` output): unions and enums list only their
 * member names (`variants`), and there are no `diagnostics`.
 */
export type InterfaceSketchIrV1 = Omit<InterfaceSketchIr, 'schemaVersion' | 'unionsAndEnums' | 'diagnostics'> & {
  schemaVersion: typeof INTERFACE_SKETCH_IR_V1_VERSION
  unionsAndEnums: Array<Omit<SketchUnionOrEnumIr, 'members'>>
}

/**
 * Emits all Phase B/C/D contract artifacts from a standard `.tsp` source string
 * or pre-parsed `InterfaceSketchIr` (`IUD-02`, `IUD-05`, `IUD-07`).
 *
 * A pre-parsed IR of the current schema is used as is. A v1 IR is upgraded first: each
 * union or enum member becomes `{ name }` (v1 kept no member values, so an enum emits its
 * member names) and `diagnostics` is empty; `versionHash` stays the producer's. Any other
 * `schemaVersion` throws.
 */
export function emitSketchArtifacts(
  sourceOrIr: string | InterfaceSketchIr | InterfaceSketchIrV1,
  specName = 'domain',
): SketchEmittedArtifacts {
  const ir =
    typeof sourceOrIr === 'string' ? parseTypeSpecSketch(sourceOrIr, specName) : upgradeSketchIr(sourceOrIr)

  return {
    ir,
    jsonSchema: buildJsonSchemaFromSketchIr(ir),
    openApi: buildOpenApiFromSketchIr(ir),
    mermaid: buildMermaidFromSketchIr(ir),
    tsStub: buildTypeScriptStubFromSketchIr(ir),
    pyStub: buildPythonStubFromSketchIr(ir),
  }
}

function upgradeSketchIr(ir: InterfaceSketchIr | InterfaceSketchIrV1): InterfaceSketchIr {
  // A pre-parsed IR often comes from JSON, so its type does not guarantee its version.
  const schemaVersion: unknown = ir.schemaVersion
  if (ir.schemaVersion === INTERFACE_SKETCH_IR_VERSION) return ir
  if (ir.schemaVersion === INTERFACE_SKETCH_IR_V1_VERSION) {
    return {
      ...ir,
      schemaVersion: INTERFACE_SKETCH_IR_VERSION,
      unionsAndEnums: ir.unionsAndEnums.map(union => ({
        ...union,
        members: union.variants.map(name => ({ name })),
      })),
      diagnostics: [],
    }
  }
  throw new Error(
    `Unsupported Interface Sketch IR schemaVersion ${JSON.stringify(schemaVersion)} `
      + `(expected ${INTERFACE_SKETCH_IR_VERSION} or ${INTERFACE_SKETCH_IR_V1_VERSION}).`,
  )
}

export function buildJsonSchemaFromSketchIr(ir: InterfaceSketchIr): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `urn:oa-sdk:sketch:${ir.specName}`,
    title: ir.namespace ?? ir.specName,
    'x-oa-sdk-profile': ir.profile,
    'x-oa-sdk-depth': ir.depthMetrics,
    $defs: buildSketchSchemaDefs(ir, JSON_SCHEMA_REF_PREFIX),
  }
}

export function buildOpenApiFromSketchIr(ir: InterfaceSketchIr): Record<string, unknown> {
  const paths: Record<string, unknown> = {}

  for (const iface of ir.interfaces) {
    for (const op of iface.operations) {
      paths[`/${iface.name}/${op.name}`] = {
        post: {
          operationId: `${iface.name}_${op.name}`,
          ...(op.doc ? { summary: op.doc } : {}),
          ...(op.evidence.length > 0 ? { 'x-evidence': { requirements: op.evidence } } : {}),
          ...(op.intent ? { 'x-oa-sdk-intent': op.intent } : {}),
          responses: {
            '200': {
              description: `${op.returnType} result`,
            },
          },
        },
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: ir.namespace ?? ir.specName,
      version: '1.0.0',
    },
    paths,
    components: {
      schemas: buildSketchSchemaDefs(ir, OPENAPI_REF_PREFIX),
    },
  }
}

export function buildMermaidFromSketchIr(ir: InterfaceSketchIr): string {
  const lines: string[] = ['classDiagram']

  for (const model of ir.models) {
    const generics = model.templateParameters?.length ? `~${model.templateParameters.join(', ')}~` : ''
    lines.push(`  class ${model.name}${generics} {`)
    for (const field of model.fields) {
      lines.push(`    +${toMermaidType(field.typeName)} ${field.name}${field.optional ? '?' : ''}`)
    }
    lines.push('  }')
    if (model.baseModel) {
      lines.push(`  ${referenceName(model.baseModel)} <|-- ${model.name} : @derivedFrom`)
    }
  }

  for (const iface of ir.interfaces) {
    lines.push(`  class ${iface.name} {`)
    lines.push('    <<interface>>')
    for (const op of iface.operations) {
      const paramSig = op.params.map(p => `${p.name}: ${toMermaidType(p.typeName)}`).join(', ')
      lines.push(`    +${op.name}(${paramSig}) ${toMermaidType(op.returnType)}`)
    }
    lines.push('  }')
  }

  return lines.join('\n') + '\n'
}

export function buildTypeScriptStubFromSketchIr(ir: InterfaceSketchIr): string {
  const lines: string[] = [
    `/**`,
    ` * Auto-generated by @oa-sdk/codegen (emitSketchArtifacts) from ${ir.specName}.tsp`,
    ` * Profile: ${ir.profile} | Interface Depth: ${ir.depthMetrics.interfaceDepth}`,
    ` */`,
    ``,
  ]

  for (const u of ir.unionsAndEnums) {
    const unionExpr = u.members.map(member => memberToTs(u.kind, member)).join(' | ') || 'never'
    lines.push(`export type ${u.name} = ${unionExpr};`)
    lines.push(``)
  }

  for (const model of ir.models) {
    if (model.doc || model.intent || model.derivedFrom) {
      lines.push(`/**`)
      if (model.doc) lines.push(` * ${model.doc}`)
      if (model.intent) lines.push(` * @intent ${model.intent.intentId}`)
      if (model.derivedFrom) {
        lines.push(` * @derivedFrom ${model.derivedFrom.baseSymbol} — ${model.derivedFrom.reason}`)
      }
      lines.push(` */`)
    }
    const generics = model.templateParameters?.length ? `<${model.templateParameters.join(', ')}>` : ''
    const ext = model.baseModel ? ` extends ${tsType(model.baseModel)}` : ''
    lines.push(`export interface ${model.name}${generics}${ext} {`)
    for (const field of model.fields) {
      lines.push(`  ${tsPropertyName(field.name)}${field.optional ? '?' : ''}: ${tsType(field.typeName)};`)
    }
    lines.push(`}`)
    lines.push(``)
  }

  for (const iface of ir.interfaces) {
    lines.push(`export interface ${iface.name} {`)
    for (const op of iface.operations) {
      lines.push(`  ${op.name}(${tsParameters(op.params, '')}): ${tsType(op.returnType)};`)
    }
    lines.push(`}`)
    lines.push(``)
    lines.push(`export class ${iface.name}Stub implements ${iface.name} {`)
    for (const op of iface.operations) {
      lines.push(`  ${op.name}(${tsParameters(op.params, '_')}): ${tsType(op.returnType)} {`)
      lines.push(`    throw new Error("not implemented");`)
      lines.push(`  }`)
    }
    lines.push(`}`)
    lines.push(``)
  }

  return lines.join('\n')
}

/**
 * Python 3.10+ stub. Models are `@dataclass(kw_only=True)` so a required field may follow an
 * optional one (in the model or in its base); bases are emitted before the models that derive
 * from them; Protocol methods put parameters after the first optional one behind `*`.
 */
export function buildPythonStubFromSketchIr(ir: InterfaceSketchIr): string {
  const typeVariables = [...new Set(ir.models.flatMap(model => model.templateParameters ?? []))]
  const lines: string[] = [
    `"""`,
    `Auto-generated by @oa-sdk/codegen (emitSketchArtifacts) from ${ir.specName}.tsp`,
    `Profile: ${ir.profile} | Interface Depth: ${ir.depthMetrics.interfaceDepth}`,
    `"""`,
    `from __future__ import annotations`,
    `from dataclasses import dataclass`,
    `from typing import Any, Generic, Literal, Optional, Protocol, TypeVar, Union`,
    ``,
  ]
  for (const name of typeVariables) lines.push(`${name} = TypeVar(${JSON.stringify(name)})`)
  if (typeVariables.length > 0) lines.push(``)

  for (const u of ir.unionsAndEnums) {
    lines.push(`${u.name} = ${pythonUnionAlias(u)}`)
    lines.push(``)
  }

  const declaredModels = new Set(ir.models.map(model => model.name))
  for (const model of orderModelsByBase(ir.models)) {
    const bases: string[] = []
    if (model.baseModel) {
      const baseName = referenceName(model.baseModel)
      if (declaredModels.has(baseName)) bases.push(pythonRuntimeBase(model.baseModel))
    }
    if (model.templateParameters?.length) bases.push(`Generic[${model.templateParameters.join(', ')}]`)
    lines.push(`@dataclass(kw_only=True)`)
    lines.push(`class ${model.name}${bases.length > 0 ? `(${bases.join(', ')})` : ''}:`)
    if (model.baseModel && !declaredModels.has(referenceName(model.baseModel))) {
      lines.push(`    # derives from ${model.baseModel}, which this sketch does not declare`)
    }
    if (model.fields.length === 0) {
      lines.push(`    pass`)
    } else {
      for (const field of model.fields) {
        const pyType = pyAnnotation(field.typeName)
        lines.push(
          `    ${pythonIdentifier(field.name)}: ${field.optional ? `Optional[${pyType}] = None` : pyType}`,
        )
      }
    }
    lines.push(``)
  }

  for (const iface of ir.interfaces) {
    lines.push(`class ${iface.name}(Protocol):`)
    if (iface.operations.length === 0) {
      lines.push(`    pass`)
    } else {
      for (const op of iface.operations) {
        const snakeName = pythonIdentifier(op.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase())
        lines.push(`    def ${snakeName}(${pythonParameters(op.params).join(', ')}) -> ${pyAnnotation(op.returnType)}:`)
        lines.push(`        raise NotImplementedError("not implemented")`)
      }
    }
    lines.push(``)
  }

  return lines.join('\n')
}

// ─── JSON Schema / OpenAPI ───────────────────────────────────────────────────

/**
 * Builds one schema per model, union and enum. References to other declarations use
 * `refPrefix` (`#/$defs/` in JSON Schema, `#/components/schemas/` in OpenAPI).
 */
function buildSketchSchemaDefs(ir: InterfaceSketchIr, refPrefix: string): Record<string, unknown> {
  const defs: Record<string, unknown> = {}
  const context = createSchemaContext(ir, refPrefix)

  for (const u of ir.unionsAndEnums) {
    defs[u.name] = {
      ...unionOrEnumSchema(u, context),
      ...(u.doc ? { description: u.doc } : {}),
      ...(u.evidence.length > 0 ? { 'x-evidence': { requirements: u.evidence } } : {}),
    }
  }

  for (const model of ir.models) {
    const typeParameters = new Set(model.templateParameters ?? [])
    const fields = resolveInheritedFields(model, context.models)
    defs[model.name] = {
      ...objectSchema(
        fields.map(field => ({
          name: field.name,
          optional: field.optional,
          schema: {
            ...typeSchema(parseSketchTypeExpression(field.typeName), context, typeParameters),
            ...(field.doc ? { description: field.doc } : {}),
            ...(field.evidence.length > 0 ? { 'x-evidence': { requirements: field.evidence } } : {}),
          },
        })),
      ),
      ...(model.doc ? { description: model.doc } : {}),
      ...(model.evidence.length > 0
        ? {
            'x-evidence': { requirements: model.evidence },
            'x-oa-sdk-evidence': { requirements: model.evidence },
          }
        : {}),
      ...(model.intent ? { 'x-oa-sdk-intent': model.intent } : {}),
      ...(model.derivedFrom ? { 'x-oa-sdk-derived-from': model.derivedFrom } : {}),
    }
  }

  return defs
}

type SchemaContext = {
  refPrefix: string
  models: ReadonlyMap<string, SketchModelIr>
  unions: ReadonlySet<string>
  /** Template instances being expanded, to stop recursive instantiation */
  expanding: readonly string[]
}

function createSchemaContext(ir: InterfaceSketchIr, refPrefix: string): SchemaContext {
  return {
    refPrefix,
    models: new Map(ir.models.map(model => [model.name, model])),
    unions: new Set(ir.unionsAndEnums.map(u => u.name)),
    expanding: [],
  }
}

function objectSchema(
  properties: ReadonlyArray<{ name: string; optional: boolean; schema: Record<string, unknown> }>,
): Record<string, unknown> {
  const required = properties.filter(property => !property.optional).map(property => property.name)
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(properties.map(property => [property.name, property.schema])),
    ...(required.length > 0 ? { required } : {}),
  }
}

const SCALAR_SCHEMAS: Readonly<Record<string, Record<string, unknown>>> = {
  string: { type: 'string' },
  url: { type: 'string' },
  utcDateTime: { type: 'string' },
  offsetDateTime: { type: 'string' },
  plainDate: { type: 'string' },
  plainTime: { type: 'string' },
  duration: { type: 'string' },
  bytes: { type: 'string' },
  int8: { type: 'integer' },
  int16: { type: 'integer' },
  int32: { type: 'integer' },
  int64: { type: 'integer' },
  uint8: { type: 'integer' },
  uint16: { type: 'integer' },
  uint32: { type: 'integer' },
  uint64: { type: 'integer' },
  integer: { type: 'integer' },
  safeint: { type: 'integer' },
  float: { type: 'number' },
  float32: { type: 'number' },
  float64: { type: 'number' },
  decimal: { type: 'number' },
  decimal128: { type: 'number' },
  numeric: { type: 'number' },
  number: { type: 'number' },
  boolean: { type: 'boolean' },
  null: { type: 'null' },
  unknown: {},
}

function typeSchema(
  expression: SketchTypeExpression,
  context: SchemaContext,
  typeParameters: ReadonlySet<string>,
): Record<string, unknown> {
  switch (expression.kind) {
    case 'string':
      return { type: 'string', const: expression.value }
    case 'number':
      return { type: Number.isInteger(expression.value) ? 'integer' : 'number', const: expression.value }
    case 'boolean':
      return { type: 'boolean', const: expression.value }
    case 'array':
      return { type: 'array', items: typeSchema(expression.element, context, typeParameters) }
    case 'tuple':
      return {
        type: 'array',
        prefixItems: expression.items.map(item => typeSchema(item, context, typeParameters)),
        minItems: expression.items.length,
        maxItems: expression.items.length,
      }
    case 'union':
      return literalEnumSchema(expression.options) ?? {
        anyOf: expression.options.map(option => typeSchema(option, context, typeParameters)),
      }
    case 'object':
      return objectSchema(
        expression.properties.map(property => ({
          name: property.name,
          optional: property.optional,
          schema: typeSchema(property.type, context, typeParameters),
        })),
      )
    case 'opaque':
      return { [UNRESOLVED_TYPE_EXTENSION]: expression.text }
    case 'reference':
      return referenceSchema(expression, context, typeParameters)
  }
}

function referenceSchema(
  expression: Extract<SketchTypeExpression, { kind: 'reference' }>,
  context: SchemaContext,
  typeParameters: ReadonlySet<string>,
): Record<string, unknown> {
  const { name, args } = expression
  if (typeParameters.has(name)) return {}
  const scalar = SCALAR_SCHEMAS[name]
  if (scalar && args.length === 0) return { ...scalar }
  if ((name === 'Record' || name === 'TypeSpec.Record') && args.length === 1 && args[0]) {
    return { type: 'object', additionalProperties: typeSchema(args[0], context, typeParameters) }
  }
  if ((name === 'Array' || name === 'TypeSpec.Array') && args.length === 1 && args[0]) {
    return { type: 'array', items: typeSchema(args[0], context, typeParameters) }
  }
  if (context.unions.has(name) && args.length === 0) return { $ref: `${context.refPrefix}${name}` }
  const model = context.models.get(name)
  if (model) {
    const templateParameters = model.templateParameters ?? []
    if (templateParameters.length === 0 && args.length === 0) return { $ref: `${context.refPrefix}${name}` }
    // A template instance (`Page<User>`) has no definition of its own: expand it in place.
    const instance = renderTypeText(expression)
    if (context.expanding.includes(instance)) return { [UNRESOLVED_TYPE_EXTENSION]: instance }
    const bindings = new Map<string, SketchTypeExpression>()
    templateParameters.forEach((parameter, index) => {
      const arg = args[index]
      if (arg) bindings.set(parameter, arg)
    })
    const nested: SchemaContext = { ...context, expanding: [...context.expanding, instance] }
    return objectSchema(
      resolveInheritedFields(model, context.models).map(field => ({
        name: field.name,
        optional: field.optional,
        schema: typeSchema(substitute(parseSketchTypeExpression(field.typeName), bindings), nested, typeParameters),
      })),
    )
  }
  return { [UNRESOLVED_TYPE_EXTENSION]: renderTypeText(expression) }
}

function unionOrEnumSchema(u: SketchUnionOrEnumIr, context: SchemaContext): Record<string, unknown> {
  if (u.kind === 'enum') {
    return literalSchema(u.members.map(enumMemberValue)) ?? { enum: [] }
  }
  const options = u.members.map(unionMemberExpression)
  return literalEnumSchema(options) ?? { anyOf: options.map(option => typeSchema(option, context, new Set())) }
}

/** `{ type, enum }` when every option is a literal of one JSON type, `{ enum }` for mixed literals. */
function literalEnumSchema(options: readonly SketchTypeExpression[]): Record<string, unknown> | undefined {
  const values: Array<string | number | boolean> = []
  for (const option of options) {
    if (option.kind !== 'string' && option.kind !== 'number' && option.kind !== 'boolean') return undefined
    values.push(option.value)
  }
  return literalSchema(values)
}

function literalSchema(values: ReadonlyArray<string | number | boolean>): Record<string, unknown> | undefined {
  if (values.length === 0) return undefined
  if (values.every(value => typeof value === 'string')) return { type: 'string', enum: [...values] }
  if (values.every(value => typeof value === 'number')) {
    return { type: values.every(value => Number.isInteger(value)) ? 'integer' : 'number', enum: [...values] }
  }
  if (values.every(value => typeof value === 'boolean')) return { type: 'boolean', enum: [...values] }
  return { enum: [...values] }
}

/** An enum member's wire value: its `"string"` or numeric value, or its name when it has none. */
function enumMemberValue(member: SketchMember): string | number {
  if (member.value === undefined) return unquote(member.name)
  const expression = parseSketchTypeExpression(member.value)
  if (expression.kind === 'string' || expression.kind === 'number') return expression.value
  return member.value
}

/** A union variant's type: the text after `name:`, or the whole variant when it is unnamed. */
function unionMemberExpression(member: SketchMember): SketchTypeExpression {
  return parseSketchTypeExpression(member.value ?? member.name)
}

function resolveInheritedFields(
  model: SketchModelIr,
  modelMap: ReadonlyMap<string, SketchModelIr>,
  visiting: readonly string[] = [],
): SketchModelIr['fields'] {
  if (!model.baseModel) return model.fields
  const base = parseSketchTypeExpression(model.baseModel)
  const parent = base.kind === 'reference' ? modelMap.get(base.name) : undefined
  if (!parent || visiting.includes(parent.name)) return model.fields
  const bindings = new Map<string, SketchTypeExpression>()
  if (base.kind === 'reference') {
    ;(parent.templateParameters ?? []).forEach((parameter, index) => {
      const arg = base.args[index]
      if (arg) bindings.set(parameter, arg)
    })
  }
  const parentFields = resolveInheritedFields(parent, modelMap, [...visiting, model.name]).map(field =>
    bindings.size === 0
      ? field
      : { ...field, typeName: renderTypeText(substitute(parseSketchTypeExpression(field.typeName), bindings)) },
  )
  const overridden = new Set(model.fields.map(f => f.name))
  return [...parentFields.filter(f => !overridden.has(f.name)), ...model.fields]
}

function substitute(
  expression: SketchTypeExpression,
  bindings: ReadonlyMap<string, SketchTypeExpression>,
): SketchTypeExpression {
  if (bindings.size === 0) return expression
  switch (expression.kind) {
    case 'reference':
      if (expression.args.length === 0) {
        const bound = bindings.get(expression.name)
        if (bound) return bound
      }
      return { ...expression, args: expression.args.map(arg => substitute(arg, bindings)) }
    case 'array':
      return { kind: 'array', element: substitute(expression.element, bindings) }
    case 'union':
      return { kind: 'union', options: expression.options.map(option => substitute(option, bindings)) }
    case 'tuple':
      return { kind: 'tuple', items: expression.items.map(item => substitute(item, bindings)) }
    case 'object':
      return {
        kind: 'object',
        properties: expression.properties.map(property => ({ ...property, type: substitute(property.type, bindings) })),
      }
    default:
      return expression
  }
}

/** TypeSpec text of an expression (used for labels and for substituted inherited fields). */
function renderTypeText(expression: SketchTypeExpression): string {
  switch (expression.kind) {
    case 'reference':
      return expression.args.length > 0
        ? `${expression.name}<${expression.args.map(renderTypeText).join(', ')}>`
        : expression.name
    case 'array':
      return `${wrapUnion(expression.element, renderTypeText)}[]`
    case 'union':
      return expression.options.map(renderTypeText).join(' | ')
    case 'tuple':
      return `[${expression.items.map(renderTypeText).join(', ')}]`
    case 'string':
      return JSON.stringify(expression.value)
    case 'number':
    case 'boolean':
      return String(expression.value)
    case 'object':
      return `{ ${expression.properties.map(p => `${p.name}${p.optional ? '?' : ''}: ${renderTypeText(p.type)}`).join('; ')} }`
    case 'opaque':
      return expression.text
  }
}

function wrapUnion(expression: SketchTypeExpression, render: (expression: SketchTypeExpression) => string): string {
  return expression.kind === 'union' ? `(${render(expression)})` : render(expression)
}

// ─── TypeScript ──────────────────────────────────────────────────────────────

const TS_SCALARS: Readonly<Record<string, string>> = {
  string: 'string',
  url: 'string',
  utcDateTime: 'string',
  offsetDateTime: 'string',
  plainDate: 'string',
  plainTime: 'string',
  duration: 'string',
  bytes: 'Uint8Array',
  int8: 'number',
  int16: 'number',
  int32: 'number',
  int64: 'number',
  uint8: 'number',
  uint16: 'number',
  uint32: 'number',
  uint64: 'number',
  integer: 'number',
  safeint: 'number',
  float: 'number',
  float32: 'number',
  float64: 'number',
  decimal: 'number',
  decimal128: 'number',
  numeric: 'number',
  number: 'number',
  boolean: 'boolean',
  void: 'void',
  null: 'null',
  unknown: 'unknown',
  never: 'never',
}

function tsType(typeName: string): string {
  return renderTs(parseSketchTypeExpression(typeName))
}

function renderTs(expression: SketchTypeExpression): string {
  switch (expression.kind) {
    case 'reference': {
      const scalar = TS_SCALARS[expression.name]
      if (scalar && expression.args.length === 0) return scalar
      if (expression.name === 'Record' && expression.args.length === 1 && expression.args[0]) {
        return `Record<string, ${renderTs(expression.args[0])}>`
      }
      return expression.args.length > 0
        ? `${expression.name}<${expression.args.map(renderTs).join(', ')}>`
        : expression.name
    }
    case 'array':
      return `${wrapUnion(expression.element, renderTs)}[]`
    case 'union':
      return expression.options.map(renderTs).join(' | ')
    case 'tuple':
      return `[${expression.items.map(renderTs).join(', ')}]`
    case 'string':
      return JSON.stringify(expression.value)
    case 'number':
    case 'boolean':
      return String(expression.value)
    case 'object':
      return `{ ${expression.properties.map(p => `${tsPropertyName(p.name)}${p.optional ? '?' : ''}: ${renderTs(p.type)}`).join('; ')} }`
    case 'opaque':
      return `unknown /* ${expression.text.replaceAll('*/', '* /')} */`
  }
}

function memberToTs(kind: SketchUnionOrEnumIr['kind'], member: SketchMember): string {
  if (kind === 'enum') {
    const value = enumMemberValue(member)
    return typeof value === 'number' ? String(value) : JSON.stringify(value)
  }
  return renderTs(unionMemberExpression(member))
}

type SketchParam = InterfaceSketchIr['interfaces'][number]['operations'][number]['params'][number]

/**
 * TypeSpec parameters are named, so an optional one may precede a required one. TypeScript
 * parameters are positional: an optional parameter followed by a required one is written
 * `name: T | undefined` to keep the order valid.
 */
function tsParameters(params: readonly SketchParam[], prefix: string): string {
  return params
    .map((param, index) => {
      const type = tsType(param.typeName)
      if (!param.optional) return `${prefix}${param.name}: ${type}`
      const requiredFollows = params.slice(index + 1).some(next => !next.optional)
      return requiredFollows ? `${prefix}${param.name}: ${type} | undefined` : `${prefix}${param.name}?: ${type}`
    })
    .join(', ')
}

function tsPropertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

// ─── Python ──────────────────────────────────────────────────────────────────

const PY_SCALARS: Readonly<Record<string, string>> = {
  string: 'str',
  url: 'str',
  utcDateTime: 'str',
  offsetDateTime: 'str',
  plainDate: 'str',
  plainTime: 'str',
  duration: 'str',
  bytes: 'bytes',
  int8: 'int',
  int16: 'int',
  int32: 'int',
  int64: 'int',
  uint8: 'int',
  uint16: 'int',
  uint32: 'int',
  uint64: 'int',
  integer: 'int',
  safeint: 'int',
  float: 'float',
  float32: 'float',
  float64: 'float',
  decimal: 'float',
  decimal128: 'float',
  numeric: 'float',
  number: 'float',
  boolean: 'bool',
  void: 'None',
  null: 'None',
  unknown: 'Any',
  never: 'Any',
}

/** A Python annotation (evaluated lazily under `from __future__ import annotations`). */
function pyAnnotation(typeName: string): string {
  return renderPy(parseSketchTypeExpression(typeName))
}

function renderPy(expression: SketchTypeExpression): string {
  switch (expression.kind) {
    case 'reference': {
      const scalar = PY_SCALARS[expression.name]
      if (scalar && expression.args.length === 0) return scalar
      if (expression.name === 'Record' && expression.args.length === 1 && expression.args[0]) {
        return `dict[str, ${renderPy(expression.args[0])}]`
      }
      if (expression.name === 'Array' && expression.args.length === 1 && expression.args[0]) {
        return `list[${renderPy(expression.args[0])}]`
      }
      const name = expression.name.replaceAll('.', '_')
      return expression.args.length > 0 ? `${name}[${expression.args.map(renderPy).join(', ')}]` : name
    }
    case 'array':
      return `list[${renderPy(expression.element)}]`
    case 'union': {
      const literals = literalValues(expression.options)
      return literals ? `Literal[${literals.join(', ')}]` : expression.options.map(renderPy).join(' | ')
    }
    case 'tuple':
      return `tuple[${expression.items.map(renderPy).join(', ')}]`
    case 'string':
    case 'number':
    case 'boolean':
      return `Literal[${pyLiteral(expression.value)}]`
    case 'object':
      return 'dict[str, Any]'
    case 'opaque':
      return 'Any'
  }
}

/**
 * A module-level alias, evaluated at import time: literals become one `Literal[...]`, type
 * members become string forward references inside `Union[...]` so declaration order never
 * raises `NameError`.
 */
function pythonUnionAlias(u: SketchUnionOrEnumIr): string {
  if (u.kind === 'enum') {
    return u.members.length > 0 ? `Literal[${u.members.map(member => pyLiteral(enumMemberValue(member))).join(', ')}]` : 'Any'
  }
  const options = u.members.map(unionMemberExpression)
  const literals = literalValues(options)
  if (literals) return `Literal[${literals.join(', ')}]`
  if (options.length === 0) return 'Any'
  const parts: string[] = []
  const pending: string[] = []
  for (const option of options) {
    if (option.kind === 'string' || option.kind === 'number' || option.kind === 'boolean') {
      pending.push(pyLiteral(option.value))
    } else {
      parts.push(JSON.stringify(renderPy(option)))
    }
  }
  if (pending.length > 0) parts.push(`Literal[${pending.join(', ')}]`)
  return `Union[${parts.join(', ')}]`
}

function literalValues(options: readonly SketchTypeExpression[]): string[] | undefined {
  const values: string[] = []
  for (const option of options) {
    if (option.kind !== 'string' && option.kind !== 'number' && option.kind !== 'boolean') return undefined
    values.push(pyLiteral(option.value))
  }
  return values.length > 0 ? values : undefined
}

function pyLiteral(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return typeof value === 'number' ? String(value) : JSON.stringify(value)
}

/** `Page<User>` as a runtime base class: `Page["User"]` (a forward reference needs no ordering). */
function pythonRuntimeBase(baseModel: string): string {
  const base = parseSketchTypeExpression(baseModel)
  if (base.kind !== 'reference' || base.args.length === 0) return referenceName(baseModel)
  return `${base.name}[${base.args.map(arg => JSON.stringify(renderPy(arg))).join(', ')}]`
}

function pythonParameters(params: readonly SketchParam[]): string[] {
  const rendered = ['self']
  const firstOptional = params.findIndex(param => param.optional)
  const requiredAfterOptional = firstOptional >= 0 && params.slice(firstOptional).some(param => !param.optional)
  params.forEach((param, index) => {
    if (requiredAfterOptional && index === firstOptional) rendered.push('*')
    const annotation = pyAnnotation(param.typeName)
    rendered.push(
      `${pythonIdentifier(param.name)}: ${param.optional ? `Optional[${annotation}] = None` : annotation}`,
    )
  })
  return rendered
}

/** Models whose sketch-declared base precedes them, otherwise in source order. */
function orderModelsByBase(models: readonly SketchModelIr[]): SketchModelIr[] {
  const byName = new Map(models.map(model => [model.name, model]))
  const ordered: SketchModelIr[] = []
  const placed = new Set<string>()
  const place = (model: SketchModelIr, visiting: readonly string[]): void => {
    if (placed.has(model.name) || visiting.includes(model.name)) return
    const base = model.baseModel ? byName.get(referenceName(model.baseModel)) : undefined
    if (base) place(base, [...visiting, model.name])
    placed.add(model.name)
    ordered.push(model)
  }
  for (const model of models) place(model, [])
  return ordered
}

// ─── shared ──────────────────────────────────────────────────────────────────

/** `Page<User>` -> `Page`. */
function referenceName(typeName: string): string {
  const expression = parseSketchTypeExpression(typeName)
  return expression.kind === 'reference' ? expression.name : typeName.trim()
}

/** Mermaid member text: generics as `~T~`, anonymous models as `object`. */
function toMermaidType(typeName: string): string {
  const render = (expression: SketchTypeExpression): string => {
    switch (expression.kind) {
      case 'reference':
        return expression.args.length > 0 ? `${expression.name}~${expression.args.map(render).join(', ')}~` : expression.name
      case 'array':
        return `${wrapUnion(expression.element, render)}[]`
      case 'union':
        return expression.options.map(render).join(' | ')
      case 'tuple':
        return `[${expression.items.map(render).join(', ')}]`
      case 'object':
        return 'object'
      case 'string':
        return JSON.stringify(expression.value)
      case 'number':
      case 'boolean':
        return String(expression.value)
      case 'opaque':
        return expression.text.replace(/[{}]/g, '')
    }
  }
  return render(parseSketchTypeExpression(typeName))
}

function unquote(text: string): string {
  const expression = parseSketchTypeExpression(text)
  return expression.kind === 'string' ? expression.value : text
}
