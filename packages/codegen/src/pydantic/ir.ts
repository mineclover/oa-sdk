/**
 * Python module IR — the data that flows from S3 (lower) through S4 (passes) to S5 (render).
 *
 * Rules:
 * - Plain JSON data only (no class instances, Maps, functions, `undefined` inside arrays).
 *   `JSON.parse(JSON.stringify(ir))` must deep-equal `ir`.
 * - S3 records facts about the schema. Every slot typed `... | null` is a decision that a named
 *   S4 pass fills in; S3 always writes `null` there. `assertResolvedPyIr` checks that every slot is
 *   filled before rendering.
 * - Component and inline declarations are keyed by `name` (the wire-side key). Python identifiers
 *   live only in `pyName`/`attribute`/`alias`, set by the `naming` pass.
 */

export type PyLiteralValue = string | number | boolean | null

/**
 * A numeric bound. Integers outside `Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER`
 * (e.g. the `int64`/`uint64` format limits) are kept exactly as a decimal string.
 */
export type PyBound = number | { integer: string }

export interface PyConstraints {
  minLength?: number
  maxLength?: number
  ge?: PyBound
  le?: PyBound
  gt?: PyBound
  lt?: PyBound
  multipleOf?: number
  /** `source` is the schema's ECMA-262 pattern (fact). `python` is the pattern Pydantic receives (`regex` pass). */
  pattern?: { source: string; python: string | null }
  /** Rendered as an `AfterValidator` that rejects duplicates (lists keep order). */
  uniqueItems?: boolean
}

/** A string/integer/number with its schema `format`/`contentEncoding`, before `scalarPolicy` picks the Python type. */
export interface PyScalarFact {
  kind: 'scalar'
  base: 'string' | 'integer' | 'number'
  format?: string
  contentEncoding?: string
  /** JSON Pointer of the scalar's schema, for diagnostics about how it is mapped. */
  pointer?: string
}

export type PyTypeExpr =
  | PyScalarFact
  /** A decoded semantic value with an explicit wire representation and serializer policy. */
  | {
    kind: 'decoded'
    wireType: 'int' | 'str'
    pythonType: PyTypeExpr
    encoding: 'unixtime' | 'http-date'
    datetimeMode?: 'aware' | 'naive'
  }
  | { kind: 'builtin'; name: 'str' | 'int' | 'float' | 'bool' | 'None' | 'Any' | 'bytes' }
  /**
   * Imported name, e.g. `{ module: 'datetime', name: 'datetime' }`,
   * `{ module: 'pydantic', name: 'AwareDatetime' }`.
   */
  | { kind: 'named'; module: 'datetime' | 'uuid' | 'decimal' | 'pydantic'; name: string }
  /** Reference to a declaration of this module by its `name`. */
  | { kind: 'ref'; target: string }
  | { kind: 'list'; item: PyTypeExpr }
  | { kind: 'tuple'; items: PyTypeExpr[]; rest: PyTypeExpr | null }
  | { kind: 'dict'; value: PyTypeExpr }
  | { kind: 'literal'; values: PyLiteralValue[] }
  /** `discriminator` is set only for tagged unions (property name on every member). */
  | { kind: 'union'; members: PyTypeExpr[]; discriminator: string | null }
  /**
   * Constraints in a nested position render as `Annotated[base, Field(...)]`;
   * on a field they render inside the field's `Field(...)`.
   */
  | { kind: 'constrained'; base: PyTypeExpr; constraints: PyConstraints }

/** How a field's default is rendered (`optionalPolicy` pass). */
export type PyDefault =
  | { kind: 'required' }
  | { kind: 'none' }
  | { kind: 'value'; json: unknown }

export interface PyField {
  wireName: string
  /** Python attribute name (`naming` pass). */
  attribute: string | null
  /** `Field(alias=...)`; the empty string means "no alias" (`naming` pass). */
  alias: string | null
  /** Type without the top-level `null`; top-level nullability is `nullable`. */
  type: PyTypeExpr
  /** Fact: listed in the schema's `required`. */
  required: boolean
  /** Fact: the schema allows `null` at the top level. */
  nullable: boolean
  /** Fact: the schema's `default`, if any. */
  schemaDefault?: { json: unknown }
  /** Decision (`optionalPolicy`). */
  default: PyDefault | null
  /** Decision (`optionalPolicy`): generate a validator rejecting an explicit `null`. */
  rejectExplicitNull: boolean | null
  description?: string
  deprecated?: boolean
  examples?: unknown[]
  /** `x-*` keys of the property schema, preserved verbatim (`json_schema_extra`). */
  extensions?: Record<string, unknown>
  /** JSON Pointer of the property schema in the prepared document. */
  pointer: string
}

/** Fact: what the schema says about properties it does not declare. */
export type PyOpenness =
  | { kind: 'open' }
  | { kind: 'closed' }
  | { kind: 'typed-map'; value: PyTypeExpr }

export interface PyModelDecl {
  kind: 'model'
  name: string
  pyName: string | null
  origin: 'component' | 'inline'
  /** Names of base model declarations (`allOf` `$ref` branches), in schema order. */
  bases: string[]
  fields: PyField[]
  openness: PyOpenness
  /** Decision (`extraPolicy`). */
  extra: 'ignore' | 'allow' | 'forbid' | null
  /** Decision (`regex` pass). */
  regexEngine: 'rust-regex' | 'python-re' | null
  /** Decision (`frozen` pass). */
  frozen?: boolean | null
  /** Set when this model belongs to a discriminator family (fact from S2). */
  discriminator?: { propertyName: string; role: 'base' | 'variant'; tag?: string }
  description?: string
  deprecated?: boolean
  extensions?: Record<string, unknown>
  pointer: string
  /** Set for inline declarations owned by an operation. */
  operationOwner?: string
  operationRole?: PyOperationRole
}

export interface PyOperationRole {
  kind: 'body' | 'response' | 'parameter' | 'responseHeader'
  status?: string
  location?: 'path' | 'query' | 'header' | 'cookie'
  name?: string
  path?: string
}

export interface PyEnumDecl {
  kind: 'enum'
  name: string
  pyName: string | null
  values: PyLiteralValue[]
  /** Decision (`scalarPolicy`): `str-enum` only when every value is a string. */
  repr: 'str-enum' | 'literal' | null
  /** Decision (`scalarPolicy`): member identifiers for `str-enum`, `[]` for `literal`. */
  members: Array<{ name: string; value: string }> | null
  description?: string
  pointer: string
}

export interface PyAliasDecl {
  kind: 'alias'
  name: string
  pyName: string | null
  /** `polymorphic-union` aliases are created by the `polymorphicRefs` pass for a discriminator base. */
  origin: 'component' | 'polymorphic-union'
  type: PyTypeExpr
  description?: string
  pointer: string
}

export interface PyOperationParameterDecl {
  location: 'path' | 'query' | 'header' | 'cookie'
  name: string
  required: boolean
  style: string | null
  explode: boolean | null
  schema: PyTypeExpr
  description?: string
  pointer: string
}

export interface PyOperationHeaderDecl {
  name: string
  required: boolean
  schema: PyTypeExpr
  description?: string
  pointer: string
}

export interface PyBodyDecl {
  required: boolean
  mediaType: string | null
  otherMediaTypes: string[]
  schema: PyTypeExpr | null
  description?: string
  pointer: string
}

export interface PyResponseDecl {
  status: string
  mediaType: string | null
  otherMediaTypes: string[]
  schema: PyTypeExpr | null
  headers: PyOperationHeaderDecl[]
  description?: string
  pointer: string
}

export interface PyOperationDecl {
  kind: 'operation'
  /** Internal stable key, independent of the operationId. */
  name: string
  /** Operation model stem (`operationNaming` pass). */
  pyName: string | null
  operationId: string | null
  method: string
  path: string
  tags: string[]
  summary?: string
  description?: string
  deprecated: boolean
  parameters: PyOperationParameterDecl[]
  requestBody: PyBodyDecl | null
  responses: PyResponseDecl[]
  /** `<Op>PathParams`, ... `<Op>Error`; empty string means no model is needed. */
  modelNames: {
    pathParams: string | null
    queryParams: string | null
    headerParams: string | null
    cookieParams: string | null
    body: string | null
    response: string | null
    error: string | null
  }
  pointer: string
}

export type PyDecl = PyModelDecl | PyEnumDecl | PyAliasDecl | PyOperationDecl

export interface PyImports {
  /** Module → imported names, both sorted. Always includes `__future__: ['annotations']`. */
  from: Record<string, string[]>
}

export type PydanticDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface PydanticDiagnostic {
  /** Stable code, `pydantic/<kebab-case>`. Codes in use are listed in the design doc §5. */
  code: `pydantic/${string}`
  severity: PydanticDiagnosticSeverity
  /** JSON Pointer into the prepared document. */
  pointer: string
  message: string
}

export interface PyModuleIR {
  irVersion: 1
  /** Module name without `.py`. */
  module: string
  /** In S2 declaration order; inline declarations directly before their first user. */
  decls: PyDecl[]
  /** Names of declarations that need `model_rebuild()` (recursive models), sorted. */
  rebuild: string[]
  /** Decision (`collectImports` pass). */
  imports: PyImports | null
  diagnostics: PydanticDiagnostic[]
}

/** A decision slot that is still `null` after the passes, or a scalar fact that `scalarPolicy` did not resolve. */
export interface UnresolvedPySlot {
  pointer: string
  slot: string
}

/** Lists every unresolved slot; empty when the IR is ready for rendering. */
export function findUnresolvedPySlots(ir: PyModuleIR): UnresolvedPySlot[] {
  const found: UnresolvedPySlot[] = []
  if (ir.imports === null) found.push({ pointer: '', slot: 'module.imports' })

  const visitType = (type: PyTypeExpr, pointer: string, slot: string): void => {
    switch (type.kind) {
      case 'scalar':
        found.push({ pointer, slot: `${slot}:scalar` })
        return
      case 'decoded':
        visitType(type.pythonType, pointer, `${slot}.pythonType`)
        return
      case 'list':
        visitType(type.item, pointer, `${slot}.item`)
        return
      case 'tuple':
        type.items.forEach((item, index) => visitType(item, pointer, `${slot}.items[${index}]`))
        if (type.rest) visitType(type.rest, pointer, `${slot}.rest`)
        return
      case 'dict':
        visitType(type.value, pointer, `${slot}.value`)
        return
      case 'union':
        type.members.forEach((member, index) => visitType(member, pointer, `${slot}.members[${index}]`))
        return
      case 'constrained':
        if (type.constraints.pattern && type.constraints.pattern.python === null) {
          found.push({ pointer, slot: `${slot}.pattern.python` })
        }
        visitType(type.base, pointer, `${slot}.base`)
        return
      default:
        return
    }
  }

  for (const decl of ir.decls) {
    if (decl.pyName === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.pyName` })
    if (decl.kind === 'model') {
      if (decl.extra === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.extra` })
      if (decl.regexEngine === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.regexEngine` })
      if (decl.frozen === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.frozen` })
      if (decl.openness.kind === 'typed-map') visitType(decl.openness.value, decl.pointer, `${decl.name}.openness`)
      for (const field of decl.fields) {
        const at = `${decl.name}.${field.wireName}`
        if (field.attribute === null) found.push({ pointer: field.pointer, slot: `${at}.attribute` })
        if (field.alias === null) found.push({ pointer: field.pointer, slot: `${at}.alias` })
        if (field.default === null) found.push({ pointer: field.pointer, slot: `${at}.default` })
        if (field.rejectExplicitNull === null) found.push({ pointer: field.pointer, slot: `${at}.rejectExplicitNull` })
        visitType(field.type, field.pointer, `${at}.type`)
      }
    } else if (decl.kind === 'enum') {
      if (decl.repr === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.repr` })
      if (decl.members === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.members` })
    } else if (decl.kind === 'alias') {
      visitType(decl.type, decl.pointer, `${decl.name}.type`)
    } else {
      for (const [role, value] of Object.entries(decl.modelNames)) {
        if (value === null) found.push({ pointer: decl.pointer, slot: `${decl.name}.modelNames.${role}` })
      }
      for (const parameter of decl.parameters) {
        visitType(parameter.schema, parameter.pointer, `${decl.name}.${parameter.location}.${parameter.name}`)
      }
      if (decl.requestBody?.schema !== null && decl.requestBody?.schema !== undefined) {
        visitType(decl.requestBody.schema, decl.requestBody.pointer, `${decl.name}.requestBody.schema`)
      }
      for (const response of decl.responses) {
        if (response.schema !== null) visitType(response.schema, response.pointer, `${decl.name}.responses.${response.status}.schema`)
        for (const header of response.headers) visitType(header.schema, header.pointer, `${decl.name}.responses.${response.status}.headers.${header.name}`)
      }
    }
  }
  return found
}

/** Throws when the IR still has unresolved slots (render precondition). */
export function assertResolvedPyIr(ir: PyModuleIR): void {
  const unresolved = findUnresolvedPySlots(ir)
  if (unresolved.length > 0) {
    const listed = unresolved.slice(0, 20).map(u => `  - ${u.slot} (at ${u.pointer || '/'})`).join('\n')
    throw new Error(`Pydantic IR has ${unresolved.length} unresolved slot(s):\n${listed}`)
  }
}
