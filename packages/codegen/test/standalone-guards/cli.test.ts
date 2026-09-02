import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { generate } from '../../src/cli/commands/generate.js'

describe('CLI generate --target standalone-guards Unit Tests', () => {
  const createTempDir = async () => {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-cli-guards-'))
  }

  it('generates guards from JSON schema file via CLI command', async () => {
    const tempDir = await createTempDir()
    const schemaFile = path.join(tempDir, 'schema.json')
    const outDir = path.join(tempDir, 'guards')

    const schemaDoc = {
      $defs: {
        Config: {
          type: 'object',
          required: ['debug'],
          properties: { debug: { type: 'boolean' } },
        },
      },
    }

    await fs.writeFile(schemaFile, JSON.stringify(schemaDoc, null, 2), 'utf8')

    await generate.run({
      target: 'standalone-guards',
      input: schemaFile,
      'out-dir': outDir,
      'type-import': '@my/types',
      'module-format': 'esm',
    })

    const files = await fs.readdir(outDir)
    expect(files).toContain('guards.js')
    expect(files).toContain('guards.d.ts')
    expect(files).toContain('index.js')
    expect(files).toContain('index.d.ts')

    const jsContent = await fs.readFile(path.join(outDir, 'guards.js'), 'utf8')
    expect(jsContent).toContain('function isConfig')

    const dtsContent = await fs.readFile(path.join(outDir, 'guards.d.ts'), 'utf8')
    expect(dtsContent).toContain("import type { Config } from '@my/types';")
    expect(dtsContent).toContain('export declare function isConfig(data: unknown): data is Config;')
  })

  it('generates guards from YAML OpenAPI spec file via CLI command', async () => {
    const tempDir = await createTempDir()
    const yamlFile = path.join(tempDir, 'spec.yaml')
    const outDir = path.join(tempDir, 'dist-guards')

    const yamlContent = `
openapi: 3.1.0
components:
  schemas:
    UserProfile:
      type: object
      required:
        - name
      properties:
        name:
          type: string
`
    await fs.writeFile(yamlFile, yamlContent, 'utf8')

    await generate.run({
      target: 'standalone-guards',
      input: yamlFile,
      output: outDir,
    })

    const files = await fs.readdir(outDir)
    expect(files).toContain('guards.js')
    expect(files).toContain('guards.d.ts')

    const jsContent = await fs.readFile(path.join(outDir, 'guards.js'), 'utf8')
    expect(jsContent).toContain('function isUserProfile')
  })

  it('throws CliExitError when input file does not exist', async () => {
    const tempDir = await createTempDir()
    await expect(
      generate.run({
        target: 'standalone-guards',
        input: path.join(tempDir, 'non-existent.json'),
        'out-dir': tempDir,
      })
    ).rejects.toThrow()
  })
})
