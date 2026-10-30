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

export interface TestDefinitionV1 {
  readonly definitionId: string
  readonly target: ExactRefV1
  readonly claim: ExactRefV1
  readonly criterion: ExactRefV1
  readonly method: ExactRefV1
  readonly dataset: ExactRefV1
  readonly criterionCombination: 'all' | 'any'
}

export interface DefinitionV1 {
  readonly ref: ExactRefV1
  readonly dependencies: readonly ExactRefV1[]
  readonly body: JsonValue
}

export interface LockedPlanV1 {
  readonly planId: string
  readonly definitions: readonly DefinitionV1[]
  readonly bindings: readonly { readonly requested: ExactRefV1; readonly resolved: ExactRefV1 }[]
  readonly resolver: ExactRefV1
  readonly profiles: readonly { readonly id: string; readonly revision: string }[]
  readonly requiredCapabilities: readonly string[]
  readonly requireInitializationObservation: boolean
  readonly concurrency: 'serial' | 'concurrent'
  readonly closePolicy: {
    readonly normal: { readonly inFlight: 'drain' | 'cancel'; readonly budgetMs: number }
    readonly cancel: { readonly inFlight: 'drain' | 'cancel'; readonly budgetMs: number }
    readonly error: { readonly inFlight: 'drain' | 'cancel'; readonly budgetMs: number }
  }
  readonly selection: JsonValue
  readonly applications: readonly { readonly criterion: ExactRefV1; readonly scope: string; readonly purpose: string; readonly status: 'accepted' | 'candidate'; readonly basis: string }[]
}

export interface EvaluationV1 {
  readonly evaluationId: string
  readonly evidenceId: string
  readonly runId: string
  readonly criterion: ExactRefV1
  readonly evaluator: ExactRefV1
  readonly profile: { readonly id: string; readonly revision: string }
  readonly requests: readonly {
    readonly requestId: string
    readonly started: CriterionResultV1
    readonly terminal: CriterionResultV1
    readonly order: CriterionResultV1
  }[]
  readonly verdict: VerdictV1
  readonly coverage: { readonly minimum: number; readonly applicable: number; readonly met: boolean }
  readonly issues: readonly EvidenceIssueV1[]
}

export type VerdictV1 = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_APPLICABLE' | 'ERROR'
export interface CriterionResultV1 {
  readonly verdict: VerdictV1
  readonly reasonCodes: readonly string[]
  readonly witnesses: readonly OccurrenceRefV1[]
  readonly evidenceSufficient: boolean
}
export interface EvidenceIssueV1 extends DiagnosticV1 {
  readonly occurrences?: readonly OccurrenceRefV1[]
}
