import { Ajv2020 } from 'ajv/dist/2020.js'
import { readPublicAsset } from './public-assets.js'
import { RUN_EVIDENCE_V1_SCHEMA_PATH } from './refs.js'
import type { RunEvidenceV1 } from './types.js'

export interface RunEvidenceIssue {
  readonly instancePath: string
  readonly keyword: string
  readonly message: string
}

/** Same envelope as the `@oa-sdk/tools` JSON Schema validator. */
export type RunEvidenceValidationResult =
  | { readonly success: true; readonly data: RunEvidenceV1 }
  | { readonly success: false; readonly error: string }

export interface RunEvidenceValidator {
  validate(input: unknown): RunEvidenceValidationResult
}

type CompiledSchema = {
  (value: unknown): boolean
  errors?: readonly { instancePath: string; keyword: string; message?: string }[] | null
}

function readDeclaration(): Record<string, unknown> {
  const value: unknown = JSON.parse(readPublicAsset(RUN_EVIDENCE_V1_SCHEMA_PATH))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Bundled RunEvidence declaration must be a JSON object')
  }
  return value as Record<string, unknown>
}

// The declaration is compiled once at load. A broken bundled schema throws here
// instead of surfacing later as an input rejection. strictRequired is off
// because it misreads the sibling `then` branch of the attempt rule.
const compiled: CompiledSchema = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false }).compile(readDeclaration())

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** The schema pattern bounds each field; only day-of-month needs the calendar. */
function calendarIssues(evidence: RunEvidenceV1): RunEvidenceIssue[] {
  const issues: RunEvidenceIssue[] = []
  evidence.observations.forEach((observation, index) => {
    if (observation.receivedAt === undefined) return
    const year = Number(observation.receivedAt.slice(0, 4))
    const month = Number(observation.receivedAt.slice(5, 7))
    const day = Number(observation.receivedAt.slice(8, 10))
    if (day > daysInMonth(year, month)) {
      issues.push({
        instancePath: `/observations/${index}/receivedAt`,
        keyword: 'calendar',
        message: `day ${day} does not exist in ${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
      })
    }
  })
  return issues
}

/** Structured issues for a decoded RunEvidence v1 artifact; empty means valid. */
export function collectRunEvidenceIssues(value: unknown): RunEvidenceIssue[] {
  if (!compiled(value)) {
    return (compiled.errors ?? []).map(error => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message ?? 'schema validation failed',
    }))
  }
  return calendarIssues(value as RunEvidenceV1)
}

function describe(issues: readonly RunEvidenceIssue[]): string {
  return issues.map(issue => `${issue.instancePath || '/'} ${issue.message} (${issue.keyword})`).join('; ')
}

/**
 * Synchronous validator for already-decoded data. Raw JSON decoding (duplicate
 * keys, number tokens, Unicode) belongs to the consumer's decoder stage.
 */
export const runEvidenceV1Validator: RunEvidenceValidator = Object.freeze({
  validate(input: unknown): RunEvidenceValidationResult {
    const issues = collectRunEvidenceIssues(input)
    return issues.length === 0
      ? { success: true, data: input as RunEvidenceV1 }
      : { success: false, error: describe(issues) }
  },
})
