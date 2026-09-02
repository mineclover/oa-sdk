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

  it('generates split modular guards via CLI command (--split)', async () => {
    const tempDir = await createTempDir()
    const schemaFile = path.join(tempDir, 'spec.json')
    const outDir = path.join(tempDir, 'modular-guards')

    const schemaDoc = {
      $defs: {
        SurfaceBlock: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        SurfaceParam: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } },
      },
    }

    await fs.writeFile(schemaFile, JSON.stringify(schemaDoc, null, 2), 'utf8')

    await generate.run({
      target: 'standalone-guards',
      input: schemaFile,
      'out-dir': outDir,
      split: true,
      'type-import': '@my/surface',
    })

    const guardsDir = path.join(outDir, 'guards')
    const guardFiles = await fs.readdir(guardsDir)
    expect(guardFiles).toContain('SurfaceBlock.js')
    expect(guardFiles).toContain('SurfaceBlock.d.ts')
    expect(guardFiles).toContain('SurfaceParam.js')
    expect(guardFiles).toContain('SurfaceParam.d.ts')

    const rootFiles = await fs.readdir(outDir)
    expect(rootFiles).toContain('index.js')
    expect(rootFiles).toContain('index.d.ts')

    const indexJs = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
    expect(indexJs).toContain("export * from './guards/SurfaceBlock.js';")
    expect(indexJs).toContain("export * from './guards/SurfaceParam.js';")
  })

  it('filters schemas via CLI command (--schemas)', async () => {
    const tempDir = await createTempDir()
    const schemaFile = path.join(tempDir, 'spec.json')
    const outDir = path.join(tempDir, 'filtered-guards')

    const schemaDoc = {
      $defs: {
        SurfaceBlock: { type: 'object', properties: { id: { type: 'string' } } },
        SurfaceParam: { type: 'object', properties: { key: { type: 'string' } } },
        OtherType: { type: 'object', properties: { val: { type: 'number' } } },
      },
    }

    await fs.writeFile(schemaFile, JSON.stringify(schemaDoc, null, 2), 'utf8')

    await generate.run({
      target: 'standalone-guards',
      input: schemaFile,
      'out-dir': outDir,
      schemas: 'isSurfaceBlock,isSurfaceParam',
    })

    const jsContent = await fs.readFile(path.join(outDir, 'guards.js'), 'utf8')
    expect(jsContent).toContain('function isSurfaceBlock')
    expect(jsContent).toContain('function isSurfaceParam')
    expect(jsContent).not.toContain('function isOtherType')
  })

  it('combines --split and --schemas via CLI command', async () => {
    const tempDir = await createTempDir()
    const schemaFile = path.join(tempDir, 'spec.json')
    const outDir = path.join(tempDir, 'split-filtered-guards')

    const schemaDoc = {
      $defs: {
        SurfaceBlock: { type: 'object', properties: { id: { type: 'string' } } },
        SurfaceParam: { type: 'object', properties: { key: { type: 'string' } } },
        OtherType: { type: 'object', properties: { val: { type: 'number' } } },
      },
    }

    await fs.writeFile(schemaFile, JSON.stringify(schemaDoc, null, 2), 'utf8')

    await generate.run({
      target: 'standalone-guards',
      input: schemaFile,
      'out-dir': outDir,
      split: true,
      schemas: 'SurfaceBlock',
    })

    const guardsDir = path.join(outDir, 'guards')
    const guardFiles = await fs.readdir(guardsDir)
    expect(guardFiles).toContain('SurfaceBlock.js')
    expect(guardFiles).toContain('SurfaceBlock.d.ts')
    expect(guardFiles).not.toContain('SurfaceParam.js')
    expect(guardFiles).not.toContain('OtherType.js')

    const indexJs = await fs.readFile(path.join(outDir, 'index.js'), 'utf8')
    expect(indexJs).toContain("export * from './guards/SurfaceBlock.js';")
    expect(indexJs).not.toContain('SurfaceParam')
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
