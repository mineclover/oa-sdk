import { RUN_EVIDENCE_V1_DECLARATION, RUN_EVIDENCE_V1_FTP_MAPPING_REF, RUN_EVIDENCE_V1_FTP_TARGET } from './refs.js'
import type { CoverageV1, DiagnosticV1, ObservationV1, RunEvidenceV1 } from './types.js'

export interface RunEvidenceMappingEntry {
  /** JSON Pointer into the declaration instance; `*` stands for any array index. */
  readonly wire: string
  /** FTP semantic role the field carries. */
  readonly ftp: string
  /** Portable contract clauses that give the role its meaning. */
  readonly clauses: readonly string[]
}

const entry = (wire: string, ftp: string, ...clauses: string[]): RunEvidenceMappingEntry =>
  Object.freeze({ wire, ftp, clauses: Object.freeze(clauses) })

/**
 * Field correspondence for `oa-sdk.ftp/run-evidence.ftp-core` revision 1.
 * Every declared property appears exactly once; the mapping adds no defaults.
 */
export const RUN_EVIDENCE_V1_FTP_MAPPING = Object.freeze({
  ref: RUN_EVIDENCE_V1_FTP_MAPPING_REF,
  declaration: RUN_EVIDENCE_V1_DECLARATION,
  target: RUN_EVIDENCE_V1_FTP_TARGET,
  entries: Object.freeze([
    entry('/evidenceId', 'RunEvidence.evidenceId', 'EVD-06'),
    entry('/runId', 'RunEvidence.runId (Run unit)', 'RUN-01'),
    entry('/planId', 'RunEvidence.planId (LockedPlan identity)', 'REF-03'),
    entry('/retryOfRunId', 'RunEvidence.retryOfRunId (full rerun lineage)', 'RUN-01'),
    entry('/executionStatus', 'RunEvidence.executionStatus (execution fact, not a verdict)', 'EVD-04', 'EVAL-04'),
    entry('/observations', 'RunEvidence.observations (delivery records)', 'EVD-01'),
    entry('/observations/*/observationId', 'Observation.observationId (delivery identity)', 'EVD-01'),
    entry('/observations/*/sourceId', 'OccurrenceRef.sourceId (occurrence key)', 'EVD-01'),
    entry('/observations/*/occurrenceId', 'OccurrenceRef.occurrenceId (occurrence key)', 'EVD-01'),
    entry('/observations/*/point', 'Observation.point (ObservationPoint ExactRef)', 'REF-02', 'EVD-02'),
    entry('/observations/*/point/kind', 'ExactRef.kind', 'REF-02'),
    entry('/observations/*/point/namespace', 'ExactRef.namespace', 'REF-02'),
    entry('/observations/*/point/id', 'ExactRef.id', 'REF-02'),
    entry('/observations/*/point/revision', 'ExactRef.revision', 'REF-01', 'REF-02'),
    entry('/observations/*/requestId', 'Observation.requestId (domain request)', 'RUN-01'),
    entry('/observations/*/invocationId', 'Observation.invocationId (invocation)', 'RUN-01'),
    entry('/observations/*/unit', 'Observation.unit (request or domain attempt)', 'RUN-01'),
    entry('/observations/*/domainAttemptId', 'Observation.domainAttemptId (domain attempt)', 'RUN-01'),
    entry('/observations/*/type', 'Observation.type (event kind)', 'EVD-02', 'LIFE-01', 'LIFE-02', 'LIFE-03'),
    entry('/observations/*/payload', 'Observation.payload (point-defined content)', 'EVD-02', 'WIRE-03'),
    entry('/observations/*/order', 'Observation.order (declared ordering basis)', 'EVD-03'),
    entry('/observations/*/order/streamId', 'Observation.order.streamId (logical stream)', 'EVD-03'),
    entry('/observations/*/order/sequence', 'Observation.order.sequence (exact integer string)', 'EVD-03', 'WIRE-01'),
    entry('/observations/*/causedBy', 'Observation.causedBy (causal references)', 'EVD-03'),
    entry('/observations/*/causedBy/*/sourceId', 'OccurrenceRef.sourceId', 'EVD-01', 'EVD-03'),
    entry('/observations/*/causedBy/*/occurrenceId', 'OccurrenceRef.occurrenceId', 'EVD-01', 'EVD-03'),
    entry('/observations/*/receivedAt', 'Observation.receivedAt (delivery time, excluded from conflicts)', 'WIRE-02', 'EVD-02'),
    entry('/observations/*/traceId', 'Observation.traceId (trace link, excluded from conflicts)', 'EVD-02'),
    entry('/coverage', 'RunEvidence.coverage (per-scope quality)', 'EVD-04'),
    entry('/coverage/*/sourceId', 'ObservationRequirement.sourceId', 'EVD-04', 'LIFE-04'),
    entry('/coverage/*/requestId', 'ObservationRequirement.requestId', 'EVD-04', 'LIFE-04'),
    entry('/coverage/*/point', 'ObservationRequirement.point (ObservationPoint ExactRef)', 'REF-02', 'EVD-04'),
    entry('/coverage/*/point/kind', 'ExactRef.kind', 'REF-02'),
    entry('/coverage/*/point/namespace', 'ExactRef.namespace', 'REF-02'),
    entry('/coverage/*/point/id', 'ExactRef.id', 'REF-02'),
    entry('/coverage/*/point/revision', 'ExactRef.revision', 'REF-01', 'REF-02'),
    entry('/coverage/*/unit', 'ObservationRequirement.unit', 'RUN-01', 'LIFE-04'),
    entry('/coverage/*/startBoundary', 'ObservationRequirement.startBoundary (named boundary)', 'EVD-04'),
    entry('/coverage/*/endBoundary', 'ObservationRequirement.endBoundary (named boundary)', 'EVD-04', 'EVD-05'),
    entry('/coverage/*/closure', 'Coverage.closure', 'EVD-04'),
    entry('/coverage/*/loss', 'Coverage.loss', 'EVD-04'),
    entry('/coverage/*/lossBasis', 'Coverage.lossBasis (completeness basis)', 'EVD-04'),
    entry('/diagnostics', 'RunEvidence.diagnostics (component and integrity issues)', 'EVAL-04'),
    entry('/diagnostics/*/code', 'Diagnostic.code', 'EVAL-04'),
    entry('/diagnostics/*/component', 'Diagnostic.component', 'RUN-02', 'EVAL-04'),
    entry('/diagnostics/*/message', 'Diagnostic.message (non-normative text)', 'EVAL-03'),
    entry('/diagnostics/*/requestIds', 'Diagnostic.requestIds (affected requests)', 'EVAL-04'),
    entry('/diagnostics/*/requestIds/*', 'Diagnostic.requestIds item', 'EVAL-04'),
  ]),
})

/** Copy only fields that are present; the mapping never invents absent values. */
function present<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {}
  for (const key of keys) if (Object.hasOwn(source, key)) result[key] = source[key]
  return result
}

function projectObservation(observation: ObservationV1): ObservationV1 {
  return {
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    occurrenceId: observation.occurrenceId,
    point: { ...observation.point },
    requestId: observation.requestId,
    unit: observation.unit,
    type: observation.type,
    ...present(observation, ['invocationId', 'domainAttemptId', 'payload', 'receivedAt', 'traceId']),
    ...(observation.order === undefined ? {} : { order: { ...observation.order } }),
    ...(observation.causedBy === undefined ? {} : { causedBy: observation.causedBy.map(cause => ({ ...cause })) }),
  }
}

function projectCoverage(coverage: CoverageV1): CoverageV1 {
  return {
    sourceId: coverage.sourceId,
    requestId: coverage.requestId,
    point: { ...coverage.point },
    unit: coverage.unit,
    startBoundary: coverage.startBoundary,
    endBoundary: coverage.endBoundary,
    closure: coverage.closure,
    loss: coverage.loss,
    ...present(coverage, ['lossBasis']),
  }
}

function projectDiagnostic(diagnostic: DiagnosticV1): DiagnosticV1 {
  return {
    code: diagnostic.code,
    component: diagnostic.component,
    message: diagnostic.message,
    ...(diagnostic.requestIds === undefined ? {} : { requestIds: [...diagnostic.requestIds] }),
  }
}

/**
 * Apply mapping revision 1 to a validated artifact. The result is a fresh plain
 * object shaped like FTP's RunEvidence view; it shares no references with input.
 */
export function projectRunEvidenceV1(evidence: RunEvidenceV1): RunEvidenceV1 {
  return {
    evidenceId: evidence.evidenceId,
    runId: evidence.runId,
    planId: evidence.planId,
    ...present(evidence, ['retryOfRunId']),
    observations: evidence.observations.map(projectObservation),
    coverage: evidence.coverage.map(projectCoverage),
    diagnostics: evidence.diagnostics.map(projectDiagnostic),
    executionStatus: evidence.executionStatus,
  }
}
