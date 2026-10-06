import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CONTRACT_BASELINE_PATH, detectSchemas, runInit } from '../../cli/lib/init/index.js'
import { init } from '../../cli/commands/init.js'
import { installCodegenStandIn } from '../helpers/codegen-stand-in.js'

const SPEC = [
  'openapi: 3.2.0',
  'info: { version: 1.0.0, title: Orders }',
  'paths:',
  '  /orders:',
  '    get:',
  '      operationId: listOrders',
  "      responses: { '200': { description: OK } }",
  '',
].join('\n')

/** What `oa-gen generate` writes for a spec target: the spec, with its projection extensions. */
const GENERATED_OPENAPI = JSON.stringify({ ...parseYaml(SPEC), 'x-schema-engine-profile': 'full-api-document' })

const GATE_SCRIPTS = ['lint:spec', 'diff', 'baseline:update', 'ci:gate']

/** An oa.config.ts with these spec targets, written as a project would. */
function configWithSpecs(specs: Array<{ id: string; schemaEntry: string; outDir?: string }>, rootDir = '.'): string {
  return [
    "import { defineConfig } from '@oa-sdk/codegen'",
    '',
    'export default defineConfig({',
    `  rootDir: '${rootDir}',`,
    `  specs: ${JSON.stringify(specs.map(spec => ({ outDir: './src/generated', profile: 'full-api-document', ...spec })))},`,
    '})',
    '',
  ].join('\n')
}

/**
 * `oa-gen init` keeps an existing oa.config.ts unless --force. The scripts it writes run beside that
 * file, so the gate of the enterprise archetype must check the spec it records, the one
 * `oa-gen generate` builds from, and never a file init detects elsewhere in the project: this is
 * the documented way to move a project to the enterprise archetype.
 */
describe('oa-gen init keeping the oa.config.ts of the project', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-init-retained-config-'))
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'orders', private: true }))
    installCodegenStandIn(projectDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(projectDir, { recursive: true, force: true })
  })

  const write = async (file: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(projectDir, file)), { recursive: true })
    await fs.writeFile(path.join(projectDir, file), content)
  }
  const read = (file: string) => fs.readFile(path.join(projectDir, file), 'utf8')
  const scripts = async () => (JSON.parse(await read('package.json')) as { scripts?: Record<string, string> }).scripts ?? {}

  it('gates the schemaEntry of the kept oa.config.ts, not the document generate wrote from it', async () => {
    // The detector does not find api/contract.yaml by name, but finds the generated document.
    await write('api/contract.yaml', SPEC)
    await runInit({ cwd: projectDir, yes: true, spec: 'api/contract.yaml' })
    await write('src/generated/generic-api.openapi.json', GENERATED_OPENAPI)

    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise' })

    expect(result.configFileCreated).toBe(false)
    expect(result.detectedSchema?.filePath).toBe('api/contract.yaml')
    expect(result.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'api/contract.yaml', status: 'created' })
    expect(await scripts()).toMatchObject({
      'lint:spec': 'oa-gen lint --spec api/contract.yaml',
      diff: 'oa-gen diff --base openapi.baseline.yaml --head api/contract.yaml --fail-on-breaking',
      'baseline:update': 'oa-gen normalize --spec api/contract.yaml --output openapi.baseline.yaml',
      'ci:gate': 'oa-gen validate --spec api/contract.yaml --require-32 && oa-gen lint --spec api/contract.yaml' +
        ' && oa-gen diff --base openapi.baseline.yaml --head api/contract.yaml --fail-on-breaking',
    })
    expect(parseYaml(await read(CONTRACT_BASELINE_PATH))).toEqual(parseYaml(SPEC))
  })

  it('gates the kept schemaEntry over a spec it would detect, and never falls back to openapi.yaml', async () => {
    await write('api/contract.yaml', SPEC)
    await write('oa.config.ts', configWithSpecs([{ id: 'orders', schemaEntry: 'api/contract.yaml' }]))
    expect((await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise', dryRun: true })).contractBaseline)
      .toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'api/contract.yaml', status: 'planned' })

    await write('docs/openapi.yaml', SPEC)
    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise' })
    expect(result.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'api/contract.yaml', status: 'created' })
    expect((await scripts()).diff).toBe('oa-gen diff --base openapi.baseline.yaml --head api/contract.yaml --fail-on-breaking')
  })

  it('reads the schemaEntry relative to the rootDir of the kept oa.config.ts', async () => {
    await write('api/contract.yaml', SPEC)
    await write('oa.config.ts', configWithSpecs([{ id: 'orders', schemaEntry: 'contract.yaml', outDir: '../src/generated' }], './api'))

    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise' })
    expect(result.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'api/contract.yaml', status: 'created' })
    expect((await scripts())['lint:spec']).toBe('oa-gen lint --spec api/contract.yaml')
  })

  it('takes --spec to pick among spec targets with different schemaEntry values, and adds no gate without it', async () => {
    await write('api/public.yaml', SPEC)
    await write('api/admin.yaml', SPEC.replace('/orders', '/admin/orders'))
    await write('oa.config.ts', configWithSpecs([
      { id: 'public', schemaEntry: 'api/public.yaml' },
      { id: 'admin', schemaEntry: './api/admin.yaml' },
    ]))

    const unpicked = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise' })
    expect(unpicked.detectedSchema).toBeUndefined()
    expect(unpicked.contractBaseline).toEqual({
      path: CONTRACT_BASELINE_PATH,
      status: 'no-gate',
      reason: 'the spec targets of the existing oa.config.ts have different schemaEntry values ' +
        '(api/public.yaml, api/admin.yaml); pass the one to use with --spec',
    })
    for (const script of GATE_SCRIPTS) expect(await scripts(), script).not.toHaveProperty(script)
    await expect(fs.access(path.join(projectDir, CONTRACT_BASELINE_PATH))).rejects.toThrow()

    const picked = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise', spec: path.join('api', 'admin.yaml') })
    expect(picked.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'api/admin.yaml', status: 'created' })
    expect((await scripts()).diff).toBe('oa-gen diff --base openapi.baseline.yaml --head api/admin.yaml --fail-on-breaking')
    expect(parseYaml(await read(CONTRACT_BASELINE_PATH)).paths).toHaveProperty(['/admin/orders'])
  })

  it('adds no gate for a --spec that no spec target of the kept oa.config.ts reads', async () => {
    await write('api/contract.yaml', SPEC)
    await write('other.yaml', SPEC)
    await write('oa.config.ts', configWithSpecs([{ id: 'orders', schemaEntry: 'api/contract.yaml' }]))

    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise', spec: 'other.yaml' })
    expect(result.contractBaseline).toEqual({
      path: CONTRACT_BASELINE_PATH,
      status: 'no-gate',
      reason: '--spec other.yaml is not the schemaEntry of a spec target in the existing oa.config.ts (api/contract.yaml); ' +
        'pass one of those, or rewrite oa.config.ts for other.yaml with --force',
    })
    for (const script of GATE_SCRIPTS) expect(await scripts(), script).not.toHaveProperty(script)

    // --force writes a new oa.config.ts for the given spec, and gates it.
    const forced = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise', spec: 'other.yaml', force: true })
    expect(forced.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'other.yaml', status: 'created' })
    expect(await read('oa.config.ts')).toContain("schemaEntry: 'other.yaml'")
  })

  it('adds no gate when the kept oa.config.ts does not load', async () => {
    await write('openapi.yaml', SPEC)
    await write('oa.config.ts', "throw new Error('the configuration is broken')\nexport default {}\n")

    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise' })
    expect(result.contractBaseline).toMatchObject({ path: CONTRACT_BASELINE_PATH, status: 'no-gate' })
    expect(result.contractBaseline?.status === 'no-gate' && result.contractBaseline.reason).toMatch(
      /^the existing oa\.config\.ts did not load \(.*the configuration is broken.*\); make it load, or rewrite it with --force$/s,
    )
    for (const script of GATE_SCRIPTS) expect(await scripts(), script).not.toHaveProperty(script)
    await expect(fs.access(path.join(projectDir, CONTRACT_BASELINE_PATH))).rejects.toThrow()
  })

  it('adds no gate when the kept oa.config.ts has no spec target, and the init command says why', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await write('openapi.yaml', SPEC)
    await write('oa.config.ts', configWithSpecs([]))

    await init.run({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(log.mock.calls.map(([line]) => String(line))).toContain(
      `⚠️ Contract baseline ${CONTRACT_BASELINE_PATH} and the "lint:spec", "diff", "baseline:update" and "ci:gate" scripts not added: ` +
        'the existing oa.config.ts has no spec target (specs); add one, or rewrite it with --force.',
    )
    for (const script of GATE_SCRIPTS) expect(await scripts(), script).not.toHaveProperty(script)
    await expect(fs.access(path.join(projectDir, CONTRACT_BASELINE_PATH))).rejects.toThrow()
  })

  it('never detects a document oa-gen generate wrote as the spec of the oa.config.ts it writes', async () => {
    // The kept configuration writes its documents to artifacts/; a new one would write them to src/generated.
    await write('oa.config.ts', configWithSpecs([{ id: 'orders-api', schemaEntry: 'api/contract.yaml', outDir: './artifacts' }]))
    await write('artifacts/orders-api.openapi.json', GENERATED_OPENAPI)
    await write('src/generated/generic-api.openapi.json', GENERATED_OPENAPI)

    const result = await runInit({ cwd: projectDir, yes: true, archetype: 'enterprise', force: true })
    expect(result.detectedSchema?.filePath).toBe('openapi.yaml')
    expect(await read('oa.config.ts')).toContain("schemaEntry: 'openapi.yaml'")

    // A spec next to them is detected.
    await write('artifacts/openapi.yaml', SPEC)
    expect((await detectSchemas(projectDir, { generatedPaths: ['artifacts/orders-api.openapi.json'] })).map(item => item.filePath))
      .toEqual([path.join('artifacts', 'openapi.yaml')])
  })
})
