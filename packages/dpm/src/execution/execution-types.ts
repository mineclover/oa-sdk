import type { DpmCompiledPlan } from '../compiler/plan-compiled-types.js'

export type DpmExecutionKey = string | Uint8Array

export type DpmExecutionRow = {
  table: string
  values: Readonly<Record<string, unknown>>
}

export type DpmExecutionInput = {
  plan: DpmCompiledPlan
  rows: readonly DpmExecutionRow[]
}

export type DpmExecutionOptions = {
  /** Ephemeral key material supplied by the caller; it is never copied to the result. */
  tokenKey?: DpmExecutionKey
  /** Required for hash transforms so plain, unkeyed hashes are not produced accidentally. */
  hashKey?: DpmExecutionKey
  redactValue?: string
  maskValue?: string
}

export type DpmExecutionDiagnostic = {
  severity: 'error' | 'warning'
  code:
  | 'EXE_PLAN_STALE'
  | 'EXE_TABLE_SCOPE'
  | 'EXE_COLUMN_MISSING'
  | 'EXE_TRANSFORM_INVALID'
  | 'EXE_TRANSFORM_UNSUPPORTED'
  | 'EXE_KEY_REQUIRED'
  | 'EXE_VALUE_UNSUPPORTED'
  | 'EXE_ORPHAN_BLOCKED'
  | 'EXE_ORPHAN'
  | 'EXE_RELATIONSHIP_DRIFT'
  message: string
  table?: string
  column?: string
  relationship?: string
}

export type DpmExecutionIntegrity = {
  relationshipsChecked: number
  orphanRows: number
  matchedRows: number
}

export type DpmExecutionReport = {
  kind: 'dpm.execution-report.v1'
  planIdentity: string
  rawValuesIncluded: false
  inputRows: number
  outputRows: number
  transformedRows: number
  transformedColumns: number
  integrity: DpmExecutionIntegrity
}

export type DpmExecutionSuccess = {
  ok: true
  rows: DpmExecutionRow[]
  diagnostics: DpmExecutionDiagnostic[]
  report: DpmExecutionReport
}

export type DpmExecutionFailure = {
  ok: false
  diagnostics: DpmExecutionDiagnostic[]
  report: DpmExecutionReport
}

export type DpmExecutionResult = DpmExecutionSuccess | DpmExecutionFailure
