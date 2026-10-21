import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateStandaloneGuards } from '../src/guards/index.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

/**
 * TypeSpec emits namespace-qualified error contracts as component names containing a dot
 * (e.g. `OaSdkTypeSpec.StandardError`). Ajv refuses to export an invalid identifier, so the
 * guard name has to be normalized while the declared type keeps the qualified spelling.
 */
describe('Standalone guards for component names that are not JS identifiers', () => {
  let tmpDir: string

  const schemaDoc = {
    openapi: '3.1.0',
    info: { title: 'Dotted names', version: '1.0.0' },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        'OaSdkTypeSpec.StandardError': {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' }, code: { type: 'integer' } },
        },
      },
    },
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-ast-sync-dotted-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('normalizes the export name and keeps the qualified type in monolithic mode', async () => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      typeImportSpecifier: '@app/contracts',
    })

    const guardsJs = artifacts.find(a => a.filePath.endsWith('guards.js'))!
    const guardsDts = artifacts.find(a => a.filePath.endsWith('guards.d.ts'))!

    expect(guardsJs.content).toContain('export function isOaSdkTypeSpec_StandardError(')
    expect(guardsJs.content).not.toContain('isOaSdkTypeSpec.StandardError(')

    expect(guardsDts.content).toContain(
      'export declare function isOaSdkTypeSpec_StandardError(data: unknown): data is OaSdkTypeSpec.StandardError;',
    )
    // `import type { A.B }` is not valid TypeScript; import the namespace root instead.
    expect(guardsDts.content).toMatch(/import type \{[^}]*\bOaSdkTypeSpec\b[^}]*\} from '@app\/contracts';/)
    expect(guardsDts.content).not.toContain('import type { User, OaSdkTypeSpec.StandardError }')

    const mod = await import(new URL(`file://${guardsJs.filePath}`).href)
    expect(mod.isOaSdkTypeSpec_StandardError({ message: 'boom' })).toBe(true)
    expect(mod.isOaSdkTypeSpec_StandardError({ message: 'boom', code: 'nope' })).toBe(false)
    expect(mod.isOaSdkTypeSpec_StandardError({})).toBe(false)
  })

  it('uses normalized file names and import specifiers in split mode', async () => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      split: true,
      typeImportSpecifier: '@app/contracts',
    })

    const files = artifacts.map(a => path.basename(a.filePath))
    expect(files).toContain('OaSdkTypeSpec_StandardError.js')
    expect(files).toContain('OaSdkTypeSpec_StandardError.d.ts')
    expect(files.some(name => name.includes('OaSdkTypeSpec.StandardError'))).toBe(false)

    const indexJs = artifacts.find(a => a.filePath.endsWith('index.js'))!
    expect(indexJs.content).toContain("export * from './guards/OaSdkTypeSpec_StandardError.js';")

    const guardDts = artifacts.find(a => a.filePath.endsWith('OaSdkTypeSpec_StandardError.d.ts'))!
    expect(guardDts.content).toContain("import type { OaSdkTypeSpec } from '@app/contracts';")
    expect(guardDts.content).toContain('data is OaSdkTypeSpec.StandardError')
  })

  it('matches a --schemas filter written with the original dotted name', async () => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: schemaDoc,
      outDir: tmpDir,
      schemas: ['OaSdkTypeSpec.StandardError'],
      split: true,
    })

    const guards = artifacts.filter(a => a.filePath.endsWith('.js') && !a.filePath.endsWith('index.js'))
    expect(guards).toHaveLength(1)
    expect(guards[0]!.content).toContain('export function isOaSdkTypeSpec_StandardError(')
  })
})
