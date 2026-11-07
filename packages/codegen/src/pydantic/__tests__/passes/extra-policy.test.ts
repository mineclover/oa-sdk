import { describe, expect, it } from 'vitest'
import { extraPolicyPass } from '../../passes/extra-policy.js'
import { analysis, model, module } from './helpers.js'

describe('extraPolicy', () => {
  it('maps closed, typed-map, and open models', () => {
    const closed = model('Closed')
    closed.openness = { kind: 'closed' }
    const typed = model('Typed')
    typed.openness = { kind: 'typed-map', value: { kind: 'builtin', name: 'str' } }
    const result = extraPolicyPass.run(module(closed, typed, model('Open')), { extra: 'forbid' }, analysis)
    expect(result.decls.map(decl => decl.kind === 'model' ? decl.extra : null)).toEqual(['forbid', 'allow', 'forbid'])
  })

  it('uses the ignore option for open models', () => {
    const result = extraPolicyPass.run(module(model('Open')), { extra: 'ignore' }, analysis)
    expect(result.decls[0]).toMatchObject({ extra: 'ignore' })
  })

  it('uses the allow option for open models', () => {
    const result = extraPolicyPass.run(module(model('Open')), { extra: 'allow' }, analysis)
    expect(result.decls[0]).toMatchObject({ extra: 'allow' })
  })
})
