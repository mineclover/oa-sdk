import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import {
  generateTypesFromSpec as browserGenerateTypesFromSpec,
  type TypegenOptions as BrowserTypegenOptions,
} from '../typegen/browser.js'

type PackageJson = {
  exports: Record<string, unknown>
}

const pkgDir = fileURLToPath(new URL('../../', import.meta.url))
const packageJsonPath = join(pkgDir, 'package.json')
const tscBin = join(pkgDir, 'node_modules/.bin/tsc')

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson
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
    expect(browserGenerateTypesFromSpec({
      openapi: '3.2.0',
      info: { title: 'Browser fixture', version: '1.0.0' },
      paths: {},
    }, { banner: false } satisfies BrowserTypegenOptions)).toBe('')
  })

  it('typechecks documented package imports for typegen option types', () => {
    const packageJson = readPackageJson()
    expect(packageJson.exports).toHaveProperty('.')
    expect(packageJson.exports).toHaveProperty('./typegen')

    const tmp = mkdtempSync(join(tmpdir(), 'oa-sdk-codegen-public-api-'))
    try {
      writeFileSync(join(tmp, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
      writeFileSync(
        join(tmp, 'fixture.ts'),
        `
import {
  schemaToTs,
  type SchemaToTsOptions as RootSchemaToTsOptions,
  type TypegenOptions as RootTypegenOptions,
} from '@oa-sdk/codegen'
import {
  generateTypes,
  schemaToTs as typegenSchemaToTs,
  type SchemaToTsOptions as TypegenSchemaToTsOptions,
  type TypegenOptions as TypegenTypegenOptions,
} from '@oa-sdk/codegen/typegen'
import {
  generateTypesFromSpec as browserGenerateTypesFromSpec,
  type TypegenOptions as BrowserTypegenOptions,
} from '@oa-sdk/codegen/typegen/browser'

const rootTypegenOptions: RootTypegenOptions = {
  banner: false,
  style: 'type',
  includeAnnotations: true,
  basePath: 'openapi.yaml',
  warnings: [],
}
const typegenTypegenOptions: TypegenTypegenOptions = rootTypegenOptions

const rootSchemaOptions: RootSchemaToTsOptions = {
  includeAnnotations: true,
  refNameOverrides: { '#/components/schemas/User': 'UserModel' },
}
const typegenSchemaOptions: TypegenSchemaToTsOptions = rootSchemaOptions

schemaToTs({ type: 'string' }, typegenSchemaOptions)
typegenSchemaToTs({ $ref: '#/components/schemas/User' }, rootSchemaOptions)
generateTypes({ schemas: {}, operations: [] }, typegenTypegenOptions)

const browserOptions: BrowserTypegenOptions = {
  banner: false,
  includeAnnotations: true,
}
browserGenerateTypesFromSpec({
  openapi: '3.2.0',
  info: { title: 'Browser fixture', version: '1.0.0' },
  paths: {},
}, browserOptions)
`,
        'utf8',
      )

      writeFileSync(
        join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            target: 'ES2022',
            lib: ['ES2022'],
            types: ['node'],
            typeRoots: [join(pkgDir, 'node_modules/@types')],
            skipLibCheck: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            verbatimModuleSyntax: true,
            paths: {
              '@oa-sdk/codegen': [join(pkgDir, 'src/index.ts')],
              '@oa-sdk/codegen/typegen': [join(pkgDir, 'src/typegen/index.ts')],
              '@oa-sdk/codegen/typegen/browser': [join(pkgDir, 'src/typegen/browser.ts')],
            },
          },
          include: ['fixture.ts'],
        }),
        'utf8',
      )

      execFileSync(tscBin, ['--project', join(tmp, 'tsconfig.json')], {
        cwd: tmp,
        encoding: 'utf8',
        timeout: 30_000,
      })
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      expect.fail(
        `Public API package import fixture failed:\n${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`,
      )
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('keeps deep typegen modules out of package exports', () => {
    const packageJson = readPackageJson()

    expect(Object.keys(packageJson.exports).sort()).toEqual(['.', './apitomy', './drizzle', './spec-lens', './typegen', './typegen/browser'])
    expect(packageJson.exports).not.toHaveProperty('./typegen/generate-types')
    expect(packageJson.exports).not.toHaveProperty('./typegen/schema-to-ts')
  })
})
