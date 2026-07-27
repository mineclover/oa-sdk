import { createHash } from 'node:crypto'
import type { TypeSpecRefProvenanceV1 } from './typespec-ref-provenance.js'

/**
 * A review-only envelope that joins an authoritative contract provenance
 * artifact with implementation observations. It is deliberately not an input
 * to OpenAPI generation or a second contract source.
 */
export const PARALLEL_EVIDENCE_SCHEMA_VERSION = 'oa-sdk.parallel-evidence.v1' as const
export const PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION = 'oa-sdk.parallel-evidence-metrics.v1' as const
export const PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION = 'oa-sdk.parallel-evidence-report.v1' as const

export type ParallelEvidenceRole = 'contract-authority' | 'implementation-observation'
export type ParallelEvidenceSubjectStatus = 'matched-pointer' | 'contract-only' | 'implementation-only'

export type ParallelEvidenceSourceRange = {
  file: string
  start: { line: number; column: number }
  end: { line: number; column: number }
}

export type ParallelEvidenceArtifactInput = {
  sourceId: string
  role: ParallelEvidenceRole
  artifactSchemaVersion: string
  provenanceKind: string
  sha256: string
}

export type ParallelEvidenceDeclaration = {
  sourceId: string
  role: ParallelEvidenceRole
  declarationId: string
  kind: string
  symbol: string
  source?: ParallelEvidenceSourceRange
  /** Source-specific analysis metadata; it has no contract-authoring authority. */
  observations?: {
    astKind?: string
    typeShape?: {
      features: readonly string[]
      typeSpecProjection: string
    }
  }
}

export type ParallelEvidenceSubject = {
  id: `openapi-pointer:${string}`
  outputPointer: string
  status: ParallelEvidenceSubjectStatus
  contract: ParallelEvidenceDeclaration[]
  implementation: ParallelEvidenceDeclaration[]
}

export type ParallelEvidenceRelation = {
  sourceId: string
  role: ParallelEvidenceRole
  kind: 'openapi-ref' | 'type-ref'
  source: {
    declarationId: string
    subjectId?: `openapi-pointer:${string}`
  }
  target: {
    declarationId?: string
    subjectId?: `openapi-pointer:${string}`
    ref?: string
  }
}

export type ParallelEvidenceV1 = {
  schemaVersion: typeof PARALLEL_EVIDENCE_SCHEMA_VERSION
  purpose: 'review-evidence-only'
  contractAuthority: 'typespec'
  artifacts: ParallelEvidenceArtifactInput[]
  subjects: ParallelEvidenceSubject[]
  relations: ParallelEvidenceRelation[]
  summary: {
    matchedPointers: number
    contractOnlyPointers: number
    implementationOnlyPointers: number
    contractRelations: number
    implementationRelations: number
  }
  metrics: ParallelEvidenceMetricsV1
}

/**
 * Stable numeric dimensions for trend storage. Ratios are exact values in the
 * closed interval [0, 1], never presentation-rounded percentages.
 */
export type ParallelEvidenceMetricsV1 = {
  schemaVersion: typeof PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION
  pointers: {
    contract: number
    implementation: number
    union: number
    matched: number
    contractCoverageRatio: number
    implementationCoverageRatio: number
    unionCoverageRatio: number
  }
  declarations: {
    contractTotal: number
    contractEmitting: number
    implementationTotal: number
    implementationEmitting: number
    implementationShapeAnnotated: number
  }
  relations: {
    contractTotal: number
    implementationTotal: number
    contractTargetResolved: number
    implementationTargetResolved: number
  }
  implementationShapes: {
    direct: number
    policyRequired: number
    unsupported: number
    unclassified: number
    features: Record<string, number>
  }
}

export type ParallelEvidenceMetricDeltaV1 = {
  schemaVersion: 'oa-sdk.parallel-evidence-metric-delta.v1'
  baselineSchemaVersion: typeof PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION
  changed: boolean
  values: Record<string, { baseline: number; current: number; delta: number }>
}

export type ParallelEvidenceReportV1 = {
  schemaVersion: typeof PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION
  evidence: ParallelEvidenceV1
  metrics: ParallelEvidenceMetricsV1
  baseline?: ParallelEvidenceMetricDeltaV1
}

export type TtscContractProvenanceV2 = {
  schemaVersion: 'ttsc-contract-provenance.v2'
  inputs: { toolchain: { typescript: string } }
  declarations: Array<{
    id: string
    kind: 'schema' | 'property' | 'operation'
    astKind: string
    symbol: string
    source: ParallelEvidenceSourceRange
    shape?: {
      features: readonly string[]
      typeSpecProjection: 'direct' | 'policy-required' | 'unsupported'
    }
  }>
  edges: Array<
    | { kind: 'emits'; declarationId: string; outputPointer: string }
    | { kind: 'type-ref'; declarationId: string; targetDeclarationId: string }
  >
  diagnostics: readonly unknown[]
}

export function buildParallelEvidence(input: {
  contract: TypeSpecRefProvenanceV1
  implementation: TtscContractProvenanceV2
}): ParallelEvidenceV1 {
  if (input.implementation.schemaVersion !== 'ttsc-contract-provenance.v2') {
    throw new Error(`Unsupported ttsc provenance schema: ${input.implementation.schemaVersion}`)
  }

  const subjects = new Map<string, { outputPointer: string; contract: ParallelEvidenceDeclaration[]; implementation: ParallelEvidenceDeclaration[] }>()
  const relations: ParallelEvidenceRelation[] = []
  const addSubject = (pointer: string, declaration: ParallelEvidenceDeclaration): void => {
    const subject = subjects.get(pointer) ?? { outputPointer: pointer, contract: [], implementation: [] }
    if (declaration.role === 'contract-authority') subject.contract.push(declaration)
    else subject.implementation.push(declaration)
    subjects.set(pointer, subject)
  }

  const contractDeclarations = new Map(input.contract.declarations.map(declaration => [declaration.id, declaration]))
  for (const edge of input.contract.edges) {
    const declaration = contractDeclarations.get(edge.declarationId)
    if (!declaration) continue
    const normalized = normalizeContractDeclaration(declaration)
    if (edge.kind === 'emits' || edge.kind === 'restores') addSubject(edge.outputPointer, normalized)
    if (edge.kind === 'references') {
      relations.push({
        sourceId: 'typespec',
        role: 'contract-authority',
        kind: 'openapi-ref',
        source: { declarationId: declaration.id, subjectId: pointerSubjectId(edge.outputPointer) },
        target: {
          ...(edge.targetRef ? { ref: edge.targetRef } : {}),
          ...(edge.targetRef?.startsWith('#/') ? { subjectId: pointerSubjectId(edge.targetRef) } : {}),
        },
      })
    }
  }

  const implementationDeclarations = new Map(input.implementation.declarations.map(declaration => [declaration.id, declaration]))
  const implementationPointers = new Map<string, string>()
  for (const edge of input.implementation.edges) {
    if (edge.kind !== 'emits') continue
    const declaration = implementationDeclarations.get(edge.declarationId)
    if (!declaration) continue
    implementationPointers.set(declaration.id, edge.outputPointer)
    addSubject(edge.outputPointer, normalizeImplementationDeclaration(declaration))
  }
  for (const edge of input.implementation.edges) {
    if (edge.kind !== 'type-ref') continue
    relations.push({
      sourceId: 'ttsc',
      role: 'implementation-observation',
      kind: 'type-ref',
      source: {
        declarationId: edge.declarationId,
        ...(implementationPointers.has(edge.declarationId) ? { subjectId: pointerSubjectId(implementationPointers.get(edge.declarationId)!) } : {}),
      },
      target: {
        declarationId: edge.targetDeclarationId,
        ...(implementationPointers.has(edge.targetDeclarationId) ? { subjectId: pointerSubjectId(implementationPointers.get(edge.targetDeclarationId)!) } : {}),
      },
    })
  }

  const normalizedSubjects = [...subjects.values()]
    .map((subject): ParallelEvidenceSubject => ({
      id: pointerSubjectId(subject.outputPointer),
      outputPointer: subject.outputPointer,
      status: subject.contract.length > 0 && subject.implementation.length > 0
        ? 'matched-pointer'
        : subject.contract.length > 0
          ? 'contract-only'
          : 'implementation-only',
      contract: subject.contract.sort(compareDeclarations),
      implementation: subject.implementation.sort(compareDeclarations),
    }))
    .sort((left, right) => left.outputPointer.localeCompare(right.outputPointer))

  const summary = {
    matchedPointers: normalizedSubjects.filter(subject => subject.status === 'matched-pointer').length,
    contractOnlyPointers: normalizedSubjects.filter(subject => subject.status === 'contract-only').length,
    implementationOnlyPointers: normalizedSubjects.filter(subject => subject.status === 'implementation-only').length,
    contractRelations: relations.filter(relation => relation.role === 'contract-authority').length,
    implementationRelations: relations.filter(relation => relation.role === 'implementation-observation').length,
  }
  const metrics = createParallelEvidenceMetrics({
    contract: input.contract,
    implementation: input.implementation,
    subjects: normalizedSubjects,
    relations,
  })

  return {
    schemaVersion: PARALLEL_EVIDENCE_SCHEMA_VERSION,
    purpose: 'review-evidence-only',
    contractAuthority: 'typespec',
    artifacts: [
      {
        sourceId: 'typespec',
        role: 'contract-authority',
        artifactSchemaVersion: input.contract.schemaVersion,
        provenanceKind: input.contract.provenanceKind,
        sha256: sha256(stableStringify(input.contract)),
      },
      {
        sourceId: 'ttsc',
        role: 'implementation-observation',
        artifactSchemaVersion: input.implementation.schemaVersion,
        provenanceKind: 'typescript-go-ast-checker',
        sha256: sha256(stableStringify(input.implementation)),
      },
    ],
    subjects: normalizedSubjects,
    relations: relations.sort(compareRelations),
    summary,
    metrics,
  }
}

/** Build a deterministic, trend-safe metric snapshot from a joined evidence graph. */
export function createParallelEvidenceMetrics(input: {
  contract: TypeSpecRefProvenanceV1
  implementation: TtscContractProvenanceV2
  subjects: readonly ParallelEvidenceSubject[]
  relations: readonly ParallelEvidenceRelation[]
}): ParallelEvidenceMetricsV1 {
  const contractPointers = input.subjects.filter(subject => subject.contract.length > 0).length
  const implementationPointers = input.subjects.filter(subject => subject.implementation.length > 0).length
  const matchedPointers = input.subjects.filter(subject => subject.status === 'matched-pointer').length
  const contractEmitting = new Set(
    input.subjects.flatMap(subject => subject.contract.map(declaration => declaration.declarationId)),
  ).size
  const implementationEmitting = new Set(
    input.subjects.flatMap(subject => subject.implementation.map(declaration => declaration.declarationId)),
  ).size
  const subjectIds = new Set(input.subjects.map(subject => subject.id))
  const shapeCounts = {
    direct: 0,
    policyRequired: 0,
    unsupported: 0,
    unclassified: 0,
  }
  const features = new Map<string, number>()
  let implementationShapeAnnotated = 0
  for (const declaration of input.implementation.declarations) {
    const shape = declaration.shape
    if (shape === undefined) {
      shapeCounts.unclassified += 1
      continue
    }
    implementationShapeAnnotated += 1
    if (shape.typeSpecProjection === 'direct') shapeCounts.direct += 1
    else if (shape.typeSpecProjection === 'policy-required') shapeCounts.policyRequired += 1
    else shapeCounts.unsupported += 1
    for (const feature of shape.features) features.set(feature, (features.get(feature) ?? 0) + 1)
  }
  const orderedFeatures = Object.fromEntries([...features.entries()].sort(([left], [right]) => left.localeCompare(right)))
  const contractRelations = input.relations.filter(relation => relation.role === 'contract-authority')
  const implementationRelations = input.relations.filter(relation => relation.role === 'implementation-observation')

  return {
    schemaVersion: PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION,
    pointers: {
      contract: contractPointers,
      implementation: implementationPointers,
      union: input.subjects.length,
      matched: matchedPointers,
      contractCoverageRatio: ratio(matchedPointers, contractPointers),
      implementationCoverageRatio: ratio(matchedPointers, implementationPointers),
      unionCoverageRatio: ratio(matchedPointers, input.subjects.length),
    },
    declarations: {
      contractTotal: input.contract.declarations.length,
      contractEmitting,
      implementationTotal: input.implementation.declarations.length,
      implementationEmitting,
      implementationShapeAnnotated,
    },
    relations: {
      contractTotal: contractRelations.length,
      implementationTotal: implementationRelations.length,
      contractTargetResolved: contractRelations.filter(relation => relation.target.subjectId !== undefined && subjectIds.has(relation.target.subjectId)).length,
      implementationTargetResolved: implementationRelations.filter(relation => relation.target.subjectId !== undefined && subjectIds.has(relation.target.subjectId)).length,
    },
    implementationShapes: {
      ...shapeCounts,
      features: orderedFeatures,
    },
  }
}

export function createParallelEvidenceMetricDelta(
  baseline: ParallelEvidenceMetricsV1,
  current: ParallelEvidenceMetricsV1,
): ParallelEvidenceMetricDeltaV1 {
  const baselineValues = flattenParallelEvidenceMetrics(baseline)
  const currentValues = flattenParallelEvidenceMetrics(current)
  const keys = [...new Set([...Object.keys(baselineValues), ...Object.keys(currentValues)])].sort()
  const values = Object.fromEntries(keys.map(key => {
    const baselineValue = baselineValues[key] ?? 0
    const currentValue = currentValues[key] ?? 0
    return [key, { baseline: baselineValue, current: currentValue, delta: currentValue - baselineValue }]
  }))
  return {
    schemaVersion: 'oa-sdk.parallel-evidence-metric-delta.v1',
    baselineSchemaVersion: baseline.schemaVersion,
    changed: keys.some(key => (baselineValues[key] ?? 0) !== (currentValues[key] ?? 0)),
    values,
  }
}

export function createParallelEvidenceReport(input: {
  evidence: ParallelEvidenceV1
  baseline?: ParallelEvidenceMetricsV1
}): ParallelEvidenceReportV1 {
  return {
    schemaVersion: PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION,
    evidence: input.evidence,
    metrics: input.evidence.metrics,
    ...(input.baseline === undefined
      ? {}
      : { baseline: createParallelEvidenceMetricDelta(input.baseline, input.evidence.metrics) }),
  }
}

/** Parse only the producer invariants needed at the cross-repository boundary. */
export function parseTypeSpecRefProvenance(value: unknown): TypeSpecRefProvenanceV1 {
  const record = requiredRecord(value, 'TypeSpec provenance artifact')
  if (record.schemaVersion !== 'oa-sdk.typespec-ref-provenance.v1') {
    throw new Error(`Unsupported TypeSpec provenance schema: ${String(record.schemaVersion)}`)
  }
  if (record.provenanceKind !== 'typespec-source-ast') {
    throw new Error(`Unsupported TypeSpec provenance kind: ${String(record.provenanceKind)}`)
  }
  requiredArray(record.declarations, 'TypeSpec provenance declarations')
  requiredArray(record.edges, 'TypeSpec provenance edges')
  return record as unknown as TypeSpecRefProvenanceV1
}

/** Parse only the producer invariants needed at the cross-repository boundary. */
export function parseTtscContractProvenance(value: unknown): TtscContractProvenanceV2 {
  const record = requiredRecord(value, 'ttsc provenance artifact')
  if (record.schemaVersion !== 'ttsc-contract-provenance.v2') {
    throw new Error(`Unsupported ttsc provenance schema: ${String(record.schemaVersion)}`)
  }
  requiredRecord(record.inputs, 'ttsc provenance inputs')
  requiredArray(record.declarations, 'ttsc provenance declarations')
  requiredArray(record.edges, 'ttsc provenance edges')
  return record as unknown as TtscContractProvenanceV2
}

/** Accept either a metrics artifact or a complete prior parallel-evidence report. */
export function parseParallelEvidenceMetrics(value: unknown): ParallelEvidenceMetricsV1 {
  const record = requiredRecord(value, 'parallel evidence metrics')
  if (record.schemaVersion === PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION) return assertParallelEvidenceMetrics(record)
  if (record.schemaVersion === PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION) {
    const metrics = requiredRecord(record.metrics, 'parallel evidence report metrics')
    if (metrics.schemaVersion === PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION) return assertParallelEvidenceMetrics(metrics)
  }
  throw new Error(`Unsupported parallel evidence metrics schema: ${String(record.schemaVersion)}`)
}

function normalizeContractDeclaration(declaration: TypeSpecRefProvenanceV1['declarations'][number]): ParallelEvidenceDeclaration {
  return {
    sourceId: 'typespec',
    role: 'contract-authority',
    declarationId: declaration.id,
    kind: declaration.kind,
    symbol: declaration.symbol,
    source: declaration.source,
  }
}

function normalizeImplementationDeclaration(declaration: TtscContractProvenanceV2['declarations'][number]): ParallelEvidenceDeclaration {
  return {
    sourceId: 'ttsc',
    role: 'implementation-observation',
    declarationId: declaration.id,
    kind: declaration.kind,
    symbol: declaration.symbol,
    source: declaration.source,
    observations: {
      astKind: declaration.astKind,
      ...(declaration.shape ? { typeShape: declaration.shape } : {}),
    },
  }
}

function pointerSubjectId(pointer: string): `openapi-pointer:${string}` {
  return `openapi-pointer:${pointer}`
}

function compareDeclarations(left: ParallelEvidenceDeclaration, right: ParallelEvidenceDeclaration): number {
  return `${left.sourceId}:${left.declarationId}`.localeCompare(`${right.sourceId}:${right.declarationId}`)
}

function compareRelations(left: ParallelEvidenceRelation, right: ParallelEvidenceRelation): number {
  return stableStringify(left).localeCompare(stableStringify(right))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function assertParallelEvidenceMetrics(record: Record<string, unknown>): ParallelEvidenceMetricsV1 {
  const pointers = requiredRecord(record.pointers, 'parallel evidence metrics pointers')
  const declarations = requiredRecord(record.declarations, 'parallel evidence metrics declarations')
  const relations = requiredRecord(record.relations, 'parallel evidence metrics relations')
  const implementationShapes = requiredRecord(record.implementationShapes, 'parallel evidence metrics implementationShapes')
  for (const key of ['contract', 'implementation', 'union', 'matched'] as const) readMetricNumber(pointers, key, { integer: true })
  for (const key of ['contractCoverageRatio', 'implementationCoverageRatio', 'unionCoverageRatio'] as const) {
    const value = readMetricNumber(pointers, key)
    if (value > 1) throw new Error(`parallel evidence metrics pointers.${key} must be at most 1`)
  }
  for (const key of ['contractTotal', 'contractEmitting', 'implementationTotal', 'implementationEmitting', 'implementationShapeAnnotated'] as const) {
    readMetricNumber(declarations, key, { integer: true })
  }
  for (const key of ['contractTotal', 'implementationTotal', 'contractTargetResolved', 'implementationTargetResolved'] as const) {
    readMetricNumber(relations, key, { integer: true })
  }
  for (const key of ['direct', 'policyRequired', 'unsupported', 'unclassified'] as const) {
    readMetricNumber(implementationShapes, key, { integer: true })
  }
  const features = requiredRecord(implementationShapes.features, 'parallel evidence metrics implementationShapes.features')
  for (const [name, count] of Object.entries(features)) {
    if (name.length === 0 || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`parallel evidence metrics implementationShapes.features.${name} must be a non-negative integer`)
    }
  }
  return record as unknown as ParallelEvidenceMetricsV1
}

function readMetricNumber(
  record: Record<string, unknown>,
  key: string,
  options: { integer?: boolean } = {},
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (options.integer === true && !Number.isSafeInteger(value))) {
    throw new Error(`parallel evidence metrics ${key} must be a non-negative${options.integer === true ? ' integer' : ' number'}`)
  }
  return value
}

function flattenParallelEvidenceMetrics(metrics: ParallelEvidenceMetricsV1): Record<string, number> {
  return {
    'pointers.contract': metrics.pointers.contract,
    'pointers.implementation': metrics.pointers.implementation,
    'pointers.union': metrics.pointers.union,
    'pointers.matched': metrics.pointers.matched,
    'pointers.contractCoverageRatio': metrics.pointers.contractCoverageRatio,
    'pointers.implementationCoverageRatio': metrics.pointers.implementationCoverageRatio,
    'pointers.unionCoverageRatio': metrics.pointers.unionCoverageRatio,
    'declarations.contractTotal': metrics.declarations.contractTotal,
    'declarations.contractEmitting': metrics.declarations.contractEmitting,
    'declarations.implementationTotal': metrics.declarations.implementationTotal,
    'declarations.implementationEmitting': metrics.declarations.implementationEmitting,
    'declarations.implementationShapeAnnotated': metrics.declarations.implementationShapeAnnotated,
    'relations.contractTotal': metrics.relations.contractTotal,
    'relations.implementationTotal': metrics.relations.implementationTotal,
    'relations.contractTargetResolved': metrics.relations.contractTargetResolved,
    'relations.implementationTargetResolved': metrics.relations.implementationTargetResolved,
    'implementationShapes.direct': metrics.implementationShapes.direct,
    'implementationShapes.policyRequired': metrics.implementationShapes.policyRequired,
    'implementationShapes.unsupported': metrics.implementationShapes.unsupported,
    'implementationShapes.unclassified': metrics.implementationShapes.unclassified,
    ...Object.fromEntries(Object.entries(metrics.implementationShapes.features).map(([feature, count]) => [`implementationShapes.features.${feature}`, count])),
  }
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}
