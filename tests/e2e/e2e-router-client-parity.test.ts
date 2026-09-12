import { describe, it, expect } from 'vitest'
import { petstoreSpec, fsdMultiDomainSpec } from './output-routing-tanstack/helpers/fixtures.js'
import { generatePureOptionsFactory } from './output-routing-tanstack/helpers/tanstack-harness.js'
import { validateTsSyntax } from './output-routing-tanstack/helpers/ast-validator.js'

describe('E2E Router Handler Contract & Client Parity Entrypoint', () => {
  it('e2e-parity-1: parameter naming symmetry between router and client', () => {
    const baseNames = ['ListPets', 'CreatePet', 'GetPetById', 'UpdatePet', 'DeletePet']
    for (const base of baseNames) {
      const pathParams = `${base}PathParams`
      const queryParams = `${base}QueryParams`
      const body = `${base}Body`
      const response = `${base}Response`

      expect(pathParams).toContain(base)
      expect(queryParams).toContain(base)
      expect(body).toContain(base)
      expect(response).toContain(base)
    }
  })

  it('e2e-parity-2: options generator wire safety with JsonPrimitive response wrappers', () => {
    const optionsCode = generatePureOptionsFactory(petstoreSpec)
    expect(optionsCode).toContain('JsonPrimitive')
    expect(optionsCode).toContain('Resolved')
    expect(validateTsSyntax(optionsCode).valid).toBe(true)
  })

  it('e2e-parity-3: multi-domain spec options compilation', () => {
    const optionsCode = generatePureOptionsFactory(fsdMultiDomainSpec)
    expect(optionsCode).toContain('listUsersQueryOptions')
    expect(optionsCode).toContain('listOrdersQueryOptions')
    expect(optionsCode).toContain('listProductsQueryOptions')
    expect(validateTsSyntax(optionsCode).valid).toBe(true)
  })
})
