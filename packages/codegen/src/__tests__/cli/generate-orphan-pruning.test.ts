import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../cli/commands/generate.js'
import { generateTanstackCommand } from '../../cli/commands/generate-tanstack.js'
import { importCompanion, type CompanionCommandContext } from '../../cli/lib/companion-packages.js'
import type { ManifestArtifact, OaManifest } from '../../routing/manifest-manager.js'

/**
 * Which `.oa-manifest.json` records `oa-gen generate` prunes: only those its
 * run owns, and none when `outputRouting.pruneOrphans` is false.
 */
describe('oa-gen generate orphan pruning', () => {
  let tmpDir: string
  let logs: string[]

  const file = (relativePath: string) => path.join(tmpDir, relativePath)
  const exists = (relativePath: string) => fs.existsSync(file(relativePath))
  const context = (): CompanionCommandContext => ({ cwd: tmpDir, projectRoot: tmpDir, importCompanion })
  const runGenerate = (args: Record<string, string> = {}) => generate.run(args, context())
  const readManifest = () => JSON.parse(fs.readFileSync(file('.oa-manifest.json'), 'utf8')) as OaManifest
  const recordOf = (relativePath: string) => readManifest().artifacts.find(artifact => artifact.path === relativePath)

  const writeSpec = (name: string) => {
    fs.writeFileSync(file(`${name}.json`), JSON.stringify({
      openapi: '3.1.0',
      info: { title: `${name} API`, version: '1.0.0' },
      paths: {
        [`/${name}`]: {
          get: {
            operationId: `list_${name}`,
            responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } },
          },
        },
      },
    }, null, 2))
  }

  const writeConfig = (configFile: string, specs: Array<{ id: string; spec: string }>, outputRouting?: Record<string, unknown>) => {
    fs.writeFileSync(file(configFile), JSON.stringify({
      rootDir: '.',
      specs: specs.map(({ id, spec }) => ({ id, profile: 'full-api-document', schemaEntry: `./${spec}.json`, outDir: './generated' })),
      ...(outputRouting ? { product: { outputRouting } } : {}),
    }, null, 2))
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-generate-pruning-'))
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => { logs.push(parts.map(String).join(' ')) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeSpec('orders')
    writeSpec('billing')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('outputRouting.pruneOrphans', () => {
    const routing = (contractDir: string, pruneOrphans?: boolean) => ({
      byKind: { contract: `src/${contractDir}/{tag}.contract.ts` },
      ...(pruneOrphans === undefined ? {} : { pruneOrphans }),
    })

    it('keeps orphaned artifacts when it is false, and prunes them once it is turned back on', async () => {
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }], routing('v1', false))
      await runGenerate()
      expect(exists('src/v1/orders.contract.ts')).toBe(true)

      // The contract moves; with pruning off the old file stays and stays recorded.
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }], routing('v2', false))
      logs.length = 0
      await runGenerate()
      expect(exists('src/v2/orders.contract.ts')).toBe(true)
      expect(exists('src/v1/orders.contract.ts')).toBe(true)
      expect(recordOf('src/v1/orders.contract.ts')).toBeDefined()
      expect(logs.join('\n')).toContain('Artifacts Pruned:    0 (outputRouting.pruneOrphans: false)')

      // Pruning on (the default): the orphan recorded earlier is removed.
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }], routing('v2'))
      logs.length = 0
      await runGenerate()
      expect(exists('src/v1/orders.contract.ts')).toBe(false)
      expect(recordOf('src/v1/orders.contract.ts')).toBeUndefined()
      expect(logs.join('\n')).toContain('Artifacts Pruned:    1')
      expect(logs.join('\n')).toContain('    - src/v1/orders.contract.ts')
    })
  })

  describe('ownership', () => {
    it('never prunes what oa-gen generate:tanstack wrote', async () => {
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }])
      await runGenerate()
      await generateTanstackCommand.run({ spec: file('orders.json'), output: 'src/api' }, context())
      expect(recordOf('src/api/tanstack-query.ts')).toMatchObject({ producer: 'generate:tanstack' })

      await runGenerate()

      expect(exists('src/api/tanstack-query.ts')).toBe(true)
      expect(recordOf('src/api/tanstack-query.ts')).toMatchObject({ producer: 'generate:tanstack' })
    })

    it('records each artifact as written by oa-gen generate from its configuration file for its spec target', async () => {
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }])
      await runGenerate()

      expect(recordOf('generated/orders.contract.ts')).toMatchObject({
        producer: 'generate',
        configFile: 'oa.config.json',
        target: 'orders',
      })
    })

    it('does not let a --spec run and a configuration run prune each other', async () => {
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }])
      await runGenerate()
      await generateTanstackCommand.run({ spec: file('orders.json'), output: 'src/api' }, context())

      await runGenerate({ spec: file('billing.json'), 'out-dir': file('adhoc') })

      expect(exists('adhoc/billing.contract.ts')).toBe(true)
      expect(recordOf('adhoc/billing.contract.ts')).toMatchObject({ producer: 'generate', target: 'billing' })
      expect(recordOf('adhoc/billing.contract.ts')).not.toHaveProperty('configFile')
      expect(exists('generated/orders.contract.ts')).toBe(true)
      expect(exists('generated/orders.openapi.json')).toBe(true)
      expect(exists('src/api/tanstack-query.ts')).toBe(true)

      await runGenerate()

      expect(exists('adhoc/billing.contract.ts')).toBe(true)
      expect(exists('generated/orders.contract.ts')).toBe(true)
    })

    it('lets a --spec run prune what an earlier --spec run generated for the same spec target', async () => {
      await runGenerate({ spec: file('billing.json'), 'out-dir': file('out-a') })
      await runGenerate({ spec: file('orders.json'), 'out-dir': file('out-a') })
      expect(exists('out-a/billing.contract.ts')).toBe(true)

      await runGenerate({ spec: file('billing.json'), 'out-dir': file('out-b') })

      expect(exists('out-b/billing.contract.ts')).toBe(true)
      expect(exists('out-a/billing.contract.ts')).toBe(false)
      // Another spec target's outputs are not this run's
      expect(exists('out-a/orders.contract.ts')).toBe(true)
    })

    it('does not let runs of different configuration files prune each other', async () => {
      writeConfig('orders.config.json', [{ id: 'orders', spec: 'orders' }])
      writeConfig('billing.config.json', [{ id: 'billing', spec: 'billing' }])

      await runGenerate({ config: file('orders.config.json') })
      await runGenerate({ config: file('billing.config.json') })
      expect(exists('generated/orders.contract.ts')).toBe(true)

      await runGenerate({ config: file('orders.config.json') })
      expect(exists('generated/billing.contract.ts')).toBe(true)
    })

    it('prunes the outputs of a spec target removed from its own configuration file', async () => {
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }, { id: 'billing', spec: 'billing' }])
      await runGenerate()
      expect(exists('generated/billing.contract.ts')).toBe(true)

      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }])
      await runGenerate()

      expect(exists('generated/billing.contract.ts')).toBe(false)
      expect(exists('generated/billing.openapi.json')).toBe(false)
      expect(exists('generated/orders.contract.ts')).toBe(true)
    })
  })

  describe('manifests written before codegen 0.9.0', () => {
    const legacyRecord = (relativePath: string, kind: ManifestArtifact['kind'], tag?: string): ManifestArtifact => {
      const content = `/** @generated by @oa-sdk/codegen */\nexport const legacy = ${JSON.stringify(relativePath)}\n`
      fs.mkdirSync(path.dirname(file(relativePath)), { recursive: true })
      fs.writeFileSync(file(relativePath), content)
      return {
        path: relativePath,
        kind,
        ...(tag ? { tag } : {}),
        contentHash: `sha256:${crypto.createHash('sha256').update(content, 'utf8').digest('hex')}`,
        generatedAt: '2026-09-20T00:00:00.000Z',
      }
    }

    it('prunes legacy records of oa-gen generate for its spec targets and keeps every other legacy record', async () => {
      fs.writeFileSync(file('.oa-manifest.json'), JSON.stringify({
        version: 1,
        generator: '@oa-sdk/codegen',
        lastRun: '2026-09-20T00:00:00.000Z',
        artifacts: [
          // oa-gen generate 0.8.x: tag = spec target id
          legacyRecord('src/old/orders.contract.ts', 'contract', 'orders'),
          legacyRecord('src/old/billing.contract.ts', 'contract', 'billing'),
          // oa-gen generate:tanstack 0.8.x: no tag
          legacyRecord('src/api/tanstack-query.ts', 'queries'),
        ],
      }, null, 2))
      writeConfig('oa.config.json', [{ id: 'orders', spec: 'orders' }])

      await runGenerate()

      expect(exists('src/old/orders.contract.ts')).toBe(false)
      expect(exists('src/old/billing.contract.ts')).toBe(true)
      expect(exists('src/api/tanstack-query.ts')).toBe(true)
      expect(recordOf('src/old/billing.contract.ts')).toEqual(expect.not.objectContaining({ producer: expect.anything() }))
      expect(recordOf('generated/orders.contract.ts')).toMatchObject({ producer: 'generate', configFile: 'oa.config.json' })
    })
  })
})
