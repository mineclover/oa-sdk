import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OasDocument } from '@oa-sdk/parser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../cli/commands/generate.js'
import { validate } from '../cli/commands/validate.js'
import type { CompanionCommandContext } from '../cli/lib/companion-packages.js'
import { validateOaConfig } from '../config.js'
import {
  createTspBuilder,
  defineTspConfig,
  pluginClient,
  pluginRouter,
  pluginRpc,
  pluginTypescript,
  pluginWire,
  runTspPluginPipeline,
  validateTspConfig,
} from '../plugin/index.js'
import {
  projectTargetGuards,
  projectTargetSpec,
  type TargetSpecProjectionResult,
} from '../spec-projector.js'
import { generateStandaloneGuards } from '../standalone-guards/index.js'
import { generateTypesFromSpec } from '../typegen/generate-types.js'
import { typecheckGeneratedFiles } from './plugin/helpers/typecheck-generated.js'

const dataDocument: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Data', version: '1' },
  paths: {},
  components: {
    schemas: {
      'Domain.User': {
        type: 'object',
        required: ['age', 'address'],
        properties: {
          age: { type: 'integer', minimum: 18 },
          address: { $ref: '#/components/schemas/Address' },
        },
      },
      Address: {
        type: 'object',
        required: ['city'],
        properties: { city: { type: 'string', minLength: 1 } },
      },
    },
  },
}

describe('Purpose-isolated pipelines share contract semantics', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oa-pipeline-isolation-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // Configuration and purpose admission.

  it('uses the same purpose field with defineTspConfig, runner and builder', async () => {
    const input = join(root, 'models.tsp')
    writeFileSync(input, '@service namespace Data; model User { id: string; }')
    const config = defineTspConfig({
      purpose: 'data',
      input,
      output: join(root, 'out'),
      plugins: [pluginTypescript()],
      dryRun: true,
    })
    const result = await runTspPluginPipeline(config)
    expect(result.success).toBe(true)
    expect(result.routesCount).toBe(0)
    expect(result.files.find(file => file.path === 'types.ts')?.content).toContain('User')
    expect((await createTspBuilder(config).build()).files).toEqual(result.files)
    expect(existsSync(join(root, 'out'))).toBe(false)
  })

  it.each(['api', 'interface'] as const)('compiles real TypeSpec consumer artifacts for purpose=%s', async purpose => {
    const result = await createTspBuilder(defineTspConfig({
      purpose,
      input: resolve(import.meta.dirname, '../../../../test/e2e/typespec-plugin/fixtures/petstore/main.tsp'),
      output: join(root, purpose),
      dryRun: true,
      plugins: [
        pluginTypescript({ style: purpose === 'interface' ? 'interface' : 'type' }),
        pluginRouter({ target: 'hono' }),
      ],
    })).build()
    expect(result.success).toBe(true)
    expect(result.routesCount).toBeGreaterThan(0)
    const files = Object.fromEntries(result.files.map(file => [file.path, file.content]))
    expect(typecheckGeneratedFiles({ files, packages: ['hono'], compilerOptions: { skipLibCheck: false } })).toEqual([])
    expect(existsSync(join(root, purpose))).toBe(false)
  })

  it('rejects model loss, endpoint mixing and incompatible plugins before writing', async () => {
    const input = join(root, 'models.tsp')
    writeFileSync(input, 'namespace Data; model User { id: string; }')
    const config = { purpose: 'data' as const, input, output: join(root, 'out') }
    await expect(runTspPluginPipeline(config)).rejects.toThrow('@service')
    await expect(runTspPluginPipeline(
      { ...config, plugins: [pluginTypescript(), pluginClient()] },
      { document: dataDocument },
    )).rejects.toThrow('does not support purpose')
    await expect(runTspPluginPipeline(
      { ...config, purpose: 'api' },
      { document: dataDocument },
    )).rejects.toThrow('at least one HTTP operation')
    await expect(runTspPluginPipeline(config, {
      document: {
        ...dataDocument,
        paths: {
          '/ping': { get: { operationId: 'ping', responses: { '204': { description: 'ok' } } } },
        },
      },
    })).rejects.toThrow('must not contain HTTP operations')
    expect(existsSync(join(root, 'out'))).toBe(false)
  })

  it('applies the same admission rule to config-driven targets', async () => {
    writeFileSync(join(root, 'models.json'), JSON.stringify(dataDocument))
    const target = { id: 'models', schemaEntry: 'models.json', outDir: 'out' }
    await expect(projectTargetSpec({ ...target, purpose: 'api' }, root)).rejects.toThrow('at least one HTTP operation')
    expect((await projectTargetSpec({ ...target, purpose: 'data' }, root)).schemaCount).toBe(2)
    expect((await projectTargetSpec({ ...target, purpose: 'interface' }, root)).schemaCount).toBe(2)
  })

  it('rejects unknown purpose values through both configuration APIs', () => {
    expect(() => validateTspConfig({ input: 'models.tsp', purpose: 'other' })).toThrow('purpose')
    expect(validateOaConfig({
      specs: [{
        id: 'data',
        purpose: 'other',
        profile: 'component-bundle',
        schemaEntry: 'models.json',
        outDir: 'out',
      }],
    }).errors).toContainEqual(expect.objectContaining({ path: 'specs[0].purpose' }))
  })

  // Failed builds preserve the previous output.

  it('does not replace interfaces when the shipped RPC plugin reports a contract error', async () => {
    const output = join(root, 'rpc')
    writeFileSync(join(root, 'previous.ts'), 'keep')
    const document: OasDocument = {
      openapi: '3.2.0',
      info: dataDocument.info,
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'id', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    }
    const result = await runTspPluginPipeline({
      purpose: 'interface',
      input: 'unused.tsp',
      output,
      plugins: [pluginRpc()],
    }, { document })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'rpc-contract/field-collision', severity: 'error' }))
    expect(result.emittedFiles).toEqual([])
    expect(existsSync(output)).toBe(false)
    expect(readFileSync(join(root, 'previous.ts'), 'utf8')).toBe('keep')
  })

  it('allows data codecs but refuses wire RPC output in a data pipeline', async () => {
    const result = await runTspPluginPipeline({
      purpose: 'data',
      input: 'unused.tsp',
      output: join(root, 'out'),
      plugins: [pluginTypescript(), pluginWire({ codecs: ['rpc-contract'] })],
    }, { document: dataDocument })
    expect(result.success).toBe(false)
    expect(result.emittedFiles).toEqual([])
    expect(existsSync(join(root, 'out'))).toBe(false)
  })

  // Config-driven CLI targets use the same isolation rules.

  it('does not load endpoint companions or emit HTTP artifacts for a data-only CLI target', async () => {
    writeFileSync(join(root, 'models.json'), JSON.stringify(dataDocument))
    writeFileSync(join(root, 'oa.config.json'), JSON.stringify({
      rootDir: '.',
      specs: [{
        id: 'models',
        purpose: 'data',
        profile: 'component-bundle',
        schemaEntry: 'models.json',
        outDir: 'out',
      }],
      guards: { outDir: 'guards' },
    }))
    const importCompanion = vi.fn(async () => {
      throw new Error('data must not load endpoint companions')
    })
    const context: CompanionCommandContext = { cwd: root, projectRoot: root, importCompanion }
    await generate.run({}, context)
    expect(importCompanion).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'out/models.openapi.json'))).toBe(true)
    expect(existsSync(join(root, 'out/models.contract.ts'))).toBe(false)
    expect(existsSync(join(root, 'out/models.client.ts'))).toBe(false)
    expect(existsSync(join(root, 'out/models.queries.ts'))).toBe(false)
    expect(readFileSync(join(root, 'guards/guards.d.ts'), 'utf8')).toContain("from './types.js'")
    expect(readFileSync(join(root, 'guards/types.d.ts'), 'utf8')).toContain('DomainUser')
  })

  it('validates purpose even when a stored artifact already exists', async () => {
    writeFileSync(join(root, 'oa.config.json'), JSON.stringify({
      rootDir: '.',
      specs: [{
        id: 'models',
        purpose: 'data',
        profile: 'component-bundle',
        schemaEntry: 'models.json',
        outDir: 'out',
      }],
    }))
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'out/models.openapi.json'), JSON.stringify({
      ...dataDocument,
      paths: {
        '/ping': { get: { operationId: 'ping', responses: { '204': { description: 'ok' } } } },
      },
    }))
    const diagnostic = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(validate.run({}, { cwd: root, projectRoot: root })).rejects.toThrow()
      expect(diagnostic.mock.calls.flat().join(' ')).toContain('must not contain HTTP operations')
    } finally {
      diagnostic.mockRestore()
    }
  })

  // Plugin and standalone outputs share validation semantics and type names.

  it('retains plugin guards for TypeScript identifiers containing dollar signs', async () => {
    const document: OasDocument = {
      ...dataDocument,
      components: { schemas: { '$Value': { type: 'string' } } },
    }
    const result = await runTspPluginPipeline({
      purpose: 'data',
      input: 'unused.tsp',
      output: root,
      plugins: [pluginTypescript({ typeGuards: true })],
      dryRun: true,
    }, { document })
    const files = Object.fromEntries(result.files.map(file => [file.path, file.content]))
    expect(files['guards.ts']).toContain('export function is$Value(')
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
  })

  it.each([
    ['$defs', false], ['$defs', true],
    ['definitions', false], ['definitions', true],
    ['components', false], ['components', true],
  ] as const)('escapes schema identities in discovered JSON Pointers (%s, split=%s)', async (container, split) => {
    const schemas = {
      'Path/Value': { type: 'string', minLength: 1 },
      'Tilde~Value': { type: 'integer' },
      'Hash#Value': { type: 'boolean' },
      'Percent%Value': { type: 'number' },
    }
    const schemaDocument = container === 'components'
      ? { components: { schemas } }
      : { [container]: schemas }
    const outDir = join(root, 'escaped')
    const artifacts = await generateStandaloneGuards({ schemaDocument, outDir, split })
    const files = Object.fromEntries(artifacts.map(file => [file.filePath.slice(outDir.length + 1), file.content]))
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
    const guards = await import(pathToFileURL(join(outDir, 'index.js')).href)
    expect(guards.isPath_Value('valid')).toBe(true)
    expect(guards.isPath_Value('')).toBe(false)
    expect(guards.isTilde_Value(1.5)).toBe(false)
    expect(guards.isHash_Value(true)).toBe(true)
    expect(guards.isPercent_Value('wrong')).toBe(false)
  })

  it.each([false, true])('keeps colliding split identities distinct (split=%s)', async split => {
    const schemaDocument = {
      $defs: {
        'Domain.User': { type: 'string' },
        Domain_User: { type: 'integer' },
      },
    }
    const outDir = join(root, 'collision')
    const artifacts = await generateStandaloneGuards({ schemaDocument, outDir, split })
    expect(new Set(artifacts.map(file => file.filePath)).size).toBe(artifacts.length)
    const files = Object.fromEntries(artifacts.map(file => [file.filePath.slice(outDir.length + 1), file.content]))
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
    const guards = await import(pathToFileURL(join(outDir, 'index.js')).href)
    expect(guards.isDomain_User('value')).toBe(true)
    expect(guards.isDomain_User(1)).toBe(false)
    expect(guards.isDomain_User_2(1)).toBe(true)
    expect(guards.isDomain_User_2('value')).toBe(false)
  })

  it('rejects external declaration overrides without their type module before writing', async () => {
    writeFileSync(join(root, 'guards.js'), 'previous')
    await expect(generateStandaloneGuards({
      schemaDocument: { $defs: { User: { type: 'string' } } },
      outDir: root,
      typeNames: { User: 'ExternalUser' },
    })).rejects.toThrow('typeImportSpecifier')
    expect(readFileSync(join(root, 'guards.js'), 'utf8')).toBe('previous')
    expect(existsSync(join(root, 'types.d.ts'))).toBe(false)
  })

  it.each([false, true])('accepts external declaration overrides with a matching type module (split=%s)', async split => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: { $defs: { User: { type: 'string' } } },
      outDir: root,
      typeNames: { User: 'ExternalUser' },
      typeImportSpecifier: split ? '../external.js' : './external.js',
      split,
      dryRun: true,
    })
    const files = Object.fromEntries(artifacts.map(file => [file.filePath.slice(root.length + 1), file.content]))
    files['external.ts'] = 'export type ExternalUser = string'
    expect(files['types.d.ts']).toBeUndefined()
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
  })

  it('uses full standalone validation in plugins and compiles its complete generated interface', async () => {
    const result = await runTspPluginPipeline({
      purpose: 'data',
      input: join(root, 'unused.tsp'),
      output: join(root, 'out'),
      plugins: [pluginTypescript({ typeGuards: true })],
      dryRun: true,
    }, { document: dataDocument })
    const files = Object.fromEntries(result.files.map(file => [file.path, file.content]))
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
    expect(existsSync(join(root, 'out'))).toBe(false)
    const runtime = join(root, 'plugin-runtime.mjs')
    writeFileSync(runtime, files['guards.runtime.js']!)
    const pluginGuards = await import(pathToFileURL(runtime).href)
    const artifacts = await generateStandaloneGuards({
      schemaDocument: dataDocument as unknown as Record<string, unknown>,
      outDir: join(root, 'cli'),
    })
    const cliGuards = await import(pathToFileURL(join(root, 'cli', 'guards.js')).href)
    for (const value of [
      { age: 1.5, address: null },
      { age: 17, address: { city: 'x' } },
      { age: 20, address: {} },
      { age: 20, address: { city: 'x' } },
    ]) {
      expect(pluginGuards.isDomainUser(value)).toBe(cliGuards.isDomain_User(value))
    }
    expect(pluginGuards.isDomainUser({ age: 1.5, address: null })).toBe(false)
    expect(pluginGuards.isDomainUser({ age: 20, address: { city: 'x' } })).toBe(true)
    const emitted = Object.fromEntries(artifacts.map(artifact => [basename(artifact.filePath), artifact.content]))
    expect(typecheckGeneratedFiles({ files: emitted, compilerOptions: { skipLibCheck: false } })).toEqual([])
  })

  it.each([false, true])('keeps generated type names aligned with external type imports (split=%s)', async split => {
    const artifacts = await generateStandaloneGuards({
      schemaDocument: dataDocument as unknown as Record<string, unknown>,
      outDir: root,
      split,
      typeImportSpecifier: split ? '../types.js' : './types.js',
      dryRun: true,
    })
    const files = Object.fromEntries(artifacts.map(artifact => [artifact.filePath.slice(root.length + 1), artifact.content]))
    files['types.ts'] = generateTypesFromSpec(dataDocument)
    expect(typecheckGeneratedFiles({ files, compilerOptions: { skipLibCheck: false } })).toEqual([])
    expect(existsSync(join(root, 'guards.js'))).toBe(false)
  })

  it('rejects conflicting target identities before touching the previous guard output', async () => {
    const target = (id: string, properties: Record<string, unknown>): TargetSpecProjectionResult => ({
      target: { id, schemaEntry: '', outDir: '' },
      openApiDoc: { components: { schemas: { User: { type: 'object', properties } } } },
      jsonSchemaDoc: { $defs: { User: { type: 'object', properties } } },
      versionHash: '',
      openApiPath: '',
      jsonSchemaPath: '',
      operationCount: 0,
      schemaCount: 1,
    })
    writeFileSync(join(root, 'guards.js'), 'previous')
    await expect(projectTargetGuards({ outDir: root }, [
      target('a', { id: { type: 'string' } }),
      target('b', { count: { type: 'integer' } }),
    ], root)).rejects.toThrow('Conflicting guard schema "User"')
    expect(readFileSync(join(root, 'guards.js'), 'utf8')).toBe('previous')
    expect(existsSync(join(root, 'types.d.ts'))).toBe(false)
  })
})
