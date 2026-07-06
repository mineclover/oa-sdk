import { describe, expect, it } from 'vitest'

import { compileDpmPlan } from '../src/index.js'
import { createCompileInput } from './support/compiler-fixtures.js'

describe('DPM compiler validation gate', () => {
  it('refuses to compile invalid validator output', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[0].transform = { type: 'keep' }

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('SAF001')
    expect('plan' in result).toBe(false)
  })

  it('refuses manifests that reuse an approved registry name with different relationship semantics', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.relationships[0].namespace = 'account'

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('REL013')
  })

  it('refuses columns that reference a relationship absent from the manifest relationship set', () => {
    const input = createCompileInput()
    const manifest = structuredClone(input.manifest) as Record<string, any>
    manifest.columns[1].relationship = 'rel_missing_customer'
    manifest.columns[1].transform.relationship = 'rel_missing_customer'

    const result = compileDpmPlan({
      ...input,
      manifest,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected compile failure')
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('SAF012')
  })
})
