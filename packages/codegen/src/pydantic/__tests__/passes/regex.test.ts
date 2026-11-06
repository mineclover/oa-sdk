import { describe, expect, it } from 'vitest'
import { regexPass } from '../../passes/regex.js'
import { analysis, field, model, module } from './helpers.js'

function pattern(source: string) {
  return {
    kind: 'constrained' as const,
    base: { kind: 'builtin' as const, name: 'str' as const },
    constraints: { pattern: { source, python: null } },
  }
}

describe('regex', () => {
  it('translates ECMA classes and falls back for lookaround', () => {
    const plain = field('plain', {
      kind: 'constrained', base: { kind: 'builtin', name: 'str' },
      constraints: { pattern: { source: '\\d+\\w', python: null } },
    })
    const fallback = field('fallback', {
      kind: 'constrained', base: { kind: 'builtin', name: 'str' },
      constraints: { pattern: { source: '(?=x)', python: null } },
    })
    const result = regexPass.run(module(model('M', [plain, fallback])), { regex: 'ecma' }, analysis)
    const fields = (result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields
    expect(fields[0]!.type).toMatchObject({ constraints: { pattern: { python: '[0-9]+[A-Za-z0-9_]' } } })
    expect(result.decls[0]).toMatchObject({ regexEngine: 'python-re' })
    expect(result.diagnostics.map(item => item.code)).toContain('pydantic/regex-engine-fallback')
  })

  it('keeps raw patterns and uses the Rust engine', () => {
    const result = regexPass.run(module(model('M', [field('value', pattern('\\d'))])), { regex: 'raw' }, analysis)
    expect(result.decls[0]).toMatchObject({ regexEngine: 'rust-regex' })
    expect(result.decls[0]).toMatchObject({ fields: [{ type: { constraints: { pattern: { python: '\\d' } } } }] })
  })

  it('uses Python re for every model in python-re mode', () => {
    const result = regexPass.run(module(model('M'), model('N')), { regex: 'python-re' }, analysis)
    expect(result.decls).toMatchObject([{ regexEngine: 'python-re' }, { regexEngine: 'python-re' }])
  })

  it('translates all four ASCII escapes outside a class', () => {
    const value = field('value', pattern('\\d\\w\\D\\W'))
    const result = regexPass.run(module(model('M', [value])), { regex: 'ecma' }, analysis)
    expect(result.decls[0]).toMatchObject({
      fields: [{ type: { constraints: { pattern: { python: '[0-9][A-Za-z0-9_][^0-9][^A-Za-z0-9_]' } } } }],
    })
  })

  it('translates digit and word escapes inside a class', () => {
    const result = regexPass.run(module(model('M', [field('value', pattern('[\\d\\w]'))])), { regex: 'ecma' }, analysis)
    expect(result.decls[0]).toMatchObject({
      fields: [{ type: { constraints: { pattern: { python: '[0-9A-Za-z0-9_]' } } } }],
    })
  })

  it('diagnoses untranslatable negative escapes inside a class once', () => {
    const result = regexPass.run(module(model('M', [field('value', pattern('[\\D\\W]'))])), { regex: 'ecma' }, analysis)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      code: 'pydantic/regex-class-untranslatable', pointer: '/properties/value',
    })
    expect(result.decls[0]).toMatchObject({ fields: [{ type: { constraints: { pattern: { python: '[\\D\\W]' } } } }] })
  })

  it('falls back for lookahead and lookbehind', () => {
    const ahead = regexPass.run(module(model('M', [field('value', pattern('(?=x)'))])), { regex: 'ecma' }, analysis)
    const behind = regexPass.run(module(model('N', [field('value', pattern('(?<=x)'))])), { regex: 'ecma' }, analysis)
    expect(ahead.decls[0]).toMatchObject({ regexEngine: 'python-re' })
    expect(behind.decls[0]).toMatchObject({ regexEngine: 'python-re' })
    expect(ahead.diagnostics[0]?.code).toBe('pydantic/regex-engine-fallback')
    expect(behind.diagnostics[0]?.code).toBe('pydantic/regex-engine-fallback')
  })

  it('falls back for numeric and named backreferences', () => {
    const result = regexPass.run(
      module(model('M', [field('value', pattern('(a)\\1\\k<a>'))])), { regex: 'ecma' }, analysis,
    )
    expect(result.decls[0]).toMatchObject({ regexEngine: 'python-re' })
    expect(result.diagnostics.map(item => item.code)).toEqual(['pydantic/regex-engine-fallback'])
  })

  it('does not fall back for named groups', () => {
    const result = regexPass.run(
      module(model('M', [field('value', pattern('(?<name>x)'))])), { regex: 'ecma' }, analysis,
    )
    expect(result.decls[0]).toMatchObject({ regexEngine: 'rust-regex' })
    expect(result.diagnostics).toEqual([])
  })

  it('does not fall back for escaped lookaround text', () => {
    const result = regexPass.run(module(model('M', [field('value', pattern('\\(?=x'))])), { regex: 'ecma' }, analysis)
    expect(result.decls[0]).toMatchObject({ regexEngine: 'rust-regex' })
    expect(result.diagnostics).toEqual([])
  })

  it('lets an alias pattern decide the engine of its owning model', () => {
    const alias = {
      kind: 'alias' as const,
      name: 'Alias',
      pyName: null,
      origin: 'component' as const,
      type: pattern('(?<!x)'),
      pointer: '/Alias',
    }
    const user = model('User', [field('value', { kind: 'ref', target: 'Alias' })])
    const result = regexPass.run(module(alias, user), { regex: 'ecma' }, analysis)
    expect(result.decls[1]).toMatchObject({ regexEngine: 'python-re' })
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.pointer).toBe('/Alias')
  })

  it('diagnoses an unowned alias pattern and defaults patternless models to Rust', () => {
    const alias = {
      kind: 'alias' as const,
      name: 'Alias',
      pyName: null,
      origin: 'component' as const,
      type: pattern('(?=x)'),
      pointer: '/Alias',
    }
    const result = regexPass.run(module(alias, model('Model')), { regex: 'ecma' }, analysis)
    expect(result.diagnostics).toMatchObject([{ code: 'pydantic/regex-engine-fallback', pointer: '/Alias' }])
    expect(result.decls[1]).toMatchObject({ regexEngine: 'rust-regex' })
  })

  it('does not transfer component model ownership through a direct reference', () => {
    const component = model('Component', [field('value', pattern('(?=x)'))])
    const user = model('User', [field('component', { kind: 'ref', target: 'Component' })])
    const result = regexPass.run(module(component, user), { regex: 'ecma' }, analysis)
    expect(result.decls[0]).toMatchObject({ regexEngine: 'python-re' })
    expect(result.decls[1]).toMatchObject({ regexEngine: 'rust-regex' })
    expect(result.diagnostics).toHaveLength(1)
  })
})
