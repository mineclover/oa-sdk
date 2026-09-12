import { describe, it, expect } from 'vitest'
import { petstoreSpec, fsdMultiDomainSpec } from './output-routing-tanstack/helpers/fixtures.js'
import {
  generateKeyFactory,
  generatePureOptionsFactory,
  generateHookHelpers,
  generateTanstackQuery,
  toWireJson,
} from './output-routing-tanstack/helpers/tanstack-harness.js'
import { validateTsSyntax } from './output-routing-tanstack/helpers/ast-validator.js'

describe('E2E TanStack Query v5 3-Tier Generator Entrypoint', () => {
  it('e2e-tanstack-1: generates hierarchical query key factories as pure tuples', () => {
    const keysCode = generateKeyFactory(petstoreSpec)
    expect(keysCode).toContain("all: ['pets'] as const")
    expect(keysCode).toContain("lists: () => [...petsKeys.all, 'list'] as const")
    expect(validateTsSyntax(keysCode).valid).toBe(true)
  })

  it('e2e-tanstack-2: generates pure queryOptions and mutationOptions', () => {
    const optionsCode = generatePureOptionsFactory(petstoreSpec)
    expect(optionsCode).toContain('listPetsQueryOptions')
    expect(optionsCode).toContain('createPetMutationOptions')
    expect(validateTsSyntax(optionsCode).valid).toBe(true)
  })

  it('e2e-tanstack-3: generates composition hook helpers', () => {
    const hooksCode = generateHookHelpers(petstoreSpec)
    expect(hooksCode).toContain('useListPetsQuery')
    expect(hooksCode).toContain('useCreatePetMutation')
    expect(hooksCode).toContain('createApiHooks')
    expect(validateTsSyntax(hooksCode).valid).toBe(true)
  })

  it('e2e-tanstack-4: generates full multi-tier suite in split and combined modes', () => {
    const split = generateTanstackQuery(fsdMultiDomainSpec, { split: true })
    expect(split.keysCode).toBeDefined()
    expect(split.queriesCode).toBeDefined()
    expect(split.hooksCode).toBeDefined()

    const combined = generateTanstackQuery(fsdMultiDomainSpec, { split: false })
    expect(combined.combinedCode).toBeDefined()
  })

  it('e2e-tanstack-5: validates wire format safety with toWireJson', () => {
    const input = {
      id: '1',
      date: new Date('2026-09-12T00:00:00.000Z'),
      fn: () => 'omit',
    }
    const wire = toWireJson(input)
    expect(typeof (wire as any).date).toBe('string')
    expect((wire as any).fn).toBeUndefined()
  })
})
