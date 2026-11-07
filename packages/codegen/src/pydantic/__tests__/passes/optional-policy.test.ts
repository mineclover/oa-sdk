import { describe, expect, it } from 'vitest'
import { optionalPolicyPass } from '../../passes/optional-policy.js'
import { analysis, field, model, module } from './helpers.js'

describe('optionalPolicy', () => {
  it('fills required, defaulted, and absent defaults', () => {
    const required = field('required')
    required.required = true
    const nullable = field('nullable')
    nullable.nullable = true
    nullable.schemaDefault = { json: null }
    const absent = field('absent')
    const result = optionalPolicyPass.run(
      module(model('M', [required, nullable, absent])),
      { optionalStyle: 'reject-null' },
      analysis,
    )
    const fields = (result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields
    expect(fields.map(value => value.default)).toEqual([
      { kind: 'required' }, { kind: 'value', json: null }, { kind: 'none' },
    ])
    expect(fields.map(value => value.rejectExplicitNull)).toEqual([false, false, true])
  })

  it('does not reject explicit null in plain mode', () => {
    const result = optionalPolicyPass.run(module(model('M', [field('value')])), { optionalStyle: 'plain' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.rejectExplicitNull)
      .toBe(false)
  })

  it('does not reject null for nullable optional fields', () => {
    const value = field('value')
    value.nullable = true
    const result = optionalPolicyPass.run(module(model('M', [value])), { optionalStyle: 'reject-null' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.rejectExplicitNull)
      .toBe(false)
  })

  it('copies a JSON schema default into the value decision', () => {
    const value = field('value')
    value.schemaDefault = { json: 3 }
    const result = optionalPolicyPass.run(module(model('M', [value])), { optionalStyle: 'reject-null' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.default)
      .toEqual({ kind: 'value', json: 3 })
  })
})
