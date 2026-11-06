import { describe, expect, it } from 'vitest'
import { polymorphicRefsPass } from '../../passes/polymorphic-refs.js'
import { analysis, field, model, module } from './helpers.js'

describe('polymorphicRefs', () => {
  it('creates a tagged alias, narrows tags, and rewrites refs', () => {
    const base = model('Base', [field('kind')])
    const variant = model('Variant', [field('kind')])
    variant.bases = ['Base']
    const user = model('User', [field('value', { kind: 'ref', target: 'Base' })])
    const result = polymorphicRefsPass.run(module(base, variant, user), {}, {
      ...analysis,
      discriminatorFamilies: [{ base: 'Base', propertyName: 'kind', variants: [{ tag: 'v', schema: 'Variant' }] }],
    })
    expect(result.decls.map(decl => decl.name)).toEqual(['Base', 'Variant', 'BaseUnion', 'User'])
    expect((result.decls[1] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.type)
      .toEqual({ kind: 'literal', values: ['v'] })
    expect((result.decls[3] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.type)
      .toEqual({ kind: 'ref', target: 'BaseUnion' })
  })

  it('places the alias directly after the final variant', () => {
    const base = model('Base')
    const first = model('First')
    first.bases = ['Base']
    const second = model('Second')
    second.bases = ['Base']
    const result = polymorphicRefsPass.run(module(base, first, second), {}, {
      ...analysis,
      discriminatorFamilies: [{
        base: 'Base', propertyName: 'kind', variants: [
          { tag: 'a', schema: 'First' }, { tag: 'b', schema: 'Second' },
        ],
      }],
    })
    expect(result.decls.map(decl => decl.name)).toEqual(['Base', 'First', 'Second', 'BaseUnion'])
  })

  it('sets base and variant discriminator roles', () => {
    const base = model('Base')
    const variant = model('Variant')
    variant.bases = ['Base']
    const result = polymorphicRefsPass.run(module(base, variant), {}, {
      ...analysis,
      discriminatorFamilies: [{ base: 'Base', propertyName: 'kind', variants: [{ tag: 'v', schema: 'Variant' }] }],
    })
    expect(result.decls[0]).toMatchObject({ discriminator: { role: 'base', propertyName: 'kind' } })
    expect(result.decls[1]).toMatchObject({ discriminator: { role: 'variant', tag: 'v' } })
  })

  it('narrows a non-literal variant tag', () => {
    const base = model('Base')
    const variant = model('Variant', [field('kind', { kind: 'builtin', name: 'str' })])
    variant.bases = ['Base']
    const result = polymorphicRefsPass.run(module(base, variant), {}, {
      ...analysis,
      discriminatorFamilies: [{ base: 'Base', propertyName: 'kind', variants: [{ tag: 'v', schema: 'Variant' }] }],
    })
    expect((result.decls[1] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.type)
      .toEqual({ kind: 'literal', values: ['v'] })
  })

  it('rewrites nested references while leaving variant bases intact', () => {
    const base = model('Base')
    const variant = model('Variant')
    variant.bases = ['Base']
    const user = model('User', [field('nested', { kind: 'list', item: { kind: 'ref', target: 'Base' } })])
    const result = polymorphicRefsPass.run(module(base, variant, user), {}, {
      ...analysis,
      discriminatorFamilies: [{ base: 'Base', propertyName: 'kind', variants: [{ tag: 'v', schema: 'Variant' }] }],
    })
    expect((result.decls[3] as Extract<typeof result.decls[number], { kind: 'model' }>).fields[0]!.type)
      .toEqual({ kind: 'list', item: { kind: 'ref', target: 'BaseUnion' } })
    expect((result.decls[1] as Extract<typeof result.decls[number], { kind: 'model' }>).bases).toEqual(['Base'])
  })

  it('warns when a discriminator has no resolvable variants', () => {
    const base = model('Base')
    const result = polymorphicRefsPass.run(module(base), {}, {
      ...analysis,
      discriminatorFamilies: [{ base: 'Base', propertyName: 'kind', variants: [] }],
    })
    expect(result.decls).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      code: 'pydantic/discriminator-without-variants', severity: 'warning',
    })
  })
})
