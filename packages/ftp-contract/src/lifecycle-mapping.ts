import {
  EVALUATION_V1_DECLARATION,
  EVALUATION_V1_FTP_MAPPING_REF,
  EVALUATION_V1_FTP_TARGET,
  LOCKED_PLAN_V1_DECLARATION,
  LOCKED_PLAN_V1_FTP_MAPPING_REF,
  LOCKED_PLAN_V1_FTP_TARGET,
  TEST_DEFINITION_V1_DECLARATION,
  TEST_DEFINITION_V1_FTP_MAPPING_REF,
  TEST_DEFINITION_V1_FTP_TARGET,
  TEST_DEFINITION_V2_DECLARATION,
  TEST_DEFINITION_V2_FTP_MAPPING_REF,
  TEST_DEFINITION_V2_FTP_TARGET,
} from './refs.js'
import type {
  CloseBranchV1,
  ClosePolicyV1,
  CriterionApplicationV1,
  CriterionResultV1,
  DefinitionRefV1,
  DefinitionV1,
  EvaluationV1,
  EvidenceIssueV1,
  ExactRefV1,
  JsonValue,
  LifecycleRequestResultV1,
  LockedPlanBindingV1,
  LockedPlanV1,
  OccurrenceRefV1,
  ProfileRefV1,
  TestDefinitionV1,
  TestDefinitionV2,
} from './types.js'

export interface LifecycleMappingEntry {
  readonly wire: string
  readonly ftp: string
  readonly clauses: readonly string[]
}

const entry = (wire: string, ftp: string, ...clauses: string[]): LifecycleMappingEntry =>
  Object.freeze({ wire, ftp, clauses: Object.freeze(clauses) })

function exactRefEntries(prefix: string, role: string, ...clauses: string[]): LifecycleMappingEntry[] {
  return [
    entry(prefix, role, ...clauses),
    entry(`${prefix}/kind`, 'ExactRef.kind', 'REF-02'),
    entry(`${prefix}/namespace`, 'ExactRef.namespace', 'REF-02'),
    entry(`${prefix}/id`, 'ExactRef.id', 'REF-02'),
    entry(`${prefix}/revision`, 'ExactRef.revision', 'REF-01', 'REF-02'),
  ]
}

function definitionRefEntries(
  prefix: string,
  role: string | null,
  ...clauses: string[]
): LifecycleMappingEntry[] {
  return [
    ...(role === null ? [] : [entry(prefix, role, ...clauses)]),
    entry(`${prefix}/kind`, 'DefinitionRef.kind (ExactRef or AliasRef)', 'REF-02'),
    entry(`${prefix}/namespace`, 'ExactRef.namespace', 'REF-02'),
    entry(`${prefix}/id`, 'ExactRef.id', 'REF-02'),
    entry(`${prefix}/revision`, 'ExactRef.revision', 'REF-01', 'REF-02'),
    entry(`${prefix}/scope`, 'AliasRef.scope', 'REF-02'),
    entry(`${prefix}/alias`, 'AliasRef.alias', 'REF-02'),
  ]
}

function criterionResultEntries(prefix: string, role: string, ...clauses: string[]): LifecycleMappingEntry[] {
  return [
    entry(prefix, role, ...clauses),
    entry(`${prefix}/verdict`, 'CriterionResult.verdict', 'EVAL-02', ...clauses),
    entry(`${prefix}/reasonCodes`, 'CriterionResult.reasonCodes', 'EVAL-03', 'LIFE-05'),
    entry(`${prefix}/reasonCodes/*`, 'CriterionResult.reasonCodes item', 'EVAL-03', 'LIFE-05'),
    entry(`${prefix}/witnesses`, 'CriterionResult.witnesses', 'EVAL-03', 'EVD-01'),
    entry(`${prefix}/witnesses/*/sourceId`, 'OccurrenceRef.sourceId', 'EVD-01'),
    entry(`${prefix}/witnesses/*/occurrenceId`, 'OccurrenceRef.occurrenceId', 'EVD-01'),
    entry(`${prefix}/evidenceSufficient`, 'CriterionResult.evidenceSufficient', 'EVAL-02', 'EVD-04'),
  ]
}

export const TEST_DEFINITION_V1_FTP_MAPPING = Object.freeze({
  ref: TEST_DEFINITION_V1_FTP_MAPPING_REF,
  declaration: TEST_DEFINITION_V1_DECLARATION,
  target: TEST_DEFINITION_V1_FTP_TARGET,
  entries: Object.freeze([
    entry('/definitionId', 'TestDefinition identity', 'REF-01'),
    ...exactRefEntries('/target', 'TestDefinition.target (Target ExactRef)', 'REF-02'),
    ...exactRefEntries('/claim', 'TestDefinition.claim (Claim ExactRef)', 'REF-02'),
    ...exactRefEntries('/criterion', 'TestDefinition.criterion (single Criterion ExactRef)', 'REF-02'),
    ...exactRefEntries('/method', 'TestDefinition.method (Method ExactRef)', 'REF-02'),
    ...exactRefEntries('/dataset', 'TestDefinition.dataset (Dataset ExactRef)', 'REF-02'),
    entry('/criterionCombination', 'TestDefinition criterion combination rule', 'REF-03'),
  ]),
})

export const TEST_DEFINITION_V2_FTP_MAPPING = Object.freeze({
  ref: TEST_DEFINITION_V2_FTP_MAPPING_REF,
  declaration: TEST_DEFINITION_V2_DECLARATION,
  target: TEST_DEFINITION_V2_FTP_TARGET,
  entries: Object.freeze([
    entry('/definitionId', 'TestDefinition identity', 'REF-01'),
    ...definitionRefEntries('/target', 'TestDefinition.target (Target DefinitionRef)', 'REF-02'),
    ...definitionRefEntries('/claim', 'TestDefinition.claim (Claim DefinitionRef)', 'REF-02'),
    entry('/criteria', 'TestDefinition.criteria (non-empty Criterion DefinitionRef list)', 'REF-02'),
    ...definitionRefEntries('/criteria/*', null, 'REF-02'),
    ...definitionRefEntries('/method', 'TestDefinition.method (Method DefinitionRef)', 'REF-02'),
    ...definitionRefEntries('/dataset', 'TestDefinition.dataset (Dataset DefinitionRef)', 'REF-02'),
    entry('/criterionCombination', 'TestDefinition explicit criterion combination rule', 'REF-03'),
    entry('/description', 'TestDefinition non-normative description', 'REF-01'),
  ]),
})

export const LOCKED_PLAN_V1_FTP_MAPPING = Object.freeze({
  ref: LOCKED_PLAN_V1_FTP_MAPPING_REF,
  declaration: LOCKED_PLAN_V1_DECLARATION,
  target: LOCKED_PLAN_V1_FTP_TARGET,
  entries: Object.freeze([
    entry('/planId', 'LockedPlan.planId', 'REF-03'),
    entry('/definitions', 'LockedPlan.definitions (resolved closure)', 'REF-03'),
    ...exactRefEntries('/definitions/*/ref', 'Definition.ref (resolved ExactRef)', 'REF-02', 'REF-03'),
    entry('/definitions/*/dependencies', 'Definition.dependencies', 'REF-02', 'REF-03'),
    ...definitionRefEntries('/definitions/*/dependencies/*', null, 'REF-02', 'REF-03'),
    entry('/definitions/*/body', 'Definition.body (immutable definition payload)', 'REF-03', 'WIRE-03'),
    entry('/bindings', 'LockedPlan.bindings (requested-to-resolved bindings)', 'REF-02', 'REF-03'),
    ...definitionRefEntries('/bindings/*/requested', 'Binding.requested (requested DefinitionRef)', 'REF-02', 'REF-03'),
    ...exactRefEntries('/bindings/*/resolved', 'Binding.resolved (locked ExactRef)', 'REF-02', 'REF-03'),
    ...exactRefEntries('/resolver', 'LockedPlan.resolver (DefinitionResolver ExactRef)', 'REF-01', 'REF-03'),
    entry('/profiles', 'LockedPlan.profiles (required semantic profiles)', 'REF-01', 'REF-03'),
    entry('/profiles/*/id', 'ProfileRef.id', 'REF-01'),
    entry('/profiles/*/revision', 'ProfileRef.revision', 'REF-01'),
    entry('/requiredCapabilities', 'LockedPlan.requiredCapabilities', 'RUN-02', 'EXEC-01'),
    entry('/requiredCapabilities/*', 'LockedPlan.requiredCapabilities item', 'RUN-02', 'EXEC-01'),
    entry('/requireInitializationObservation', 'LockedPlan.requireInitializationObservation', 'EXEC-02'),
    entry('/concurrency', 'LockedPlan.concurrency', 'EXEC-04'),
    entry('/closePolicy', 'LockedPlan.closePolicy', 'EXEC-03'),
    entry('/closePolicy/normal', 'ClosePolicy.normal', 'EXEC-03'),
    entry('/closePolicy/normal/inFlight', 'CloseBranch.inFlight (normal close)', 'EXEC-03'),
    entry('/closePolicy/normal/budgetMs', 'CloseBranch.budgetMs (normal close)', 'EXEC-03'),
    entry('/closePolicy/cancel', 'ClosePolicy.cancel', 'EXEC-03', 'EXEC-04'),
    entry('/closePolicy/cancel/inFlight', 'CloseBranch.inFlight (cancel close)', 'EXEC-03', 'EXEC-04'),
    entry('/closePolicy/cancel/budgetMs', 'CloseBranch.budgetMs (cancel close)', 'EXEC-03', 'EXEC-04'),
    entry('/closePolicy/error', 'ClosePolicy.error', 'EXEC-03'),
    entry('/closePolicy/error/inFlight', 'CloseBranch.inFlight (error close)', 'EXEC-03'),
    entry('/closePolicy/error/budgetMs', 'CloseBranch.budgetMs (error close)', 'EXEC-03'),
    entry('/selection', 'LockedPlan.selection (locked dataset/request selection)', 'REF-03', 'WIRE-03'),
    entry('/applications', 'LockedPlan.applications (criterion adoption context)', 'REF-04'),
    ...exactRefEntries('/applications/*/criterion', 'ApplicationDecision.criterion (locked Criterion ExactRef)', 'REF-04'),
    entry('/applications/*/scope', 'ApplicationDecision.scope', 'REF-04'),
    entry('/applications/*/purpose', 'ApplicationDecision.purpose', 'REF-04'),
    entry('/applications/*/status', 'ApplicationDecision.status (accepted or candidate)', 'REF-04', 'EVAL-04'),
    entry('/applications/*/basis', 'ApplicationDecision.basis', 'REF-04'),
  ]),
})

export const EVALUATION_V1_FTP_MAPPING = Object.freeze({
  ref: EVALUATION_V1_FTP_MAPPING_REF,
  declaration: EVALUATION_V1_DECLARATION,
  target: EVALUATION_V1_FTP_TARGET,
  entries: Object.freeze([
    entry('/evaluationId', 'LifecycleEvaluation.evaluationId', 'EVD-06', 'EVAL-03'),
    entry('/evidenceId', 'LifecycleEvaluation.evidenceId (sealed RunEvidence identity)', 'EVD-06'),
    entry('/runId', 'LifecycleEvaluation.runId (Run unit)', 'RUN-01', 'EVD-06'),
    ...exactRefEntries('/criterion', 'LifecycleEvaluation.criterion (evaluated Criterion ExactRef)', 'REF-01', 'EVAL-03'),
    ...exactRefEntries('/evaluator', 'LifecycleEvaluation.evaluator (evaluator implementation ExactRef)', 'REF-01', 'EVAL-03'),
    entry('/profile', 'LifecycleEvaluation.profile', 'REF-01', 'EVAL-03'),
    entry('/profile/id', 'ProfileRef.id', 'REF-01'),
    entry('/profile/revision', 'ProfileRef.revision', 'REF-01'),
    entry('/requests', 'LifecycleEvaluation.requests (per-obligation results)', 'EVAL-01', 'LIFE-05'),
    entry('/requests/*/requestId', 'LifecycleRequestResult.requestId (obligation subject)', 'EVAL-01'),
    ...criterionResultEntries('/requests/*/started', 'LifecycleRequestResult.started', 'LIFE-01'),
    ...criterionResultEntries('/requests/*/terminal', 'LifecycleRequestResult.terminal', 'LIFE-02'),
    ...criterionResultEntries('/requests/*/order', 'LifecycleRequestResult.order', 'LIFE-03'),
    entry('/verdict', 'LifecycleEvaluation.verdict (profile summary verdict)', 'EVAL-02', 'EVAL-04', 'LIFE-05'),
    entry('/coverage', 'LifecycleEvaluation.coverage (obligation coverage summary)', 'LIFE-04', 'EVAL-04'),
    entry('/coverage/minimum', 'CoverageSummary.minimum', 'LIFE-04'),
    entry('/coverage/applicable', 'CoverageSummary.applicable', 'LIFE-04'),
    entry('/coverage/met', 'CoverageSummary.met', 'LIFE-04', 'EVAL-04'),
    entry('/issues', 'LifecycleEvaluation.issues (evidence and ordering issues)', 'EVD-02', 'EVD-03', 'EVAL-04'),
    entry('/issues/*/code', 'EvidenceIssue.code', 'EVD-02', 'EVD-03', 'EVAL-04'),
    entry('/issues/*/component', 'EvidenceIssue.component', 'EVAL-04'),
    entry('/issues/*/message', 'EvidenceIssue.message (non-normative text)', 'EVAL-03'),
    entry('/issues/*/requestIds', 'EvidenceIssue.requestIds', 'EVAL-04'),
    entry('/issues/*/requestIds/*', 'EvidenceIssue.requestIds item', 'EVAL-04'),
    entry('/issues/*/occurrences', 'EvidenceIssue.occurrences (affected occurrences)', 'EVD-01', 'EVD-02'),
    entry('/issues/*/occurrences/*/sourceId', 'OccurrenceRef.sourceId', 'EVD-01'),
    entry('/issues/*/occurrences/*/occurrenceId', 'OccurrenceRef.occurrenceId', 'EVD-01'),
  ]),
})

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function projectExactRef(ref: ExactRefV1): ExactRefV1 {
  return { kind: ref.kind, namespace: ref.namespace, id: ref.id, revision: ref.revision }
}

function projectDefinitionRef(ref: DefinitionRefV1): DefinitionRefV1 {
  return 'namespace' in ref
    ? projectExactRef(ref)
    : { kind: ref.kind, scope: ref.scope, alias: ref.alias }
}

function projectProfile(profile: ProfileRefV1): ProfileRefV1 {
  return { id: profile.id, revision: profile.revision }
}

function projectOccurrenceRef(occurrence: OccurrenceRefV1): OccurrenceRefV1 {
  return { sourceId: occurrence.sourceId, occurrenceId: occurrence.occurrenceId }
}

function projectCloseBranch(branch: CloseBranchV1): CloseBranchV1 {
  return { inFlight: branch.inFlight, budgetMs: branch.budgetMs }
}

function projectClosePolicy(policy: ClosePolicyV1): ClosePolicyV1 {
  return {
    normal: projectCloseBranch(policy.normal),
    cancel: projectCloseBranch(policy.cancel),
    error: projectCloseBranch(policy.error),
  }
}

function projectDefinition(definition: DefinitionV1): DefinitionV1 {
  return {
    ref: projectExactRef(definition.ref),
    dependencies: definition.dependencies.map(projectDefinitionRef),
    body: cloneJsonValue(definition.body),
  }
}

function projectBinding(binding: LockedPlanBindingV1): LockedPlanBindingV1 {
  return {
    requested: projectDefinitionRef(binding.requested),
    resolved: projectExactRef(binding.resolved),
  }
}

function projectApplication(application: CriterionApplicationV1): CriterionApplicationV1 {
  return {
    criterion: projectExactRef(application.criterion),
    scope: application.scope,
    purpose: application.purpose,
    status: application.status,
    basis: application.basis,
  }
}

function projectCriterionResult(result: CriterionResultV1): CriterionResultV1 {
  return {
    verdict: result.verdict,
    reasonCodes: [...result.reasonCodes],
    witnesses: result.witnesses.map(projectOccurrenceRef),
    evidenceSufficient: result.evidenceSufficient,
  }
}

function projectRequestResult(request: LifecycleRequestResultV1): LifecycleRequestResultV1 {
  return {
    requestId: request.requestId,
    started: projectCriterionResult(request.started),
    terminal: projectCriterionResult(request.terminal),
    order: projectCriterionResult(request.order),
  }
}

function projectEvidenceIssue(issue: EvidenceIssueV1): EvidenceIssueV1 {
  return {
    code: issue.code,
    component: issue.component,
    message: issue.message,
    ...(Object.hasOwn(issue, 'requestIds') && issue.requestIds !== undefined
      ? { requestIds: [...issue.requestIds] }
      : {}),
    ...(Object.hasOwn(issue, 'occurrences') && issue.occurrences !== undefined
      ? { occurrences: issue.occurrences.map(projectOccurrenceRef) }
      : {}),
  }
}

export function projectTestDefinitionV1(value: TestDefinitionV1): TestDefinitionV1 {
  return {
    definitionId: value.definitionId,
    target: projectExactRef(value.target),
    claim: projectExactRef(value.claim),
    criterion: projectExactRef(value.criterion),
    method: projectExactRef(value.method),
    dataset: projectExactRef(value.dataset),
    criterionCombination: value.criterionCombination,
  }
}

export function projectTestDefinitionV2(value: TestDefinitionV2): TestDefinitionV2 {
  return {
    definitionId: value.definitionId,
    target: projectDefinitionRef(value.target),
    claim: projectDefinitionRef(value.claim),
    criteria: value.criteria.map(projectDefinitionRef),
    method: projectDefinitionRef(value.method),
    dataset: projectDefinitionRef(value.dataset),
    criterionCombination: value.criterionCombination,
    ...(Object.hasOwn(value, 'description') && value.description !== undefined
      ? { description: value.description }
      : {}),
  }
}

export function projectLockedPlanV1(value: LockedPlanV1): LockedPlanV1 {
  return {
    planId: value.planId,
    definitions: value.definitions.map(projectDefinition),
    bindings: value.bindings.map(projectBinding),
    resolver: projectExactRef(value.resolver),
    profiles: value.profiles.map(projectProfile),
    requiredCapabilities: [...value.requiredCapabilities],
    requireInitializationObservation: value.requireInitializationObservation,
    concurrency: value.concurrency,
    closePolicy: projectClosePolicy(value.closePolicy),
    selection: cloneJsonValue(value.selection),
    applications: value.applications.map(projectApplication),
  }
}

export function projectEvaluationV1(value: EvaluationV1): EvaluationV1 {
  return {
    evaluationId: value.evaluationId,
    evidenceId: value.evidenceId,
    runId: value.runId,
    criterion: projectExactRef(value.criterion),
    evaluator: projectExactRef(value.evaluator),
    profile: projectProfile(value.profile),
    requests: value.requests.map(projectRequestResult),
    verdict: value.verdict,
    coverage: {
      minimum: value.coverage.minimum,
      applicable: value.coverage.applicable,
      met: value.coverage.met,
    },
    issues: value.issues.map(projectEvidenceIssue),
  }
}
