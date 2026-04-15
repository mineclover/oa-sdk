import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  schemaToTs as rootSchemaToTs,
  type SchemaToTsOptions as RootSchemaToTsOptions,
  type TypegenOptions as RootTypegenOptions,
} from '../index.js'
import {
  schemaToTs as typegenSchemaToTs,
  type SchemaToTsOptions as TypegenSchemaToTsOptions,
  type TypegenOptions as TypegenTypegenOptions,
} from '../typegen/index.js'

type PackageJson = {
  exports: Record<string, unknown>
}

describe('public codegen API surface', () => {
  it('exports typegen option types from supported public entrypoints', () => {
    expectTypeOf<RootTypegenOptions>().toEqualTypeOf<TypegenTypegenOptions>()
    expectTypeOf<RootSchemaToTsOptions>().toEqualTypeOf<TypegenSchemaToTsOptions>()

    const options: RootSchemaToTsOptions = {
      includeAnnotations: true,
      refNameOverrides: { '#/components/schemas/User': 'UserModel' },
    }

    expect(rootSchemaToTs({ $ref: '#/components/schemas/User' }, options)).toBe('UserModel')
    expect(typegenSchemaToTs({ type: 'string' }, options)).toBe('string')
  })

  it('keeps deep typegen modules out of package exports', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageJson

    expect(Object.keys(packageJson.exports).sort()).toEqual(['.', './drizzle', './typegen'])
    expect(packageJson.exports).not.toHaveProperty('./typegen/generate-types')
    expect(packageJson.exports).not.toHaveProperty('./typegen/schema-to-ts')
  })
})
