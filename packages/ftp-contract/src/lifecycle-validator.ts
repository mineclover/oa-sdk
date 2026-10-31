import { Ajv2020 } from 'ajv/dist/2020.js'
import { readPublicAsset } from './public-assets.js'
import {
  EVALUATION_V1_SCHEMA_PATH,
  LOCKED_PLAN_V1_SCHEMA_PATH,
  TEST_DEFINITION_V1_SCHEMA_PATH,
  TEST_DEFINITION_V2_SCHEMA_PATH,
} from './refs.js'
import type { EvaluationV1, LockedPlanV1, TestDefinitionV1, TestDefinitionV2 } from './types.js'

export interface LifecycleArtifactIssue {
  readonly instancePath: string
  readonly keyword: string
  readonly message: string
}

export type LifecycleValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string }

export interface LifecycleValidator<T> {
  validate(input: unknown): LifecycleValidationResult<T>
}

type Compiled = {
  (value: unknown): boolean
  errors?: readonly { instancePath: string; keyword: string; message?: string }[] | null
}

function readDeclaration(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readPublicAsset(path))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Bundled FTP declaration at ${path} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function compile(path: string): Compiled {
  return new Ajv2020({ allErrors: true, strict: true, strictTypes: false }).compile(readDeclaration(path)) as Compiled
}

function issues(validator: Compiled, input: unknown): LifecycleArtifactIssue[] {
  if (validator(input)) return []
  return (validator.errors ?? []).map(error => ({
    instancePath: error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'schema validation failed',
  }))
}

function describe(found: readonly LifecycleArtifactIssue[]): string {
  return found.map(issue => `${issue.instancePath || '/'} ${issue.message} (${issue.keyword})`).join('; ')
}

function createValidator<T>(collect: (input: unknown) => LifecycleArtifactIssue[]): LifecycleValidator<T> {
  return Object.freeze({
    validate(input: unknown): LifecycleValidationResult<T> {
      const found = collect(input)
      return found.length === 0 ? { success: true, data: input as T } : { success: false, error: describe(found) }
    },
  })
}

const testDefinitionV1Compiled = compile(TEST_DEFINITION_V1_SCHEMA_PATH)
const testDefinitionV2Compiled = compile(TEST_DEFINITION_V2_SCHEMA_PATH)
const lockedPlanV1Compiled = compile(LOCKED_PLAN_V1_SCHEMA_PATH)
const evaluationV1Compiled = compile(EVALUATION_V1_SCHEMA_PATH)

export function collectTestDefinitionV1Issues(input: unknown): LifecycleArtifactIssue[] {
  return issues(testDefinitionV1Compiled, input)
}
export function collectTestDefinitionV2Issues(input: unknown): LifecycleArtifactIssue[] {
  return issues(testDefinitionV2Compiled, input)
}
export function collectLockedPlanV1Issues(input: unknown): LifecycleArtifactIssue[] {
  return issues(lockedPlanV1Compiled, input)
}
export function collectEvaluationV1Issues(input: unknown): LifecycleArtifactIssue[] {
  return issues(evaluationV1Compiled, input)
}

export const testDefinitionV1Validator: LifecycleValidator<TestDefinitionV1> = createValidator(collectTestDefinitionV1Issues)
export const testDefinitionV2Validator: LifecycleValidator<TestDefinitionV2> = createValidator(collectTestDefinitionV2Issues)
export const lockedPlanV1Validator: LifecycleValidator<LockedPlanV1> = createValidator(collectLockedPlanV1Issues)
export const evaluationV1Validator: LifecycleValidator<EvaluationV1> = createValidator(collectEvaluationV1Issues)
