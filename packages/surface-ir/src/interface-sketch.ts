/**
 * @fileoverview Intent-Unit Module: Standard TypeSpec (.tsp) Interface Sketch Profile IR & Parser
 * @intent INTENT-OA-SKETCH-IR
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-02
 */

import { sha256, stableStringify } from './hash.js'
import {
  computeInterfaceDepth,
  evaluateDesignRedFlags,
  scoreSketchCandidatesWithParser,
} from './interface-sketch-arena.js'
import {
  scanTypeSpecSketch,
  type RawDecorator,
  type RawField,
  type RawInterface,
  type RawMetadata,
  type RawModel,
  type RawOperation,
  type RawParam,
  type RawSpread,
  type RawUnionOrEnum,
  type RawVariant,
  type SketchDiagnostic,
  type SketchDiagnosticCode,
} from './interface-sketch-scanner.js'

export { computeInterfaceDepth, evaluateDesignRedFlags }
export type { SketchDiagnostic, SketchDiagnosticCode }

/**
 * Schema id of `InterfaceSketchIr`. `v2` added `SketchUnionOrEnumIr.members` (member names with
 * their values) and `InterfaceSketchIr.diagnostics`, both always present; `v1` IR has neither.
 */
export const INTERFACE_SKETCH_IR_VERSION = 'oa-sdk.interface-sketch-ir.v2' as const

export type TypeSpecProfileKind = 'openapi-http' | 'interface-sketch' | 'hybrid'

export type DesignRedFlagId =
  | 'shallow-module'
  | 'information-leakage'
  | 'temporal-decomposition'
  | 'pass-through-method'
  | 'split-ownership'
  | 'two-ways-to-do-one-task'
  | 'importable-internals'
  | 'hand-synced-list'

export type SketchFieldIr = {
  name: string
  typeName: string
  optional: boolean
  doc?: string
  evidence: string[]
}

export type SketchModelIr = {
  name: string
  /** Template parameter names of a templated model (`model Page<T>` -> `['T']`) */
  templateParameters?: string[]
  /** Base of `model X extends Base` or `model X is Base` (with template arguments, e.g. `Page<User>`) */
  baseModel?: string
  derivedFrom?: {
    baseSymbol: string
    reason: string
  }
  intent?: {
    intentId: string
    docAnchor?: string
  }
  traceId?: string
  doc?: string
  evidence: string[]
  fields: SketchFieldIr[]
}

export type SketchParamIr = {
  name: string
  typeName: string
  optional: boolean
}

export type SketchOperationIr = {
  name: string
  params: SketchParamIr[]
  returnType: string
  doc?: string
  evidence: string[]
  intent?: {
    intentId: string
    docAnchor?: string
  }
}

export type SketchInterfaceIr = {
  name: string
  doc?: string
  intent?: {
    intentId: string
    docAnchor?: string
  }
  evidence: string[]
  operations: SketchOperationIr[]
}

/**
 * One union variant or enum member. `name` is the text before `:` (or the whole member when
 * there is no `:`); `value` is the text after `:`, verbatim (`"red"`, `1`, `Cat`).
 */
export type SketchVariantIr = {
  name: string
  value?: string
}

export type SketchUnionOrEnumIr = {
  name: string
  kind: 'union' | 'enum'
  /** Member names (`members[].name`), kept for counting and duplicate checks */
  variants: string[]
  members: SketchVariantIr[]
  doc?: string
  evidence: string[]
}

export type DesignRedFlagFinding = {
  ruleId: DesignRedFlagId
  severity: 'error' | 'warning'
  symbol: string
  message: string
}

export type InterfaceDepthMetrics = {
  exportedSurfaceCount: number
  hiddenConceptCount: number
  interfaceDepth: number
  isDeep: boolean
}

export type DerivedLineageEdge = {
  derivedSymbol: string
  baseSymbol: string
  reason: string
  usesModelIsSyntax: boolean
}

export type InterfaceSketchIr = {
  schemaVersion: typeof INTERFACE_SKETCH_IR_VERSION
  specName: string
  profile: TypeSpecProfileKind
  namespace?: string
  models: SketchModelIr[]
  interfaces: SketchInterfaceIr[]
  unionsAndEnums: SketchUnionOrEnumIr[]
  derivedLineage: DerivedLineageEdge[]
  graftedSymbols: string[]
  depthMetrics: InterfaceDepthMetrics
  redFlags: DesignRedFlagFinding[]
  /**
   * What the parser could not read or resolve. An `error` means a declaration may be missing
   * or incomplete in this IR (unterminated string or comment, unbalanced delimiter, unreadable
   * declaration or member, circular spread); consumers must not treat such an IR as the whole
   * contract. Warnings note constructs the IR does not model (top-level operations, spreads of
   * symbols declared elsewhere, `op x is y` signatures).
   */
  diagnostics: SketchDiagnostic[]
  versionHash: string
}

export type SketchArenaCandidateScore = {
  name: string
  interfaceDepth: number
  isDeep: boolean
  redFlagCount: number
  exportedSurfaceCount: number
  hiddenConceptCount: number
  score: number
}

export type SketchArenaComparison = {
  candidates: SketchArenaCandidateScore[]
  recommendedWinner: string
  graftedSymbols: string[]
}

/**
 * Automatically detects whether a standard `.tsp` source file uses the
 * `openapi-http` profile (`@service`, `@route`, `using Http`), the
 * `interface-sketch` profile (`interface`, `@intent`, `@derivedFrom`, `model B is A`),
 * or `hybrid` (`IUD-07`).
 */
export function detectTypeSpecProfile(source: string): TypeSpecProfileKind {
  const hasHttpMarkers =
    /@service\b/.test(source) ||
    /@route\b/.test(source) ||
    /\busing\s+(?:TypeSpec\.)?Http\b/.test(source)

  const hasSketchMarkers =
    /\binterface\s+[A-Za-z_][A-Za-z0-9_]*\s*(?:<[^>]*>\s*)?(?:extends\b|\{)/.test(source) ||
    /@intent\s*\(/.test(source) ||
    /@derivedFrom\s*\(/.test(source) ||
    /\bmodel\s+[A-Za-z_][A-Za-z0-9_]*\s+is\s+[A-Za-z_][A-Za-z0-9_]*/.test(source) ||
    /##\s+@evidence\b/.test(source)

  if (hasHttpMarkers && hasSketchMarkers) return 'hybrid'
  if (hasHttpMarkers) return 'openapi-http'
  return 'interface-sketch'
}


/**
 * Parses a standard `.tsp` specification into an `InterfaceSketchIr`, extracting
 * models (including `extends`, `is` and templates), `model B is A` lineage (`@derivedFrom`),
 * `@intent`, `@evidence` / `## @evidence`, interfaces, operations, unions, enums,
 * Interface Depth ($\ge 2.5$), all 8 Design Red Flags, and diagnostics for anything the
 * parser could not read.
 *
 * Metadata (doc comments and decorators) belongs to the declaration directly after it.
 * Spreads (`...Base`), interface `extends` and enum spreads are expanded when their target
 * is declared in the same source; other targets are reported as warnings.
 */
export function parseTypeSpecSketch(source: string, specName = 'domain'): InterfaceSketchIr {
  const profile = detectTypeSpecProfile(source)
  const scan = scanTypeSpecSketch(source)
  const diagnostics: SketchDiagnostic[] = [...scan.diagnostics]
  const resolver = new SketchReferenceResolver(scan.models, scan.interfaces, scan.unionsAndEnums, diagnostics)

  const models: SketchModelIr[] = []
  const derivedLineage: DerivedLineageEdge[] = []
  for (const raw of scan.models) {
    const meta = extractMetadata(raw.meta)
    const baseModel = raw.heritage?.ref
    const derivedFrom =
      meta.derivedFrom ?? (baseModel ? { baseSymbol: baseModel, reason: 'model inheritance' } : undefined)
    if (derivedFrom) {
      derivedLineage.push({
        derivedSymbol: raw.name,
        baseSymbol: derivedFrom.baseSymbol,
        reason: derivedFrom.reason,
        usesModelIsSyntax: raw.heritage?.kind === 'is',
      })
    }
    models.push({
      name: raw.name,
      ...(raw.templateParameters.length > 0 ? { templateParameters: raw.templateParameters } : {}),
      ...(baseModel ? { baseModel } : {}),
      ...(derivedFrom ? { derivedFrom } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      ...(meta.traceId ? { traceId: meta.traceId } : {}),
      ...(meta.doc ? { doc: meta.doc } : {}),
      evidence: meta.evidence,
      fields: resolver.ownFields(raw),
    })
  }

  const interfaces: SketchInterfaceIr[] = scan.interfaces.map(raw => {
    const meta = extractMetadata(raw.meta)
    return {
      name: raw.name,
      ...(meta.doc ? { doc: meta.doc } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      evidence: meta.evidence,
      operations: resolver.operations(raw),
    }
  })

  const unionsAndEnums: SketchUnionOrEnumIr[] = scan.unionsAndEnums.map(raw => {
    const meta = extractMetadata(raw.meta)
    const members = resolver.variants(raw)
    return {
      name: raw.name,
      kind: raw.kind,
      variants: members.map(member => member.name),
      members,
      ...(meta.doc ? { doc: meta.doc } : {}),
      evidence: meta.evidence,
    }
  })

  const depthMetrics = computeInterfaceDepth(models, interfaces, unionsAndEnums)
  const redFlags = evaluateDesignRedFlags(models, interfaces, unionsAndEnums, depthMetrics)
  const graftedSymbols = [
    ...interfaces.map(i => i.name),
    ...models.map(m => m.name),
    ...unionsAndEnums.map(u => u.name),
  ]

  const baseIr = {
    schemaVersion: INTERFACE_SKETCH_IR_VERSION,
    specName,
    profile,
    ...(scan.namespace ? { namespace: scan.namespace } : {}),
    models,
    interfaces,
    unionsAndEnums,
    derivedLineage,
    graftedSymbols,
    depthMetrics,
    redFlags,
    diagnostics: dedupeDiagnostics(diagnostics),
  }

  return {
    ...baseIr,
    versionHash: sha256(stableStringify(baseIr)),
  }
}

export function compareSketchCandidates(
  candidates: ReadonlyArray<{ name: string; source: string }>,
): SketchArenaComparison {
  return scoreSketchCandidatesWithParser(candidates, parseTypeSpecSketch)
}

/** One entry per distinct finding (a spread reached through several paths reports once), in source order. */
function dedupeDiagnostics(diagnostics: readonly SketchDiagnostic[]): SketchDiagnostic[] {
  const unique = new Map<string, SketchDiagnostic>()
  for (const diagnostic of diagnostics) {
    unique.set(`${diagnostic.line}:${diagnostic.column}:${diagnostic.code}:${diagnostic.message}`, diagnostic)
  }
  return [...unique.values()].sort((left, right) => left.line - right.line || left.column - right.column)
}

type SketchMetadata = {
  doc?: string
  evidence: string[]
  intent?: { intentId: string; docAnchor?: string }
  derivedFrom?: { baseSymbol: string; reason: string }
  traceId?: string
}

/**
 * Reads doc, evidence, intent, lineage and trace id from the doc comments and decorators of
 * one declaration. `@doc("...")` wins over the first doc-comment line; evidence collects
 * Heading-Form `## @evidence <locator>` lines and every string argument of `@evidence(...)`.
 */
function extractMetadata(meta: RawMetadata): SketchMetadata {
  const evidence = new Set<string>()
  let doc = firstStringArgument(findDecorator(meta.decorators, 'doc'))?.trim() || undefined

  for (const block of meta.docs) {
    const headingEvidence = /^\s*(?:\*\s*)?##\s+@evidence\s+([^\s*]+)/gm
    for (let match = headingEvidence.exec(block); match; match = headingEvidence.exec(block)) {
      if (match[1]) evidence.add(match[1].trim())
    }
    if (!doc) {
      const firstLine = block
        .split('\n')
        .map(line => line.replace(/^\s*\*\s?/, '').trim())
        .find(line => line.length > 0 && !line.startsWith('## @evidence') && !line.startsWith('- ['))
      if (firstLine) doc = firstLine
    }
  }

  for (const decorator of meta.decorators) {
    if (decorator.name !== 'evidence') continue
    for (const arg of decorator.args) {
      if (arg.kind === 'string' && arg.value.trim()) evidence.add(arg.value.trim())
    }
  }

  const intentArgs = stringArguments(findDecorator(meta.decorators, 'intent'))
  const intentId = intentArgs[0]?.trim()
  const docAnchor = intentArgs[1]?.trim()
  const intent = intentId ? { intentId, ...(docAnchor ? { docAnchor } : {}) } : undefined

  const derivedArgs = stringArguments(findDecorator(meta.decorators, 'derivedFrom'))
  const baseSymbol = derivedArgs[0]?.trim()
  const reason = derivedArgs[1]?.trim()
  const derivedFrom = baseSymbol && reason ? { baseSymbol, reason } : undefined

  const traceId = firstStringArgument(findDecorator(meta.decorators, 'traceId'))?.trim() || undefined

  return {
    ...(doc ? { doc } : {}),
    evidence: [...evidence],
    ...(intent ? { intent } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
    ...(traceId ? { traceId } : {}),
  }
}

function findDecorator(decorators: readonly RawDecorator[], name: string): RawDecorator | undefined {
  return decorators.find(decorator => decorator.name === name)
}

function stringArguments(decorator: RawDecorator | undefined): string[] {
  return (decorator?.args ?? []).map(arg => (arg.kind === 'string' ? arg.value : ''))
}

function firstStringArgument(decorator: RawDecorator | undefined): string | undefined {
  const first = decorator?.args[0]
  return first?.kind === 'string' ? first.value : undefined
}

/**
 * Expands spreads, interface `extends` and enum spreads against the declarations of the same
 * source, substituting template arguments (`...Page<User>` binds `T` to `User`).
 */
class SketchReferenceResolver {
  private readonly modelsByName: Map<string, RawModel>
  private readonly interfacesByName: Map<string, RawInterface>
  private readonly unionsByName: Map<string, RawUnionOrEnum>

  constructor(
    models: readonly RawModel[],
    interfaces: readonly RawInterface[],
    unionsAndEnums: readonly RawUnionOrEnum[],
    private readonly diagnostics: SketchDiagnostic[],
  ) {
    this.modelsByName = new Map(models.map(model => [model.name, model]))
    this.interfacesByName = new Map(interfaces.map(iface => [iface.name, iface]))
    this.unionsByName = new Map(unionsAndEnums.map(union => [union.name, union]))
  }

  /** The model's own fields with spreads inlined; `is`/`extends` base fields stay on the base. */
  ownFields(model: RawModel): SketchFieldIr[] {
    return this.expandMembers(model.members, model.name, new Map(), [model.name])
  }

  operations(iface: RawInterface): SketchOperationIr[] {
    return this.collectOperations(iface, new Map(), [iface.name])
  }

  variants(declaration: RawUnionOrEnum): SketchVariantIr[] {
    return this.collectVariants(declaration, [declaration.name])
  }

  private expandMembers(
    members: ReadonlyArray<RawField | RawSpread>,
    owner: string,
    bindings: ReadonlyMap<string, string>,
    visiting: readonly string[],
  ): SketchFieldIr[] {
    const fields = new Map<string, SketchFieldIr>()
    for (const member of members) {
      if (member.kind === 'field') {
        const meta = extractMetadata(member.meta)
        fields.set(member.name, {
          name: member.name,
          typeName: substituteTypeParameters(member.typeName, bindings),
          optional: member.optional,
          ...(meta.doc ? { doc: meta.doc } : {}),
          evidence: meta.evidence,
        })
        continue
      }
      for (const field of this.spreadFields(member, owner, bindings, visiting)) {
        fields.set(field.name, field)
      }
    }
    return [...fields.values()]
  }

  /** All properties a spread of `ref` copies: an `is` base's properties, then the model's own. */
  private spreadFields(
    spread: RawSpread,
    owner: string,
    bindings: ReadonlyMap<string, string>,
    visiting: readonly string[],
  ): SketchFieldIr[] {
    const ref = substituteTypeParameters(spread.ref, bindings)
    const target = this.lookup(this.modelsByName, ref)
    if (!target) {
      this.warnUnresolved(spread, owner, `Spread \`...${ref}\` in ${owner} refers to a model not declared in this sketch; its properties are not included.`)
      return []
    }
    if (visiting.includes(target.declaration.name)) {
      this.report('error', 'sketch/circular-reference', spread, `Spread \`...${ref}\` in ${owner} is circular (${[...visiting, target.declaration.name].join(' -> ')}).`, owner)
      return []
    }
    return this.allFields(target.declaration, bindTemplateArguments(target.declaration.templateParameters, target.args), [...visiting, target.declaration.name])
  }

  private allFields(model: RawModel, bindings: ReadonlyMap<string, string>, visiting: readonly string[]): SketchFieldIr[] {
    const inherited: SketchFieldIr[] = []
    if (model.heritage?.kind === 'is') {
      const ref = substituteTypeParameters(model.heritage.ref, bindings)
      const base = this.lookup(this.modelsByName, ref)
      if (base && !visiting.includes(base.declaration.name)) {
        inherited.push(
          ...this.allFields(base.declaration, bindTemplateArguments(base.declaration.templateParameters, base.args), [...visiting, base.declaration.name]),
        )
      }
    }
    const own = this.expandMembers(model.members, model.name, bindings, visiting)
    const ownNames = new Set(own.map(field => field.name))
    return [...inherited.filter(field => !ownNames.has(field.name)), ...own]
  }

  private collectOperations(
    iface: RawInterface,
    bindings: ReadonlyMap<string, string>,
    visiting: readonly string[],
  ): SketchOperationIr[] {
    const operations = new Map<string, SketchOperationIr>()
    for (const extended of iface.extends) {
      const ref = substituteTypeParameters(extended, bindings)
      const target = this.lookup(this.interfacesByName, ref)
      if (!target) {
        this.warnUnresolved(iface, iface.name, `Interface ${iface.name} extends \`${ref}\`, which is not declared in this sketch; its operations are not included.`)
        continue
      }
      if (visiting.includes(target.declaration.name)) {
        this.report('error', 'sketch/circular-reference', iface, `Interface ${iface.name} extends itself through ${[...visiting, target.declaration.name].join(' -> ')}.`, iface.name)
        continue
      }
      for (const op of this.collectOperations(
        target.declaration,
        bindTemplateArguments(target.declaration.templateParameters, target.args),
        [...visiting, target.declaration.name],
      )) {
        operations.set(op.name, op)
      }
    }
    for (const op of iface.operations) {
      operations.set(op.name, this.operation(op, iface.name, bindings))
    }
    return [...operations.values()]
  }

  private operation(op: RawOperation, owner: string, bindings: ReadonlyMap<string, string>): SketchOperationIr {
    const meta = extractMetadata(op.meta)
    const symbol = `${owner}.${op.name}`
    return {
      name: op.name,
      params: op.params.flatMap(param => this.params(param, symbol, bindings)),
      returnType: substituteTypeParameters(op.returnType, bindings),
      ...(meta.doc ? { doc: meta.doc } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      evidence: meta.evidence,
    }
  }

  private params(param: RawParam, symbol: string, bindings: ReadonlyMap<string, string>): SketchParamIr[] {
    if (param.kind === 'param') {
      return [{ name: param.name, optional: param.optional, typeName: substituteTypeParameters(param.typeName, bindings) }]
    }
    return this.spreadFields(param, symbol, bindings, [symbol]).map(field => ({
      name: field.name,
      optional: field.optional,
      typeName: field.typeName,
    }))
  }

  private collectVariants(declaration: RawUnionOrEnum, visiting: readonly string[]): SketchVariantIr[] {
    const members: SketchVariantIr[] = []
    for (const member of declaration.members) {
      if (member.kind === 'variant') {
        members.push(variant(member))
        continue
      }
      const target = this.lookup(this.unionsByName, member.ref)
      if (!target || target.declaration.kind !== declaration.kind) {
        this.warnUnresolved(member, declaration.name, `Spread \`...${member.ref}\` in ${declaration.kind} ${declaration.name} refers to a ${declaration.kind} not declared in this sketch; its members are not included.`)
        continue
      }
      if (visiting.includes(target.declaration.name)) {
        this.report('error', 'sketch/circular-reference', member, `Spread \`...${member.ref}\` in ${declaration.name} is circular.`, declaration.name)
        continue
      }
      members.push(...this.collectVariants(target.declaration, [...visiting, target.declaration.name]))
    }
    return members
  }

  private lookup<T>(byName: ReadonlyMap<string, T>, ref: string): { declaration: T; args: string[] } | undefined {
    const { name, args } = splitTemplateReference(ref)
    const declaration = byName.get(name) ?? byName.get(name.slice(name.lastIndexOf('.') + 1))
    return declaration ? { declaration, args } : undefined
  }

  private warnUnresolved(at: { line: number; column: number }, symbol: string, message: string): void {
    this.report('warning', 'sketch/unresolved-reference', at, message, symbol)
  }

  private report(
    severity: SketchDiagnostic['severity'],
    code: SketchDiagnosticCode,
    at: { line: number; column: number },
    message: string,
    symbol: string,
  ): void {
    this.diagnostics.push({ severity, code, message, line: at.line, column: at.column, symbol })
  }
}

function variant(member: RawVariant): SketchVariantIr {
  return { name: member.name, ...(member.value !== undefined ? { value: member.value } : {}) }
}

/** `Page<User, Order>` -> `{ name: 'Page', args: ['User', 'Order'] }`; nested brackets and strings stay intact. */
function splitTemplateReference(ref: string): { name: string; args: string[] } {
  const open = ref.indexOf('<')
  if (open < 0 || !ref.trimEnd().endsWith('>')) return { name: ref.trim(), args: [] }
  const name = ref.slice(0, open).trim()
  const inner = ref.trimEnd().slice(open + 1, -1)
  const args: string[] = []
  let depth = 0
  let current = ''
  let quoted = false
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index] ?? ''
    if (quoted) {
      current += char
      if (char === '\\') {
        current += inner[index + 1] ?? ''
        index++
      } else if (char === '"') {
        quoted = false
      }
      continue
    }
    if (char === '"') quoted = true
    else if ('<({['.includes(char)) depth++
    else if ('>)}]'.includes(char)) depth--
    else if (char === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) args.push(current.trim())
  return { name, args }
}

function bindTemplateArguments(parameters: readonly string[], args: readonly string[]): Map<string, string> {
  const bindings = new Map<string, string>()
  parameters.forEach((parameter, index) => {
    const arg = args[index]
    if (arg !== undefined) bindings.set(parameter, arg)
  })
  return bindings
}

/** Replaces template parameter identifiers (outside string literals) with their bound arguments. */
function substituteTypeParameters(typeName: string, bindings: ReadonlyMap<string, string>): string {
  if (bindings.size === 0) return typeName
  return typeName.replace(/("(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*)/g, (match, literal: string | undefined, ident: string | undefined) =>
    literal !== undefined ? match : (bindings.get(ident ?? '') ?? match),
  )
}
