import { describe, expect, it } from 'vitest'
import { planImpactScope, type GenerationUnit } from '../cli/lib/impact-scope.js'

const units: GenerationUnit[] = [
  { unitId: 'schema:user', sourceFiles: ['users.yaml'], outputFiles: ['types/user.ts'] },
  {
    unitId: 'client:users',
    sourceFiles: ['client.config.ts'],
    outputFiles: ['client/users.ts'],
    dependencyUnitIds: ['schema:user'],
  },
  {
    unitId: 'router:users',
    sourceFiles: ['router.config.ts'],
    outputFiles: ['router/users.ts'],
    dependencyUnitIds: ['schema:user'],
  },
  {
    unitId: 'schema:health',
    sourceFiles: ['health.yaml'],
    outputFiles: ['types/health.ts'],
  },
]

describe('incremental generation impact planner', () => {
  it('propagates a leaf change to dependent units and preserves unrelated output', () => {
    const plan = planImpactScope(units, ['users.yaml'])

    expect(plan.dirtyUnitIds).toEqual(['client:users', 'router:users', 'schema:user'])
    expect(plan.preservedUnitIds).toEqual(['schema:health'])
    expect(plan.preservedFiles).toEqual(['types/health.ts'])
  })

  it('closes high-fanout dependency impact transitively and sorts deterministically', () => {
    const plan = planImpactScope([
      { unitId: 'base', sourceFiles: ['base.tsp'], outputFiles: ['base.ts'] },
      { unitId: 'middle', sourceFiles: ['middle.tsp'], outputFiles: ['middle.ts'], dependencyUnitIds: ['base'] },
      { unitId: 'leaf', sourceFiles: ['leaf.tsp'], outputFiles: ['leaf.ts'], dependencyUnitIds: ['middle'] },
    ], ['base.tsp'], { reason: 'ref-change' })

    expect(plan.reason).toBe('ref-change')
    expect(plan.dirtyUnitIds).toEqual(['base', 'leaf', 'middle'])
    expect(plan.preservedFiles).toEqual([])
  })

  it('forces every unit dirty for an untrusted cache or index', () => {
    const plan = planImpactScope(units, [], { forceFull: true, reason: 'fallback' })

    expect(plan.reason).toBe('fallback')
    expect(plan.dirtyUnitIds).toEqual(['client:users', 'router:users', 'schema:health', 'schema:user'])
    expect(plan.preservedUnitIds).toEqual([])
  })

  it('rejects duplicate output ownership and missing dependencies', () => {
    expect(() => planImpactScope([
      { unitId: 'a', sourceFiles: ['a'], outputFiles: ['shared.ts'] },
      { unitId: 'b', sourceFiles: ['b'], outputFiles: ['shared.ts'] },
    ], ['a'])).toThrow(/multiple owners/)

    expect(() => planImpactScope([
      { unitId: 'a', sourceFiles: ['a'], outputFiles: ['a.ts'], dependencyUnitIds: ['missing'] },
    ], ['a'])).toThrow(/missing dependency/)
  })
})
