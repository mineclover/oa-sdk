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

  it('tracks the source facade and its implementation as schemas build inputs', () => {
    const turbo = readJson(join(root, 'packages/schemas/turbo.json')) as {
      tasks?: { build?: { inputs?: unknown } }
    }
    const inputs = turbo.tasks?.build?.inputs

    expect(inputs).toEqual(expect.arrayContaining([
      '$TURBO_ROOT$/scripts/schema-typespec-check.ts',
      '$TURBO_ROOT$/scripts/lib/typespec-snapshot-promotion.ts',
      '$TURBO_ROOT$/packages/codegen/src/schema-governance.ts',
      '$TURBO_ROOT$/packages/codegen/src/cli/lib/**',
    ]))
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
