import { describe, expect, it } from 'vitest'

import { compileDpmPlan, executeDpmRows } from '../src/index.js'
import type { DpmExecutionRow } from '../src/index.js'
import { createCompileInput } from './support/compiler-input-fixtures.js'

const inputRows: DpmExecutionRow[] = [
  {
    table: 'public.customers',
    values: { customer_no: 'c-001' },
  },
  {
    table: 'public.customers',
    values: { customer_no: 'c-002' },
  },
  {
    table: 'public.orders',
    values: { customer_no: 'c-001', amount: 10 },
  },
  {
    table: 'public.orders',
    values: { customer_no: 'c-001', amount: 25 },
  },
  {
    table: 'public.orders',
    values: { customer_no: 'c-002', amount: 40 },
  },
]

describe('DPM in-memory execution adapter', () => {
  it('applies relationship tokens consistently and reports integrity without raw values', () => {
    const compiled = compileDpmPlan(createCompileInput())
    if (!compiled.ok) throw new Error('expected compile success')

    const result = executeDpmRows({ plan: compiled.plan, rows: inputRows }, { tokenKey: 'test-token-key' })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected execution success')
    expect(result.rows).toHaveLength(inputRows.length)
    expect(result.rows[0]?.values.customer_no).toBe(result.rows[2]?.values.customer_no)
    expect(result.rows[2]?.values.customer_no).toBe(result.rows[3]?.values.customer_no)
    expect(result.rows[1]?.values.customer_no).toBe(result.rows[4]?.values.customer_no)
    expect(result.rows[2]?.values.amount).toBe(10)
    expect(result.report).toMatchObject({
      rawValuesIncluded: false,
      inputRows: 5,
      outputRows: 5,
      transformedRows: 5,
      transformedColumns: 5,
      integrity: {
        relationshipsChecked: 1,
        orphanRows: 0,
        matchedRows: 3,
      },
    })
    expect(result.diagnostics).toEqual([])
    expect(inputRows[0]?.values.customer_no).toBe('c-001')
  })

  it('fails closed when an approved relationship contains an orphan child row', () => {
    const compiled = compileDpmPlan(createCompileInput())
    if (!compiled.ok) throw new Error('expected compile success')

    const result = executeDpmRows({
      plan: compiled.plan,
      rows: [
        ...inputRows,
        {
          table: 'public.orders',
          values: { customer_no: 'missing-customer', amount: 99 },
        },
      ],
    }, { tokenKey: 'test-token-key' })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'EXE_ORPHAN_BLOCKED',
        relationship: 'rel_orders_customer',
      }),
    ]))
    expect(result.report.outputRows).toBe(0)
  })

  it('requires caller key material for keyed transforms and blocks unsupported transforms', () => {
    const compiled = compileDpmPlan(createCompileInput())
    if (!compiled.ok) throw new Error('expected compile success')

    const hashPlan = {
      ...compiled.plan,
      columnSteps: compiled.plan.columnSteps.map(step =>
        step.columnRef === 'public.orders.amount' ? { ...step, transform: 'hash' } : step,
      ),
    }
    const hashed = executeDpmRows(
      { plan: hashPlan, rows: inputRows },
      { tokenKey: 'test-token-key', hashKey: 'test-hash-key' },
    )
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) throw new Error('expected hash execution success')
    expect(hashed.rows[2]?.values.amount).toMatch(/^dpm_hash_[0-9a-f]{64}$/)

    const missingKey = executeDpmRows({ plan: hashPlan, rows: inputRows })
    expect(missingKey.ok).toBe(false)
    expect(missingKey.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXE_KEY_REQUIRED', column: 'amount' }),
    ]))

    const unsupportedPlan = {
      ...compiled.plan,
      columnSteps: compiled.plan.columnSteps.map(step =>
        step.columnRef === 'public.orders.amount' ? { ...step, transform: 'generalize' } : step,
      ),
    }
    const unsupported = executeDpmRows({ plan: unsupportedPlan, rows: inputRows }, { tokenKey: 'test-token-key' })
    expect(unsupported.ok).toBe(false)
    expect(unsupported.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EXE_TRANSFORM_UNSUPPORTED', column: 'amount' }),
    ]))
  })
})
