import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../cli/commands/generate.js'
import { CliExitError } from '../../cli/lib/errors.js'
import { builtAgainstRange } from '../../cli/lib/built-against-versions.js'
import {
  importCompanion,
  companionInstallCommand,
  type CompanionCommandContext,
  type CompanionImporter,
} from '../../cli/lib/companion-packages.js'
import { importerWithout } from '../helpers/companion-packages.js'

/**
 * `oa-gen generate` in a published install, where @oa-sdk/router and
 * @oa-sdk/client are companion packages the consumer may not have installed.
 */
describe('oa-gen generate without companion packages', () => {
  let tmpDir: string
  let errors: string[]
  let warnings: string[]
  let logs: string[]

  let contractPath: string
  let clientPath: string
  let queriesPath: string
  let openApiPath: string
  const out = (file: string) => path.join(tmpDir, 'generated', file)

  const writeSpec = (extraSchemas: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(tmpDir, 'orders.json'), JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders API', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            responses: {
              '200': {
                description: 'Orders',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Order: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
          ...extraSchemas,
        },
      },
    }, null, 2))
  }

  const writeConfig = (core?: Record<string, unknown>) => {
    fs.writeFileSync(path.join(tmpDir, 'oa.config.json'), JSON.stringify({
      rootDir: '.',
      specs: [{ id: 'orders', profile: 'full-api-document', schemaEntry: './orders.json', outDir: './generated' }],
      ...(core ? { core } : {}),
    }, null, 2))
  }

  const runGenerate = (importCompanion: CompanionImporter, args: Record<string, string> = {}) => {
    const context: CompanionCommandContext = { cwd: tmpDir, projectRoot: tmpDir, importCompanion }
    return generate.run(args, context)
  }

  const exitOf = (run: Promise<void>) => run.then(() => undefined, (error: unknown) => error)

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-generate-companions-'))
    contractPath = out('orders.contract.ts')
    clientPath = out('orders.client.ts')
    queriesPath = out('orders.queries.ts')
    openApiPath = out('orders.openapi.json')
    errors = []
    warnings = []
    logs = []
    const capture = (sink: string[]) => (...parts: unknown[]) => { sink.push(parts.map(String).join(' ')) }
    vi.spyOn(console, 'error').mockImplementation(capture(errors))
    vi.spyOn(console, 'warn').mockImplementation(capture(warnings))
    vi.spyOn(console, 'log').mockImplementation(capture(logs))
    writeSpec()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('explicitly requested outputs', () => {
    it('fails before writing anything when core.contracts.pureHandlers: true needs a missing @oa-sdk/router', async () => {
      writeConfig({ contracts: { pureHandlers: true } })

      const failure = await exitOf(runGenerate(importerWithout('@oa-sdk/router')))

      expect(failure).toBeInstanceOf(CliExitError)
      expect((failure as CliExitError).exitCode).toBe(1)
      const message = errors.join('\n')
      expect(message).toContain('handler contracts (requested by core.contracts.pureHandlers: true) requires @oa-sdk/router')
      expect(message).toContain(companionInstallCommand(['@oa-sdk/router']))
      expect(message).toContain(`"@oa-sdk/router@${builtAgainstRange('@oa-sdk/router')}"`)
      expect(message).toContain('set core.contracts.pureHandlers to false')
      expect(fs.existsSync(path.join(tmpDir, 'generated'))).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, '.oa-manifest.json'))).toBe(false)
    })

    it('fails when core.client.enabled: true needs a missing @oa-sdk/client', async () => {
      writeConfig({ client: { enabled: true } })

      const failure = await exitOf(runGenerate(importerWithout('@oa-sdk/client')))

      expect(failure).toBeInstanceOf(CliExitError)
      const message = errors.join('\n')
      expect(message).toContain('client SDK (requested by core.client.enabled: true) requires @oa-sdk/client')
      expect(message).toContain(companionInstallCommand(['@oa-sdk/client']))
      expect(fs.existsSync(openApiPath)).toBe(false)
    })

    it('names every missing package in one install command', async () => {
      writeConfig({ contracts: { pureHandlers: true }, client: { enabled: true } })

      const failure = await exitOf(runGenerate(importerWithout('@oa-sdk/router', '@oa-sdk/client')))

      expect(failure).toBeInstanceOf(CliExitError)
      const message = errors.join('\n')
      expect(message).toContain('requires @oa-sdk/router')
      expect(message).toContain('requires @oa-sdk/client')
      expect(message).toContain(companionInstallCommand(['@oa-sdk/router', '@oa-sdk/client']))
      expect(message).toContain('set core.contracts.pureHandlers and core.client.enabled to false')
    })

    it('surfaces a broken install of an explicitly requested companion instead of skipping it', async () => {
      writeConfig({ contracts: { pureHandlers: true } })
      const broken = new Error('router entry failed to evaluate')
      const importer: CompanionImporter = (name) => name === '@oa-sdk/router'
        ? Promise.reject(broken)
        : importCompanion(name)

      await expect(runGenerate(importer)).rejects.toBe(broken)
      expect(fs.existsSync(openApiPath)).toBe(false)
    })

    it('generates normally when the requested companions are installed and only an implied one is missing', async () => {
      writeConfig({ contracts: { pureHandlers: true } })

      await runGenerate(importerWithout('@oa-sdk/client'))

      expect(fs.existsSync(contractPath)).toBe(true)
      expect(fs.existsSync(clientPath)).toBe(false)
      expect(fs.existsSync(queriesPath)).toBe(false)
      expect(errors).toEqual([])
      expect(warnings.join('\n')).toContain('client SDK: @oa-sdk/client')
    })
  })

  describe('outputs implied by defaults', () => {
    it('skips handler contracts with a warning when @oa-sdk/router is missing', async () => {
      writeConfig()

      await runGenerate(importerWithout('@oa-sdk/router'))

      expect(fs.existsSync(openApiPath)).toBe(true)
      expect(fs.existsSync(clientPath)).toBe(true)
      expect(fs.existsSync(queriesPath)).toBe(true)
      expect(fs.existsSync(contractPath)).toBe(false)
      expect(errors).toEqual([])
      const warning = warnings.join('\n')
      expect(warning).toContain('Skipped outputs whose companion package is not installed')
      expect(warning).toContain('handler contracts: @oa-sdk/router')
      expect(warning).toContain(companionInstallCommand(['@oa-sdk/router']))
      expect(warning).toContain(`"@oa-sdk/router@${builtAgainstRange('@oa-sdk/router')}"`)
      expect(warning).not.toContain('@oa-sdk/client')
      expect(logs.join('\n')).toContain('Contracts Generated: 0')
    })

    it('skips the client SDK and TanStack Query options when @oa-sdk/client is missing', async () => {
      writeConfig()

      await runGenerate(importerWithout('@oa-sdk/client'))

      expect(fs.existsSync(contractPath)).toBe(true)
      expect(fs.existsSync(clientPath)).toBe(false)
      expect(fs.existsSync(queriesPath)).toBe(false)
      const warning = warnings.join('\n')
      expect(warning).toContain('client SDK: @oa-sdk/client')
      expect(warning).toContain('TanStack Query options: @oa-sdk/client')
      expect(warning).toContain(companionInstallCommand(['@oa-sdk/client']))
    })

    it('treats archetype defaults as implied, not as a request', async () => {
      fs.writeFileSync(path.join(tmpDir, 'oa.config.json'), JSON.stringify({
        rootDir: '.',
        archetype: 'enterprise',
        specs: [{ id: 'orders', profile: 'full-api-document', schemaEntry: './orders.json', outDir: './generated' }],
      }))

      await runGenerate(importerWithout('@oa-sdk/router', '@oa-sdk/client'))

      expect(fs.existsSync(openApiPath)).toBe(true)
      expect(errors).toEqual([])
      expect(warnings.join('\n')).toContain(companionInstallCommand(['@oa-sdk/router', '@oa-sdk/client']))
    })

    it('skips with a warning for a direct --spec run, which has no config switches', async () => {
      await runGenerate(importerWithout('@oa-sdk/router', '@oa-sdk/client'), {
        spec: path.join(tmpDir, 'orders.json'),
        'out-dir': path.join(tmpDir, 'generated'),
      })

      expect(fs.existsSync(openApiPath)).toBe(true)
      expect(fs.existsSync(contractPath)).toBe(false)
      expect(fs.existsSync(clientPath)).toBe(false)
      const warning = warnings.join('\n')
      expect(warning).toContain('handler contracts: @oa-sdk/router')
      expect(warning).toContain('client SDK: @oa-sdk/client')
    })

    it('skips CRDT modules driven by spec extensions with a warning', async () => {
      writeSpec({
        Board: {
          type: 'object',
          'x-oa-sdk-crdt-entity': { partitionKey: 'boardId', strategy: 'delta-sharded' },
          properties: {
            boardId: { type: 'string' },
            title: { type: 'string', 'x-oa-sdk-crdt': { type: 'lww-register', role: 'value' } },
          },
        },
      })
      writeConfig({ contracts: { pureHandlers: false }, client: { enabled: false } })

      await runGenerate(importerWithout('@oa-sdk/router'))

      expect(fs.existsSync(out('orders.crdt.contract.ts'))).toBe(false)
      expect(fs.existsSync(out('orders.crdt.client.ts'))).toBe(false)
      expect(errors).toEqual([])
      const warning = warnings.join('\n')
      expect(warning).toContain('CRDT modules: @oa-sdk/router')
      expect(warning).not.toContain('handler contracts')
    })

    it('keeps the warning for a broken install of an implied companion', async () => {
      writeConfig()
      const importer: CompanionImporter = (name) => name === '@oa-sdk/router'
        ? Promise.reject(new Error('router entry failed to evaluate'))
        : importCompanion(name)

      await runGenerate(importer)

      expect(fs.existsSync(contractPath)).toBe(false)
      expect(warnings.join('\n')).toContain('Failed to generate handler contracts via @oa-sdk/router: router entry failed to evaluate')
    })

    it('keeps outputs generated by an earlier run instead of pruning them as orphans', async () => {
      writeConfig()
      await runGenerate(importCompanion)
      const contract = fs.readFileSync(contractPath, 'utf8')
      expect(fs.existsSync(queriesPath)).toBe(true)

      await runGenerate(importerWithout('@oa-sdk/router', '@oa-sdk/client'))

      expect(fs.readFileSync(contractPath, 'utf8')).toBe(contract)
      expect(fs.existsSync(clientPath)).toBe(true)
      expect(fs.existsSync(queriesPath)).toBe(true)
      const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, '.oa-manifest.json'), 'utf8')) as {
        artifacts: Array<{ path: string; kind: string }>
      }
      expect(manifest.artifacts.map(artifact => artifact.kind)).toEqual(
        expect.arrayContaining(['contract', 'client', 'queries']),
      )
    })
  })

  it('does not need a companion whose output is switched off', async () => {
    writeConfig({ contracts: { pureHandlers: false } })

    await runGenerate(importerWithout('@oa-sdk/router'))

    expect(fs.existsSync(contractPath)).toBe(false)
    expect(errors).toEqual([])
    expect(warnings.join('\n')).not.toContain('@oa-sdk/router')
  })
})
