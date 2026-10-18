/**
 * @fileoverview Intent-Unit Module: Standard TypeSpec (.tsp) Interface Sketch Profile IR, Depth Analyzer & 8 Red Flags Gate
 * @intent INTENT-OA-SKETCH-IR
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-02
 */

import { sha256, stableStringify } from './hash.js'

export const INTERFACE_SKETCH_IR_VERSION = 'oa-sdk.interface-sketch-ir.v1' as const

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

export type SketchUnionOrEnumIr = {
  name: string
  kind: 'union' | 'enum'
  variants: string[]
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
    /\binterface\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.test(source) ||
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
 * models, `model B is A` lineage (`@derivedFrom`), `@intent`, `@evidence` / `## @evidence`,
 * interfaces, operations, Interface Depth ($\ge 2.5$), and all 8 Design Red Flags.
 */
export function parseTypeSpecSketch(source: string, specName = 'domain'): InterfaceSketchIr {
  const profile = detectTypeSpecProfile(source)
  const nsMatch = /\bnamespace\s+([A-Za-z0-9_.]+)\s*;/.exec(source)
  const namespace = nsMatch?.[1]

  const models: SketchModelIr[] = []
  const interfaces: SketchInterfaceIr[] = []
  const unionsAndEnums: SketchUnionOrEnumIr[] = []
  const derivedLineage: DerivedLineageEdge[] = []

  // Parse models: optional leading comments/decorators + `model Name (is Base)? { ... }`
  const modelRegex =
    /((?:\/\*\*[\s\S]*?\*\/\s*|@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)*)\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+is\s+([A-Za-z_][A-Za-z0-9_]*))?\s*\{([\s\S]*?)\}/g
  let match: RegExpExecArray | null
  while ((match = modelRegex.exec(source)) !== null) {
    const prefix = match[1] ?? ''
    const name = match[2] ?? ''
    const baseModel = match[3]
    const body = match[4] ?? ''
    const meta = parseLeadingMetadata(prefix)
    const fields = parseModelFields(body)

    const derivedFrom = meta.derivedFrom ?? (baseModel ? { baseSymbol: baseModel, reason: 'model inheritance' } : undefined)
    if (derivedFrom) {
      derivedLineage.push({
        derivedSymbol: name,
        baseSymbol: derivedFrom.baseSymbol,
        reason: derivedFrom.reason,
        usesModelIsSyntax: Boolean(baseModel),
      })
    }

    models.push({
      name,
      ...(baseModel ? { baseModel } : {}),
      ...(derivedFrom ? { derivedFrom } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      ...(meta.traceId ? { traceId: meta.traceId } : {}),
      ...(meta.doc ? { doc: meta.doc } : {}),
      evidence: meta.evidence,
      fields,
    })
  }

  // Parse interfaces: optional leading comments/decorators + `interface Name { ... }`
  const ifaceRegex =
    /((?:\/\*\*[\s\S]*?\*\/\s*|@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)*)\binterface\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g
  while ((match = ifaceRegex.exec(source)) !== null) {
    const prefix = match[1] ?? ''
    const name = match[2] ?? ''
    const body = match[3] ?? ''
    const meta = parseLeadingMetadata(prefix)
    const operations = parseInterfaceOperations(body)

    interfaces.push({
      name,
      ...(meta.doc ? { doc: meta.doc } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      evidence: meta.evidence,
      operations,
    })
  }

  // Parse unions & enums
  const unionEnumRegex =
    /((?:\/\*\*[\s\S]*?\*\/\s*|@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)*)\b(union|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g
  while ((match = unionEnumRegex.exec(source)) !== null) {
    const prefix = match[1] ?? ''
    const kind = (match[2] as 'union' | 'enum') ?? 'union'
    const name = match[3] ?? ''
    const body = match[4] ?? ''
    const meta = parseLeadingMetadata(prefix)
    const variants = body
      .split(/[;,\n]/)
      .map(line => line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter(Boolean)
      .map(line => {
        const colonIdx = line.indexOf(':')
        return (colonIdx >= 0 ? line.slice(0, colonIdx) : line).trim()
      })
      .filter(v => /^[A-Za-z_"']/.test(v))

    unionsAndEnums.push({
      name,
      kind,
      variants,
      ...(meta.doc ? { doc: meta.doc } : {}),
      evidence: meta.evidence,
    })
  }

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
    ...(namespace ? { namespace } : {}),
    models,
    interfaces,
    unionsAndEnums,
    derivedLineage,
    graftedSymbols,
    depthMetrics,
    redFlags,
  }

  return {
    ...baseIr,
    versionHash: sha256(stableStringify(baseIr)),
  }
}

/**
 * Compares $\ge 2$ `.tsp` candidate sketches and selects the winning design
 * based on Interface Depth ($\ge 2.5$) and zero Design Red Flags.
 */
export function compareSketchCandidates(
  candidates: ReadonlyArray<{ name: string; source: string }>,
): SketchArenaComparison {
  const scored: SketchArenaCandidateScore[] = []
  const allSymbols = new Set<string>()

  for (const candidate of candidates) {
    const ir = parseTypeSpecSketch(candidate.source, candidate.name)
    for (const sym of ir.graftedSymbols) {
      allSymbols.add(sym)
    }
    const score = Number(
      (ir.depthMetrics.interfaceDepth * 10 - ir.redFlags.length * 15).toFixed(2),
    )
    scored.push({
      name: candidate.name,
      interfaceDepth: ir.depthMetrics.interfaceDepth,
      isDeep: ir.depthMetrics.isDeep,
      redFlagCount: ir.redFlags.length,
      exportedSurfaceCount: ir.depthMetrics.exportedSurfaceCount,
      hiddenConceptCount: ir.depthMetrics.hiddenConceptCount,
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)

  return {
    candidates: scored,
    recommendedWinner: scored[0]?.name ?? '',
    graftedSymbols: [...allSymbols],
  }
}

function parseLeadingMetadata(prefix: string): {
  doc?: string
  evidence: string[]
  intent?: { intentId: string; docAnchor?: string }
  derivedFrom?: { baseSymbol: string; reason: string }
  traceId?: string
} {
  const evidence = new Set<string>()
  let doc: string | undefined

  const docDecMatch = /@doc\(\s*"([^"]+)"\s*\)/.exec(prefix)
  if (docDecMatch?.[1]) {
    doc = docDecMatch[1].trim()
  }

  const jsdocRegex = /\/\*\*([\s\S]*?)\*\//g
  let m: RegExpExecArray | null
  while ((m = jsdocRegex.exec(prefix)) !== null) {
    const block = m[1] ?? ''
    const headingEvRegex = /^\s*(?:\*\s*)?##\s+@evidence\s+([^\s*]+)/gm
    let evMatch: RegExpExecArray | null
    while ((evMatch = headingEvRegex.exec(block)) !== null) {
      if (evMatch[1]) evidence.add(evMatch[1].trim())
    }
    if (!doc) {
      const firstLine = block
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .find(l => l.length > 0 && !l.startsWith('## @evidence') && !l.startsWith('- ['))
      if (firstLine) doc = firstLine
    }
  }

  const evDecRegex = /@evidence\(([^)]*)\)/g
  while ((m = evDecRegex.exec(prefix)) !== null) {
    const strRegex = /"([^"]+)"/g
    let sMatch: RegExpExecArray | null
    while ((sMatch = strRegex.exec(m[1] ?? '')) !== null) {
      if (sMatch[1]) evidence.add(sMatch[1].trim())
    }
  }

  let intent: { intentId: string; docAnchor?: string } | undefined
  const intentMatch = /@intent\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?\s*\)/.exec(prefix)
  if (intentMatch?.[1]) {
    intent = {
      intentId: intentMatch[1].trim(),
      ...(intentMatch[2] ? { docAnchor: intentMatch[2].trim() } : {}),
    }
  }

  let derivedFrom: { baseSymbol: string; reason: string } | undefined
  const derivedMatch = /@derivedFrom\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/.exec(prefix)
  if (derivedMatch?.[1] && derivedMatch?.[2]) {
    derivedFrom = {
      baseSymbol: derivedMatch[1].trim(),
      reason: derivedMatch[2].trim(),
    }
  }

  const traceMatch = /@traceId\(\s*"([^"]+)"\s*\)/.exec(prefix)
  const traceId = traceMatch?.[1]?.trim()

  return {
    ...(doc ? { doc } : {}),
    evidence: [...evidence],
    ...(intent ? { intent } : {}),
    ...(derivedFrom ? { derivedFrom } : {}),
    ...(traceId ? { traceId } : {}),
  }
}

function parseModelFields(body: string): SketchFieldIr[] {
  const fields: SketchFieldIr[] = []
  const lines = body.split('\n')
  let pendingPrefix = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue
    if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('@')) {
      pendingPrefix += line + '\n'
      const inlineField = /([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([^;,]+)[;,]?$/.exec(line)
      if (!inlineField) continue
    }
    const fieldMatch = /([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([^;,]+)[;,]?$/.exec(line)
    if (fieldMatch?.[1] && fieldMatch?.[3]) {
      const meta = parseLeadingMetadata(pendingPrefix)
      fields.push({
        name: fieldMatch[1],
        optional: fieldMatch[2] === '?',
        typeName: fieldMatch[3].trim(),
        ...(meta.doc ? { doc: meta.doc } : {}),
        evidence: meta.evidence,
      })
      pendingPrefix = ''
    }
  }
  return fields
}

function parseInterfaceOperations(body: string): SketchOperationIr[] {
  const ops: SketchOperationIr[] = []
  const opRegex =
    /((?:\/\*\*[\s\S]*?\*\/\s*|@[A-Za-z0-9_]+(?:\([^)]*\))?\s*)*)(?:op\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = opRegex.exec(body)) !== null) {
    const prefix = match[1] ?? ''
    const name = match[2] ?? ''
    const rawParams = match[3] ?? ''
    const returnType = (match[4] ?? 'void').trim()
    const meta = parseLeadingMetadata(prefix)

    const params: SketchParamIr[] = rawParams
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        const pm = /^([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*(.+)$/.exec(p)
        return {
          name: pm?.[1] ?? p,
          optional: pm?.[2] === '?',
          typeName: pm?.[3]?.trim() ?? 'unknown',
        }
      })

    ops.push({
      name,
      params,
      returnType,
      ...(meta.doc ? { doc: meta.doc } : {}),
      ...(meta.intent ? { intent: meta.intent } : {}),
      evidence: meta.evidence,
    })
  }
  return ops
}

function computeInterfaceDepth(
  models: ReadonlyArray<SketchModelIr>,
  interfaces: ReadonlyArray<SketchInterfaceIr>,
  unionsAndEnums: ReadonlyArray<SketchUnionOrEnumIr>,
): InterfaceDepthMetrics {
  const opCount = interfaces.reduce((acc, i) => acc + i.operations.length, 0)
  const exportedSurfaceCount = Math.max(1, opCount || models.length)

  const fieldCount = models.reduce((acc, m) => acc + m.fields.length, 0)
  const variantCount = unionsAndEnums.reduce((acc, u) => acc + u.variants.length, 0)
  const evidenceCount =
    models.reduce((acc, m) => acc + m.evidence.length, 0) +
    interfaces.reduce(
      (acc, i) => acc + i.evidence.length + i.operations.reduce((oa, o) => oa + o.evidence.length, 0),
      0,
    )

  const hiddenConceptCount = fieldCount + variantCount + evidenceCount + models.length
  const interfaceDepth = Number((hiddenConceptCount / exportedSurfaceCount).toFixed(2))

  return {
    exportedSurfaceCount,
    hiddenConceptCount,
    interfaceDepth,
    isDeep: interfaceDepth >= 2.5,
  }
}

function evaluateDesignRedFlags(
  models: ReadonlyArray<SketchModelIr>,
  interfaces: ReadonlyArray<SketchInterfaceIr>,
  unionsAndEnums: ReadonlyArray<SketchUnionOrEnumIr>,
  depthMetrics: InterfaceDepthMetrics,
): DesignRedFlagFinding[] {
  const findings: DesignRedFlagFinding[] = []

  // 1. shallow-module
  if (!depthMetrics.isDeep) {
    findings.push({
      ruleId: 'shallow-module',
      severity: 'error',
      symbol: interfaces[0]?.name ?? models[0]?.name ?? 'spec',
      message: `Interface depth ${depthMetrics.interfaceDepth} is below the required >= 2.5 threshold.`,
    })
  }

  // 2. temporal-decomposition (step1/step2/init/finalize raw lifecycle triplets)
  const temporalPrefixes = /^(?:step\d+|phase\d+|pre_|post_|before_|after_)/i
  for (const iface of interfaces) {
    for (const op of iface.operations) {
      if (temporalPrefixes.test(op.name)) {
        findings.push({
          ruleId: 'temporal-decomposition',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operation "${op.name}" exposes temporal step ordering instead of an atomic domain intent.`,
        })
      }
      // 3. pass-through-method
      if (/^(?:passthrough|forward|proxy|delegate)_/i.test(op.name)) {
        findings.push({
          ruleId: 'pass-through-method',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operation "${op.name}" is a shallow pass-through wrapper.`,
        })
      }
      // 4. importable-internals
      if (op.name.startsWith('_') || /Internal|PrivateHelper/.test(op.returnType)) {
        findings.push({
          ruleId: 'importable-internals',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Public interface exposes internal helper symbol "${op.name}".`,
        })
      }
    }
  }

  // 5. information-leakage (internal storage/regex/sql implementation details leaked in model fields)
  for (const model of models) {
    for (const field of model.fields) {
      if (/^(?:_internal|raw_sql|sqlite_rowid|regex_pattern|mutex_handle)$/i.test(field.name)) {
        findings.push({
          ruleId: 'information-leakage',
          severity: 'error',
          symbol: `${model.name}.${field.name}`,
          message: `Model field "${field.name}" leaks internal representation details across the boundary.`,
        })
      }
    }
    // 6. split-ownership (derived model using `is` without `@derivedFrom` reason when `@derivedFrom` is expected)
    if (model.baseModel && !model.derivedFrom?.reason) {
      findings.push({
        ruleId: 'split-ownership',
        severity: 'warning',
        symbol: model.name,
        message: `Derived model "${model.name} is ${model.baseModel}" should declare @derivedFrom("${model.baseModel}", "reason").`,
      })
    }
  }

  // 7. two-ways-to-do-one-task (duplicate operation signatures with overlapping verbs)
  for (const iface of interfaces) {
    const seenSignatures = new Map<string, string>()
    for (const op of iface.operations) {
      const sigKey = `${op.params.map(p => p.typeName).join(',')}->${op.returnType}`
      const normName = op.name.replace(/^(?:get|fetch|load|read|retrieve)/i, 'READ')
      const key = `${normName}:${sigKey}`
      const prev = seenSignatures.get(key)
      if (prev && prev !== op.name) {
        findings.push({
          ruleId: 'two-ways-to-do-one-task',
          severity: 'error',
          symbol: `${iface.name}.${op.name}`,
          message: `Operations "${prev}" and "${op.name}" provide two parallel ways to perform the same task.`,
        })
      } else {
        seenSignatures.set(key, op.name)
      }
    }
  }

  // 8. hand-synced-list
  for (const u of unionsAndEnums) {
    const unique = new Set(u.variants)
    if (unique.size !== u.variants.length) {
      findings.push({
        ruleId: 'hand-synced-list',
        severity: 'error',
        symbol: u.name,
        message: `Union/Enum "${u.name}" contains duplicate hand-synced variants.`,
      })
    }
  }

  return findings
}
