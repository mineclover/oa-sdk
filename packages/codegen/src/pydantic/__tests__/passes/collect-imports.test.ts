import { describe, expect, it } from 'vitest'
import { collectImportsPass } from '../../passes/collect-imports.js'
import { analysis, field, model, module } from './helpers.js'

describe('collectImports', () => {
  it('collects sorted imports from resolved types and render decisions', () => {
    const value = field('value', { kind: 'literal', values: ['x'] })
    value.attribute = 'value'
    value.alias = ''
    value.description = 'value'
    value.default = { kind: 'none' }
    value.rejectExplicitNull = true
    const current = model('M', [value])
    current.extra = 'ignore'
    current.regexEngine = 'rust-regex'
    const result = collectImportsPass.run(module(current), {}, analysis)
    expect(result.imports?.from.__future__).toEqual(['annotations'])
    expect(result.imports?.from.pydantic).toEqual(expect.arrayContaining([
      'BaseModel', 'ConfigDict', 'Field', 'field_validator',
    ]))
    expect(result.imports?.from.typing).toContain('Literal')
  })

  it('collects named type modules and constrained validator imports', () => {
    const value = field('value', {
      kind: 'constrained',
      base: { kind: 'named', module: 'datetime', name: 'datetime' },
      constraints: { uniqueItems: true },
    })
    value.attribute = 'value'
    value.alias = ''
    value.default = { kind: 'required' }
    value.rejectExplicitNull = false
    const result = collectImportsPass.run(module(model('M', [value])), {}, analysis)
    expect(result.imports?.from.datetime).toEqual(['datetime'])
    expect(result.imports?.from.pydantic).toEqual(expect.arrayContaining([
      'AfterValidator', 'BaseModel', 'ConfigDict',
    ]))
    expect(result.imports?.from.typing).toEqual(expect.arrayContaining(['Annotated']))
  })

  it('imports StrEnum without TypeAlias for str-enum declarations', () => {
    const strEnum = {
      kind: 'enum' as const, name: 'S', pyName: 'S', values: ['a'], repr: 'str-enum' as const,
      members: [{ name: 'A', value: 'a' }], pointer: '/S',
    }
    const literal = { ...strEnum, name: 'L', pyName: 'L', repr: 'literal' as const, members: [] }
    expect(collectImportsPass.run(module(strEnum), {}, analysis).imports?.from).toMatchObject({
      enum: ['StrEnum'],
    })
    expect(collectImportsPass.run(module(strEnum), {}, analysis).imports?.from.typing).toBeUndefined()
    expect(collectImportsPass.run(module(literal), {}, analysis).imports?.from.typing).toEqual(['Literal', 'TypeAlias'])
  })
})
