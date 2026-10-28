/**
 * Wire types for `oa-sdk.ftp/run-evidence` revision 1. They mirror the bundled
 * JSON Schema and are not FTP engine types: FTP consumes them through the
 * versioned semantic mapping.
 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface ExactRefV1 {
  readonly kind: string
  readonly namespace: string
  readonly id: string
  readonly revision: string
}

export interface OccurrenceRefV1 {
  readonly sourceId: string
  readonly occurrenceId: string
}

export type ObservationUnitV1 = 'request' | 'attempt'

export interface ObservationV1 extends OccurrenceRefV1 {
  readonly observationId: string
  readonly point: ExactRefV1
  readonly requestId: string
  readonly invocationId?: string
  readonly unit: ObservationUnitV1
  /** Required when `unit` is `attempt`. */
  readonly domainAttemptId?: string
  readonly type: string
  readonly payload?: JsonValue
  readonly order?: { readonly streamId: string; readonly sequence: string }
  readonly causedBy?: readonly OccurrenceRefV1[]
  readonly receivedAt?: string
  readonly traceId?: string
}

export interface CoverageV1 {
  readonly sourceId: string
  readonly requestId: string
  readonly point: ExactRefV1
  readonly unit: ObservationUnitV1
  readonly startBoundary: string
  readonly endBoundary: string
  readonly closure: 'closed' | 'open' | 'unknown'
  readonly loss: 'none' | 'known' | 'unknown'
  readonly lossBasis?: string
}

export interface DiagnosticV1 {
  readonly code: string
  readonly component: string
  readonly message: string
  readonly requestIds?: readonly string[]
}

export interface RunEvidenceV1 {
  readonly evidenceId: string
  readonly runId: string
  readonly planId: string
  readonly retryOfRunId?: string
  readonly observations: readonly ObservationV1[]
  readonly coverage: readonly CoverageV1[]
  readonly diagnostics: readonly DiagnosticV1[]
  readonly executionStatus: 'COMPLETED' | 'INTERRUPTED' | 'ERROR'
}
