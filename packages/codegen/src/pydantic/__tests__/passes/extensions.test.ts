import { describe, expect, it } from 'vitest'
import { extensionsPass } from '../../passes/extensions.js'
import { analysis, field, model, module } from './helpers.js'

describe('extensions', () => {
  it('sorts JSON extensions and drops non-serializable values', () => {
    const value = model('M', [field('value')])
    value.extensions = { 'x-z': { b: 1, a: 2 }, 'x-bad': Number.NaN }
    const result = extensionsPass.run(module(value), { extensions: 'preserve' }, analysis)
    expect(result.decls[0]).toMatchObject({ extensions: { 'x-z': { a: 2, b: 1 } } })
    expect(result.diagnostics[0]?.code).toBe('pydantic/extension-dropped')
  })

  it('sorts nested extension object keys deterministically', () => {
    const value = model('M')
    value.extensions = { 'x-meta': { z: 1, a: { y: true, b: false } } }
    const result = extensionsPass.run(module(value), { extensions: 'preserve' }, analysis)
    expect(result.decls[0]).toMatchObject({ extensions: { 'x-meta': { a: { b: false, y: true }, z: 1 } } })
  })

  it('drops field and model extensions when configured', () => {
    const value = model('M', [field('value')])
    value.extensions = { 'x-model': true }
    value.fields[0]!.extensions = { 'x-field': true }
    const result = extensionsPass.run(module(value), { extensions: 'drop' }, analysis)
    expect(result.decls[0]).not.toHaveProperty('extensions')
    expect(result.decls[0]?.kind === 'model' ? result.decls[0].fields[0] : undefined).not.toHaveProperty('extensions')
  })
})
