import { describe, expect, it } from 'vitest'
import { scalarPolicyPass } from '../../passes/scalar-policy.js'
import { analysis, module } from './helpers.js'

describe('scalarPolicy', () => {
  it('maps formats, bounds, and enum representations', () => {
    const value = {
      kind: 'alias' as const, name: 'Value', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'integer' as const, format: 'int8' }, pointer: '/Value',
    }
    const choice = {
      kind: 'enum' as const, name: 'Choice', pyName: null, values: ['a-value', 'a_value'], repr: null, members: null,
      pointer: '/Choice',
    }
    const result = scalarPolicyPass.run(module(value, choice), {
      enumStyle: 'str-enum', datetime: 'aware', uri: 'str', intBounds: 'format',
    }, analysis)
    expect(result.decls[0]).toMatchObject({ type: { kind: 'constrained', constraints: { ge: -128, le: 127 } } })
    expect(result.decls[1]).toMatchObject({ repr: 'str-enum', members: [{ name: 'A_VALUE' }, { name: 'A_VALUE_2' }] })
  })

  it('maps date-time, date, time, duration, UUID, and email formats', () => {
    const formats = ['date-time', 'date', 'time', 'duration', 'uuid', 'email'].map((format, index) => ({
      kind: 'alias' as const, name: `Value${index}`, pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'string' as const, format }, pointer: `/Value${index}`,
    }))
    const result = scalarPolicyPass.run(module(...formats), {
      enumStyle: 'literal', datetime: 'aware', uri: 'str', intBounds: 'none',
    }, analysis)
    expect(result.decls.map(decl => decl.kind === 'alias' ? decl.type : null)).toEqual([
      { kind: 'named', module: 'pydantic', name: 'AwareDatetime' },
      { kind: 'named', module: 'datetime', name: 'date' },
      { kind: 'named', module: 'datetime', name: 'time' },
      { kind: 'named', module: 'datetime', name: 'timedelta' },
      { kind: 'named', module: 'uuid', name: 'UUID' },
      { kind: 'named', module: 'pydantic', name: 'EmailStr' },
    ])
  })

  it('maps URI, byte, base64, and unknown string formats', () => {
    const values = ['uri', 'byte', 'unknown'].map((format, index) => ({
      kind: 'alias' as const, name: `Value${index}`, pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'string' as const, format }, pointer: `/Value${index}`,
    }))
    const result = scalarPolicyPass.run(module(...values), {
      enumStyle: 'literal', datetime: 'naive', uri: 'any-url', intBounds: 'none',
    }, analysis)
    expect(result.decls.map(decl => decl.kind === 'alias' ? decl.type : null)).toEqual([
      { kind: 'named', module: 'pydantic', name: 'AnyUrl' },
      { kind: 'named', module: 'pydantic', name: 'Base64Bytes' },
      { kind: 'builtin', name: 'str' },
    ])
  })

  it('maps numbers and decimal formats', () => {
    const decimal = {
      kind: 'alias' as const, name: 'Decimal', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'number' as const, format: 'decimal128' }, pointer: '/Decimal',
    }
    const number = {
      kind: 'alias' as const, name: 'Number', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'number' as const }, pointer: '/Number',
    }
    const result = scalarPolicyPass.run(module(decimal, number), {
      enumStyle: 'literal', datetime: 'naive', uri: 'str', intBounds: 'none',
    }, analysis)
    expect(result.decls).toMatchObject([
      { type: { kind: 'named', module: 'decimal', name: 'Decimal' } },
      { type: { kind: 'builtin', name: 'float' } },
    ])
  })

  it('ignores integer format bounds when configured to do so', () => {
    const value = {
      kind: 'alias' as const, name: 'Value', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'integer' as const, format: 'uint8' }, pointer: '/Value',
    }
    const result = scalarPolicyPass.run(module(value), {
      enumStyle: 'literal', datetime: 'naive', uri: 'str', intBounds: 'none',
    }, analysis)
    expect(result.decls[0]).toMatchObject({ type: { kind: 'builtin', name: 'int' } })
  })

  it('keeps int64 and uint64 bounds exact', () => {
    const signed = {
      kind: 'alias' as const, name: 'Signed', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'integer' as const, format: 'int64' }, pointer: '/Signed',
    }
    const unsigned = {
      kind: 'alias' as const, name: 'Unsigned', pyName: null, origin: 'component' as const,
      type: { kind: 'scalar' as const, base: 'integer' as const, format: 'uint64' }, pointer: '/Unsigned',
    }
    const result = scalarPolicyPass.run(module(signed, unsigned), {
      enumStyle: 'literal', datetime: 'naive', uri: 'str', intBounds: 'format',
    }, analysis)
    expect(result.decls[0]).toMatchObject({ type: { constraints: {
      ge: { integer: '-9223372036854775808' }, le: { integer: '9223372036854775807' },
    } } })
    expect(result.decls[1]).toMatchObject({ type: { constraints: {
      ge: 0, le: { integer: '18446744073709551615' },
    } } })
  })

  it('merges format bounds with tighter existing constraints', () => {
    const value = {
      kind: 'alias' as const, name: 'Value', pyName: null, origin: 'component' as const,
      type: {
        kind: 'constrained' as const,
        base: { kind: 'scalar' as const, base: 'integer' as const, format: 'int8' },
        constraints: { ge: -200, le: 10 },
      }, pointer: '/Value',
    }
    const result = scalarPolicyPass.run(module(value), {
      enumStyle: 'literal', datetime: 'naive', uri: 'str', intBounds: 'format',
    }, analysis)
    expect(result.decls[0]).toMatchObject({ type: { constraints: { ge: -128, le: 10 } } })
  })

  it('uses Literal representation for mixed enum values', () => {
    const choice = {
      kind: 'enum' as const, name: 'Choice', pyName: null, values: ['a', 1], repr: null, members: null,
      pointer: '/Choice',
    }
    const result = scalarPolicyPass.run(module(choice), {
      enumStyle: 'str-enum', datetime: 'naive', uri: 'str', intBounds: 'none',
    }, analysis)
    expect(result.decls[0]).toMatchObject({ repr: 'literal', members: [] })
  })
})
