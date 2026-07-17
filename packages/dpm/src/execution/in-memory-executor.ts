import { createHmac } from 'node:crypto'

import type { DpmColumnStep, DpmRelationshipStep } from '../compiler/plan-step-types.js'
import {
  renderCanonicalKeySegments,
  type CanonicalKeyValue,
  type CanonicalKeyValueMap,
} from '../model/canonical-key.js'
import type { DpmCompiledPlan } from '../compiler/plan-compiled-types.js'
import type {
  DpmExecutionDiagnostic,
  DpmExecutionInput,
  DpmExecutionKey,
  DpmExecutionOptions,
  DpmExecutionReport,
  DpmExecutionResult,
  DpmExecutionRow,
} from './execution-types.js'

const DEFAULT_REDACT_VALUE = '[REDACTED]'
const DEFAULT_MASK_VALUE = '[MASKED]'

type IndexedRow = {
  input: DpmExecutionRow
  output: DpmExecutionRow
}

type ExecutionContext = {
  plan: DpmCompiledPlan
  step: DpmColumnStep
  relationship?: DpmRelationshipStep
}

/**
 * Executes a compiled plan against caller-owned in-memory rows.
 *
 * This is deliberately an adapter boundary: it does not connect to a database,
 * persist rows, or resolve vault references. Token and hash key material must be
 * supplied by the caller and is never included in the returned report.
 */
export function executeDpmRows(
  input: DpmExecutionInput,
  options: DpmExecutionOptions = {},
): DpmExecutionResult {
  const diagnostics: DpmExecutionDiagnostic[] = []
  const indexedRows: IndexedRow[] = []
  const stepsByTable = groupColumnSteps(input.plan.columnSteps)
  const allowedTables = collectAllowedTables(input.plan)
  let transformedRows = 0
  let transformedColumns = 0

  if (input.plan.stale) {
    diagnostics.push({
      severity: 'error',
      code: 'EXE_PLAN_STALE',
      message: 'stale compiled plans cannot be executed.',
    })
  }

  for (const row of input.rows) {
    if (!allowedTables.has(row.table)) {
      diagnostics.push({
        severity: 'error',
        code: 'EXE_TABLE_SCOPE',
        message: `row table ${row.table} is outside the compiled plan scope.`,
        table: row.table,
      })
      continue
    }

    const values = { ...row.values }
    let rowChanged = false
    for (const step of stepsByTable.get(row.table) ?? []) {
      if (!Object.prototype.hasOwnProperty.call(values, step.column)) {
        diagnostics.push({
          severity: 'error',
          code: 'EXE_COLUMN_MISSING',
          message: 'compiled plan column is missing from the input row.',
          table: step.table,
          column: step.column,
        })
        continue
      }

      const relationship = step.relationship
        ? input.plan.relationshipSteps.find(relationshipStep => relationshipStep.name === step.relationship)
        : undefined
      const context: ExecutionContext = {
        plan: input.plan,
        step,
        ...(relationship ? { relationship } : {}),
      }

      try {
        const nextValue = transformValue(values[step.column], context, options)
        if (!Object.is(nextValue, values[step.column])) {
          values[step.column] = nextValue
          rowChanged = true
          transformedColumns += 1
        }
      } catch (error) {
        diagnostics.push(createTransformDiagnostic(error, context))
      }
    }

    if (rowChanged) transformedRows += 1
    indexedRows.push({
      input: row,
      output: {
        table: row.table,
        values,
      },
    })
  }

  const integrity = checkRelationshipIntegrity(input.plan, indexedRows, diagnostics)
  const report = createReport({
    plan: input.plan,
    inputRows: input.rows.length,
    outputRows: diagnostics.some(diagnostic => diagnostic.severity === 'error') ? 0 : indexedRows.length,
    transformedRows,
    transformedColumns,
    integrity,
  })

  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    return {
      ok: false,
      diagnostics,
      report,
    }
  }

  return {
    ok: true,
    rows: indexedRows.map(row => row.output),
    diagnostics,
    report,
  }
}

function transformValue(
  value: unknown,
  context: ExecutionContext,
  options: DpmExecutionOptions,
): unknown {
  if (value === null || value === undefined) return value

  if (context.step.pii === true && context.step.transform === 'keep') {
    throw executionError('EXE_TRANSFORM_INVALID', 'PII columns cannot use keep transform.')
  }

  switch (context.step.transform) {
    case 'keep':
      return value
    case 'redact':
      return options.redactValue ?? DEFAULT_REDACT_VALUE
    case 'mask':
      return options.maskValue ?? DEFAULT_MASK_VALUE
    case 'null':
      return null
    case 'hash':
      return keyedDigest(
        requireKey(options.hashKey, 'hash'),
        `hash:${context.step.columnRef}`,
        canonicalValue(context.plan, `hash:${context.step.columnRef}`, value),
        'dpm_hash_',
      )
    case 'relationship_token':
      return relationshipToken(value, context, options)
    case 'generalize':
    case 'polymorphic_relationship_token':
      throw executionError(
        'EXE_TRANSFORM_UNSUPPORTED',
        `${context.step.transform} requires a dedicated execution policy and is blocked by the in-memory adapter.`,
      )
    default:
      throw executionError(
        'EXE_TRANSFORM_UNSUPPORTED',
        `transform ${context.step.transform} is not supported by the in-memory adapter.`,
      )
  }
}

function relationshipToken(
  value: unknown,
  context: ExecutionContext,
  options: DpmExecutionOptions,
): string {
  const relationship = context.relationship
  if (!relationship) {
    throw executionError('EXE_TRANSFORM_INVALID', 'relationship_token requires an approved relationship step.')
  }
  const componentIndex = findRelationshipComponentIndex(relationship, context.step)
  if (componentIndex === undefined) {
    throw executionError(
      'EXE_TRANSFORM_INVALID',
      'relationship_token column is not part of the approved relationship endpoint.',
    )
  }

  const canonical = canonicalValue(
    context.plan,
    `relationship:${relationship.name}:${componentIndex}`,
    value,
  )
  return keyedDigest(
    requireKey(options.tokenKey, 'relationship_token'),
    `relationship-token:${relationship.name}:${componentIndex}`,
    canonical,
    'dpm_token_',
  )
}

function findRelationshipComponentIndex(
  relationship: DpmRelationshipStep,
  step: DpmColumnStep,
): number | undefined {
  const parentIndex = step.table === relationship.parent.table
    ? relationship.parent.columns.indexOf(step.column)
    : -1
  const childIndex = step.table === relationship.child.table
    ? relationship.child.columns.indexOf(step.column)
    : -1

  if (parentIndex >= 0 && childIndex >= 0 && parentIndex !== childIndex) return undefined
  if (parentIndex >= 0) return parentIndex
  if (childIndex >= 0) return childIndex
  return undefined
}

function canonicalValue(plan: DpmCompiledPlan, namespace: string, value: unknown): string {
  const normalized = toCanonicalKeyValue(value)
  const values: CanonicalKeyValueMap = { value: normalized }
  return renderCanonicalKeySegments({
    namespace,
    separator: '|',
    columns: ['value'],
    values,
    encodingVersion: plan.canonicalKeyEncodingVersion,
  })
}

function toCanonicalKeyValue(value: unknown): CanonicalKeyValue {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw executionError('EXE_VALUE_UNSUPPORTED', 'non-finite numbers cannot be transformed.')
    return value
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw executionError('EXE_VALUE_UNSUPPORTED', 'invalid dates cannot be transformed.')
    return value
  }
  throw executionError('EXE_VALUE_UNSUPPORTED', 'only scalar values can be hashed or tokenized.')
}

function keyedDigest(
  key: DpmExecutionKey,
  context: string,
  payload: string,
  prefix: string,
): string {
  const digest = createHmac('sha256', key)
    .update(context)
    .update('\0')
    .update(payload)
    .digest('hex')
  return `${prefix}${digest}`
}

function requireKey(key: DpmExecutionKey | undefined, transform: string): DpmExecutionKey {
  if (key === undefined || (typeof key === 'string' && key.length === 0) || (key instanceof Uint8Array && key.length === 0)) {
    throw executionError('EXE_KEY_REQUIRED', `${transform} requires caller-supplied key material.`)
  }
  return key
}

function groupColumnSteps(steps: readonly DpmColumnStep[]): Map<string, DpmColumnStep[]> {
  const grouped = new Map<string, DpmColumnStep[]>()
  for (const step of steps) {
    const current = grouped.get(step.table) ?? []
    current.push(step)
    grouped.set(step.table, current)
  }
  return grouped
}

function collectAllowedTables(plan: DpmCompiledPlan): Set<string> {
  const tables = new Set(plan.columnSteps.map(step => step.table))
  for (const relationship of plan.relationshipSteps) {
    tables.add(relationship.parent.table)
    tables.add(relationship.child.table)
  }
  return tables
}

function checkRelationshipIntegrity(
  plan: DpmCompiledPlan,
  rows: readonly IndexedRow[],
  diagnostics: DpmExecutionDiagnostic[],
): DpmExecutionReport['integrity'] {
  let orphanRows = 0
  let matchedRows = 0

  for (const relationship of plan.relationshipSteps) {
    const parents = rows.filter(row => row.input.table === relationship.parent.table)
    const children = rows.filter(row => row.input.table === relationship.child.table)
    const parentByKey = new Map<string, IndexedRow>()

    for (const parent of parents) {
      const rendered = renderEndpointKey(plan, relationship, relationship.parent.columns, parent.input.values)
      if (!rendered.ok) {
        diagnostics.push(rendered.diagnostic)
        continue
      }
      if (rendered.key !== undefined) parentByKey.set(rendered.key, parent)
    }

    for (const child of children) {
      const rendered = renderEndpointKey(plan, relationship, relationship.child.columns, child.input.values)
      if (!rendered.ok) {
        diagnostics.push(rendered.diagnostic)
        continue
      }
      const key = rendered.key
      if (key === undefined) {
        if (relationship.orphanPolicy === 'tolerate_null') continue
        orphanRows += 1
        addOrphanDiagnostic(diagnostics, relationship, child.input.table)
        continue
      }

      const parent = parentByKey.get(key)
      if (!parent) {
        if (relationship.orphanPolicy === 'tolerate' || relationship.orphanPolicy === 'lookup_archive') continue
        orphanRows += 1
        addOrphanDiagnostic(diagnostics, relationship, child.input.table)
        continue
      }

      matchedRows += 1
      for (let index = 0; index < relationship.parent.columns.length; index += 1) {
        const parentColumn = relationship.parent.columns[index]
        const childColumn = relationship.child.columns[index]
        if (!parentColumn || !childColumn) continue
        const parentValue = parent.output.values[parentColumn]
        const childValue = child.output.values[childColumn]
        if (!Object.is(parentValue, childValue)) {
          diagnostics.push({
            severity: 'error',
            code: 'EXE_RELATIONSHIP_DRIFT',
            message: 'transformed relationship endpoint values do not match.',
            relationship: relationship.name,
          })
        }
      }
    }
  }

  return {
    relationshipsChecked: plan.relationshipSteps.length,
    orphanRows,
    matchedRows,
  }
}

function renderEndpointKey(
  plan: DpmCompiledPlan,
  relationship: DpmRelationshipStep,
  columns: readonly string[],
  values: Readonly<Record<string, unknown>>,
): { ok: true; key: string | undefined } | { ok: false; diagnostic: DpmExecutionDiagnostic } {
  try {
    const keyValues: CanonicalKeyValueMap = {}
    const componentColumns = columns.map((_, index) => `component_${index}`)
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index]
      const componentColumn = componentColumns[index]
      if (!column || !componentColumn) continue
      const value = values[column]
      if (value === undefined || value === null) return { ok: true, key: undefined }
      keyValues[componentColumn] = toCanonicalKeyValue(value)
    }

    return {
      ok: true,
      key: renderCanonicalKeySegments({
        namespace: `integrity:${relationship.name}`,
        separator: '|',
        columns: componentColumns,
        values: keyValues,
        encodingVersion: plan.canonicalKeyEncodingVersion,
      }),
    }
  } catch (error) {
    const candidate = error as { code?: DpmExecutionDiagnostic['code']; message?: string }
    return {
      ok: false,
      diagnostic: {
        severity: 'error',
        code: candidate.code ?? 'EXE_VALUE_UNSUPPORTED',
        message: candidate.message ?? 'relationship endpoint key cannot be rendered.',
        relationship: relationship.name,
      },
    }
  }
}

function addOrphanDiagnostic(
  diagnostics: DpmExecutionDiagnostic[],
  relationship: DpmRelationshipStep,
  table: string,
): void {
  const blocking = relationship.orphanPolicy === 'block'
  diagnostics.push({
    severity: blocking ? 'error' : 'warning',
    code: blocking ? 'EXE_ORPHAN_BLOCKED' : 'EXE_ORPHAN',
    message: 'child row has no matching parent in the supplied execution batch.',
    table,
    relationship: relationship.name,
  })
}

function createReport(input: {
  plan: DpmCompiledPlan
  inputRows: number
  outputRows: number
  transformedRows: number
  transformedColumns: number
  integrity: DpmExecutionReport['integrity']
}): DpmExecutionReport {
  return {
    kind: 'dpm.execution-report.v1',
    planIdentity: input.plan.identity,
    rawValuesIncluded: false,
    inputRows: input.inputRows,
    outputRows: input.outputRows,
    transformedRows: input.transformedRows,
    transformedColumns: input.transformedColumns,
    integrity: input.integrity,
  }
}

function createTransformDiagnostic(error: unknown, context: ExecutionContext): DpmExecutionDiagnostic {
  const candidate = error as { code?: DpmExecutionDiagnostic['code']; message?: string }
  const code = candidate.code ?? 'EXE_TRANSFORM_INVALID'
  return {
    severity: 'error',
    code,
    message: candidate.message ?? 'column transform failed.',
    table: context.step.table,
    column: context.step.column,
    ...(context.relationship ? { relationship: context.relationship.name } : {}),
  }
}

function executionError(
  code: DpmExecutionDiagnostic['code'],
  message: string,
): Error & { code: DpmExecutionDiagnostic['code'] } {
  const error = new Error(message) as Error & { code: DpmExecutionDiagnostic['code'] }
  error.code = code
  return error
}
