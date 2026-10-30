import { Ajv2020 } from 'ajv/dist/2020.js'
import { readFileSync } from 'node:fs'
import {
  EVALUATION_V1_SCHEMA_PATH,
  LOCKED_PLAN_V1_SCHEMA_PATH,
  TEST_DEFINITION_V1_SCHEMA_PATH,
} from './refs.js'
import type { EvaluationV1, LockedPlanV1, TestDefinitionV1 } from './types.js'

export interface LifecycleArtifactIssue { readonly instancePath: string; readonly keyword: string; readonly message: string }
export type LifecycleValidationResult<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

type Compiled = { (value: unknown): boolean; errors?: readonly { instancePath: string; keyword: string; message?: string }[] | null }
function compile(path: string): Compiled {
  const schema = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  return new Ajv2020({ allErrors: true, strict: true, strictTypes: false }).compile(schema) as Compiled
}
function issues(validator: Compiled, input: unknown): LifecycleArtifactIssue[] {
  if (validator(input)) return []
  return (validator.errors ?? []).map(error => ({ instancePath: error.instancePath, keyword: error.keyword, message: error.message ?? 'schema validation failed' }))
}
function describe(found: readonly LifecycleArtifactIssue[]): string {
  return found.map(issue => `${issue.instancePath || '/'} ${issue.message} (${issue.keyword})`).join('; ')
}

const testDefinitionValidator = compile(TEST_DEFINITION_V1_SCHEMA_PATH)
const lockedPlanValidator = compile(LOCKED_PLAN_V1_SCHEMA_PATH)
const evaluationValidator = compile(EVALUATION_V1_SCHEMA_PATH)

export function collectTestDefinitionV1Issues(input: unknown): LifecycleArtifactIssue[] { return issues(testDefinitionValidator, input) }
export function collectLockedPlanV1Issues(input: unknown): LifecycleArtifactIssue[] { return issues(lockedPlanValidator, input) }
export function collectEvaluationV1Issues(input: unknown): LifecycleArtifactIssue[] { return issues(evaluationValidator, input) }

export const testDefinitionV1Validator = Object.freeze({
  validate(input: unknown): LifecycleValidationResult<TestDefinitionV1> {
    const found = collectTestDefinitionV1Issues(input)
    return found.length === 0 ? { success: true, data: input as TestDefinitionV1 } : { success: false, error: describe(found) }
  },
})
export const lockedPlanV1Validator = Object.freeze({
  validate(input: unknown): LifecycleValidationResult<LockedPlanV1> {
    const found = collectLockedPlanV1Issues(input)
    return found.length === 0 ? { success: true, data: input as LockedPlanV1 } : { success: false, error: describe(found) }
  },
})
export const evaluationV1Validator = Object.freeze({
  validate(input: unknown): LifecycleValidationResult<EvaluationV1> {
    const found = collectEvaluationV1Issues(input)
    return found.length === 0 ? { success: true, data: input as EvaluationV1 } : { success: false, error: describe(found) }
  },
})
