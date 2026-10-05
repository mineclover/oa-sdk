import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDirectory = resolve(__dirname, '../..')
const root = resolve(packageDirectory, '../..')
const scriptsDirectory = join(root, 'scripts')
const facadeImport = '../packages/codegen/src/schema-governance.js'

const governanceScriptNames = readdirSync(scriptsDirectory)
  .filter(name => name.endsWith('.ts') && isSchemaGovernanceScript(name))
  .sort()

describe('schema governance source boundary', () => {
  it('routes root schema and TypeSpec scripts through the facade', () => {
    const violations: string[] = []

    for (const name of governanceScriptNames) {
      const source = readFileSync(join(scriptsDirectory, name), 'utf8')
      const codegenSourceImports = [...source.matchAll(/from ['"](\.\.\/packages\/codegen\/src\/[^'"]+)['"]/g)]
        .map(match => match[1])

      for (const importedPath of codegenSourceImports) {
        if (importedPath !== facadeImport) violations.push(`${name}: ${importedPath}`)
      }
    }

    expect(violations).toEqual([])
  })

  it('keys the schemas build on the root scripts and on the codegen build behind the facade', () => {
    const turbo = readJson(join(root, 'packages/schemas/turbo.json')) as {
      tasks?: { build?: { inputs?: unknown, dependsOn?: unknown } }
    }
    const build = turbo.tasks?.build

    expect(build?.inputs).toEqual(expect.arrayContaining([
      '$TURBO_ROOT$/scripts/schema-typespec-check.ts',
      '$TURBO_ROOT$/scripts/lib/typespec-snapshot-promotion.ts',
    ]))
    // The facade's import closure reaches far beyond schema-governance.ts (config, schema-pipeline,
    // spec-projector, standalone-guards, and the dist of codegen's own dependencies). Depending on
    // codegen's build task puts that whole closure into the schemas cache key and builds it first;
    // listing codegen source globs here would miss part of it.
    expect(build?.dependsOn).toEqual(expect.arrayContaining(['@oa-sdk/codegen#build']))
  })

  it('keeps the hidden source dependency out of the workspace package graph', () => {
    const schemasManifest = readJson(join(root, 'packages/schemas/package.json')) as Record<string, unknown>
    const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

    for (const section of dependencySections) {
      const dependencies = schemasManifest[section] as Record<string, unknown> | undefined
      expect(dependencies?.['@oa-sdk/codegen'], `${section} must not create a schemas/codegen build cycle`).toBeUndefined()
    }
  })
})

function isSchemaGovernanceScript(name: string): boolean {
  return name.startsWith('schema-')
    || name.startsWith('typespec-')
    || name.startsWith('check-typespec-')
    || name === 'check-contract-version.ts'
    || name === 'spec-diff.ts'
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}
