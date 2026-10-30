import { EVALUATION_V1_DECLARATION, EVALUATION_V1_FTP_MAPPING_REF, LOCKED_PLAN_V1_DECLARATION, LOCKED_PLAN_V1_FTP_MAPPING_REF, TEST_DEFINITION_V1_DECLARATION, TEST_DEFINITION_V1_FTP_MAPPING_REF } from './refs.js'
import type { EvaluationV1, LockedPlanV1, TestDefinitionV1 } from './types.js'

export interface LifecycleMappingEntry { readonly wire: string; readonly ftp: string; readonly clauses: readonly string[] }
const entry = (wire: string, ftp: string, ...clauses: string[]): LifecycleMappingEntry => Object.freeze({ wire, ftp, clauses: Object.freeze(clauses) })

export const TEST_DEFINITION_V1_FTP_MAPPING = Object.freeze({
  ref: TEST_DEFINITION_V1_FTP_MAPPING_REF,
  declaration: TEST_DEFINITION_V1_DECLARATION,
  target: Object.freeze({ contract: Object.freeze({ path: 'docs/portable-contract-v0.1.md', revision: '0.1' }), profiles: Object.freeze([{ id: 'core', revision: '0.1' }]) }),
  entries: Object.freeze([
    entry('/definitionId', 'TestDefinition identity', 'REF-01'),
    entry('/target', 'TestDefinition.target', 'REF-02'),
    entry('/claim', 'TestDefinition.claim', 'REF-02'),
    entry('/criterion', 'TestDefinition.criterion', 'REF-02'),
    entry('/method', 'TestDefinition.method', 'REF-02'),
    entry('/dataset', 'TestDefinition.dataset', 'REF-02'),
    entry('/criterionCombination', 'TestDefinition criterion combination rule', 'REF-03'),
  ]),
})

export const LOCKED_PLAN_V1_FTP_MAPPING = Object.freeze({
  ref: LOCKED_PLAN_V1_FTP_MAPPING_REF,
  declaration: LOCKED_PLAN_V1_DECLARATION,
  target: Object.freeze({ contract: Object.freeze({ path: 'docs/portable-contract-v0.1.md', revision: '0.1' }), profiles: Object.freeze([Object.freeze({ id: 'core', revision: '0.1' }), Object.freeze({ id: 'execution', revision: '0.1' })]) }),
  entries: Object.freeze([
    entry('/planId', 'LockedPlan.planId', 'REF-03'), entry('/definitions', 'LockedPlan.definitions', 'REF-03'), entry('/bindings', 'LockedPlan.bindings', 'REF-03'), entry('/resolver', 'LockedPlan.resolver', 'REF-03'), entry('/profiles', 'LockedPlan.profiles', 'REF-03'), entry('/requiredCapabilities', 'LockedPlan.requiredCapabilities', 'EXEC-01'), entry('/requireInitializationObservation', 'LockedPlan.requireInitializationObservation', 'EXEC-02'), entry('/concurrency', 'LockedPlan.concurrency', 'EXEC-04'), entry('/closePolicy', 'LockedPlan.closePolicy', 'EXEC-03'), entry('/selection', 'LockedPlan.selection', 'REF-03'), entry('/applications', 'LockedPlan.applications', 'REF-04'),
  ]),
})

export const EVALUATION_V1_FTP_MAPPING = Object.freeze({
  ref: EVALUATION_V1_FTP_MAPPING_REF,
  declaration: EVALUATION_V1_DECLARATION,
  target: Object.freeze({ contract: Object.freeze({ path: 'docs/portable-contract-v0.1.md', revision: '0.1' }), profiles: Object.freeze([{ id: 'request-lifecycle', revision: '0.1' }]) }),
  entries: Object.freeze([
    entry('/evaluationId', 'Evaluation.evaluationId', 'EVD-06'), entry('/evidenceId', 'Evaluation.evidenceId', 'EVD-06'), entry('/runId', 'Evaluation.runId', 'RUN-01'), entry('/criterion', 'Evaluation.criterion', 'EVAL-01'), entry('/evaluator', 'Evaluation.evaluator', 'EVAL-01'), entry('/profile', 'Evaluation.profile', 'EVAL-01'), entry('/requests', 'Evaluation.requests', 'EVAL-01'), entry('/verdict', 'Evaluation.verdict', 'EVAL-04'), entry('/coverage', 'Evaluation.coverage', 'EVD-04'), entry('/issues', 'Evaluation.issues', 'EVAL-04'),
  ]),
})

const clone = <T>(input: T): T => structuredClone(input)
export function projectTestDefinitionV1(value: TestDefinitionV1): TestDefinitionV1 { return clone(value) }
export function projectLockedPlanV1(value: LockedPlanV1): LockedPlanV1 { return clone(value) }
export function projectEvaluationV1(value: EvaluationV1): EvaluationV1 { return clone(value) }
