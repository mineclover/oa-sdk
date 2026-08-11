import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createTypescriptAlgebra as createRootAlgebra,
  projectSchemaToTs as projectFromRoot,
  type SchemaToTsProjection as RootProjection,
} from '../../index.js'
import {
  createTypescriptAlgebra as createTypegenAlgebra,
  projectSchemaToTs as projectFromTypegen,
  type SchemaToTsProjection as TypegenProjection,
} from '../../typegen/index.js'
import {
  createTypescriptAlgebra as createBrowserAlgebra,
  projectSchemaToTs as projectFromBrowser,
  type SchemaToTsProjection as BrowserProjection,
} from '../../typegen/browser.js'

describe('schema fidelity — public entrypoints', () => {
  it('exports the factory and structured projection from all typegen surfaces', () => {
    expectTypeOf<RootProjection>().toEqualTypeOf<TypegenProjection>()
    expectTypeOf<BrowserProjection>().toEqualTypeOf<TypegenProjection>()

    expect(createRootAlgebra({ refNameOverrides: { '#value': 'RootValue' } }).ref('#value'))
      .toBe('RootValue')
    expect(createTypegenAlgebra({ refNameOverrides: { '#value': 'TypegenValue' } }).ref('#value'))
      .toBe('TypegenValue')
    expect(createBrowserAlgebra({ refNameOverrides: { '#value': 'BrowserValue' } }).ref('#value'))
      .toBe('BrowserValue')

    expect(projectFromRoot({ type: 'string' })).toEqual(projectFromTypegen({ type: 'string' }))
    expect(projectFromBrowser({ type: 'string' })).toEqual(projectFromTypegen({ type: 'string' }))
  })
})
