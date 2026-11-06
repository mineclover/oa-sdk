import { describe, expect, it } from 'vitest'
import { namingPass } from '../../passes/naming.js'
import { analysis, field, model, module } from './helpers.js'

describe('naming', () => {
  it('normalizes aliases, keywords, base attributes, and collisions', () => {
    const base = model('Base', [field('json')])
    base.fields[0]!.attribute = 'json'
    const child = model('Child', [field('json'), field('from'), field('a-b'), field('a_b')])
    child.bases = ['Base']
    const result = namingPass.run(module(base, child), { naming: 'snake-alias' }, analysis)
    const fields = (result.decls[1] as Extract<typeof result.decls[number], { kind: 'model' }>).fields
    expect(fields.map(value => value.attribute)).toEqual(['json_', 'from_', 'a_b', 'a_b2'])
    expect(fields.map(value => value.alias)).toEqual(['json', 'from', 'a-b', 'a_b'])
    expect(result.decls.map(value => value.pyName)).toEqual(['Base', 'Child'])
  })

  it('preserves wire names when requested', () => {
    const result = namingPass.run(module(model('M', [field('camelCase')])), { naming: 'preserve' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0])
      .toMatchObject({ attribute: 'camelCase', alias: '' })
  })

  it('strips private leading underscores in both naming modes', () => {
    for (const naming of ['preserve', 'snake-alias'] as const) {
      const result = namingPass.run(module(model('M', [field('_meta')])), { naming }, analysis)
      expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0])
        .toMatchObject({ attribute: 'meta', alias: '_meta' })
    }
  })

  it('names inline declarations from their owner and path', () => {
    const inline = model('Owner/nestedValue')
    const result = namingPass.run(module(model('Owner'), inline), { naming: 'snake-alias' }, analysis)
    expect(result.decls.map(decl => decl.pyName)).toEqual(['Owner', 'OwnerNestedValue'])
  })

  it('deduplicates declaration Python names in sorted wire-name order', () => {
    const first = model('a-b')
    const second = model('a_b')
    const result = namingPass.run(module(first, second), { naming: 'snake-alias' }, analysis)
    expect(result.decls.find(decl => decl.name === 'a-b')?.pyName).toBe('AB2')
    expect(result.decls.find(decl => decl.name === 'a_b')?.pyName).toBe('AB')
    expect(result.diagnostics[0]?.code).toBe('pydantic/name-collision')
  })

  it('makes Python keywords safe', () => {
    const result = namingPass.run(module(model('M', [field('class')])), { naming: 'snake-alias' }, analysis)
    expect(
      (result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.attribute,
    ).toBe('class_')
  })

  it('guards every model-prefixed BaseModel attribute', () => {
    const result = namingPass.run(module(model('M', [field('model_custom')])), { naming: 'snake-alias' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.attribute)
      .toBe('model_custom_')
  })

  it('keeps a base attribute for an overriding field', () => {
    const base = model('Base', [field('wireName')])
    const child = model('Child', [field('wireName')])
    child.bases = ['Base']
    const result = namingPass.run(module(child, base), { naming: 'snake-alias' }, analysis)
    const declarations = result.decls.filter(decl => decl.kind === 'model')
    expect(declarations[0]).toMatchObject({ name: 'Child', fields: [{ attribute: 'wire_name' }] })
    expect(declarations[1]).toMatchObject({ name: 'Base', fields: [{ attribute: 'wire_name' }] })
  })

  it('names a base before a subclass regardless of declaration order', () => {
    const base = model('Base', [field('class')])
    const child = model('Child', [field('class')])
    child.bases = ['Base']
    const result = namingPass.run(module(child, base), { naming: 'snake-alias' }, analysis)
    expect((result.decls[0] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.attribute)
      .toBe('class_')
    expect((result.decls[1] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.attribute)
      .toBe('class_')
  })
})
