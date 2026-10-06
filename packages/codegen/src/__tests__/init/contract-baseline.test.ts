import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  CONTRACT_BASELINE_PATH,
  detectSchemas,
  isSpecDocumentPath,
  runInit,
  writeContractBaseline,
} from '../../cli/lib/init/index.js'
import { diff } from '../../cli/commands/diff.js'
import { init } from '../../cli/commands/init.js'
import { normalize } from '../../cli/commands/normalize.js'
import { CliExitError } from '../../cli/lib/errors.js'
import { installCodegenStandIn } from '../helpers/codegen-stand-in.js'

/** codegen's node_modules, which has the TypeSpec libraries a `.tsp` spec imports. */
const CODEGEN_NODE_MODULES = fileURLToPath(new URL('../../../node_modules', import.meta.url))

const SPEC = [
  'openapi: 3.2.0',
  'info: { version: 1.0.0, title: Users }',
  'paths:',
  '  /users/{id}:',
  '    get:',
  '      operationId: getUser',
  '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
  "      responses: { '200': { description: OK } }",
  '',
].join('\n')

describe('contract baseline of the enterprise archetype', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-contract-baseline-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(projectDir, { recursive: true, force: true })
  })

  const plan = { path: CONTRACT_BASELINE_PATH, specPath: 'openapi.yaml' }
  const read = (file: string) => fs.readFile(path.join(projectDir, file), 'utf8')

  it('is created from the spec as oa-gen normalize writes it, so the baseline:update script rewrites it unchanged', async () => {
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)

    expect(await writeContractBaseline(projectDir, plan)).toEqual({ ...plan, status: 'created' })

    const baseline = await read(CONTRACT_BASELINE_PATH)
    expect(parseYaml(baseline)).toEqual(parseYaml(SPEC))
    await normalize.run({ spec: path.join(projectDir, 'openapi.yaml'), output: path.join(projectDir, 'normalized.yaml') })
    expect(await read('normalized.yaml')).toBe(baseline)
  })

  it('compiles a TypeSpec spec to the OpenAPI document the gate compares with', async () => {
    await fs.symlink(CODEGEN_NODE_MODULES, path.join(projectDir, 'node_modules'), 'dir')
    await fs.writeFile(path.join(projectDir, 'main.tsp'), [
      'import "@typespec/http";',
      'using Http;',
      '@service(#{ title: "Users" }) namespace Users;',
      'model User { id: string; }',
      '@route("/users/{id}") @get op getUser(@path id: string): User;',
      '',
    ].join('\n'))

    const typespecPlan = { path: CONTRACT_BASELINE_PATH, specPath: 'main.tsp' }
    expect(await writeContractBaseline(projectDir, typespecPlan)).toEqual({ ...typespecPlan, status: 'created' })

    const baseline = await read(CONTRACT_BASELINE_PATH)
    expect(parseYaml(baseline).openapi).toBe('3.2.0')
    expect(parseYaml(baseline).paths['/users/{id}'].get.operationId).toBe('getUser')
    // oa-gen normalize, which the baseline:update script runs, reads the TypeSpec spec as well.
    await normalize.run({ spec: path.join(projectDir, 'main.tsp'), output: path.join(projectDir, 'normalized.yaml') })
    expect(await read('normalized.yaml')).toBe(baseline)
  })

  it('keeps a baseline the project has, which records a release', async () => {
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)
    await fs.writeFile(path.join(projectDir, CONTRACT_BASELINE_PATH), 'released: true\n')

    expect(await writeContractBaseline(projectDir, plan)).toEqual({ ...plan, status: 'exists' })
    expect(await read(CONTRACT_BASELINE_PATH)).toBe('released: true\n')
  })

  it('is only planned in a dry run', async () => {
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)

    expect(await writeContractBaseline(projectDir, plan, { dryRun: true })).toEqual({ ...plan, status: 'planned' })
    await expect(fs.access(path.join(projectDir, CONTRACT_BASELINE_PATH))).rejects.toThrow()
  })

  it('is not created, with the reason, when the spec does not exist or does not load', async () => {
    expect(await writeContractBaseline(projectDir, plan)).toEqual({
      ...plan,
      status: 'not-created',
      reason: 'the spec openapi.yaml does not exist yet',
    })

    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), 'openapi: [unclosed\n')
    const result = await writeContractBaseline(projectDir, plan)
    expect(result.status).toBe('not-created')
    expect(result.status === 'not-created' && result.reason).toMatch(/^the spec openapi\.yaml did not load: /)
    await expect(fs.access(path.join(projectDir, CONTRACT_BASELINE_PATH))).rejects.toThrow()
  })

  it('copies in the files the spec refers to, so a change made in them breaks the gate', async () => {
    // A spec in a subdirectory whose response schema lives in another file: the baseline, written
    // at the project root, must hold that schema rather than a ref that now points elsewhere.
    await fs.mkdir(path.join(projectDir, 'api'))
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'gated' }))
    await fs.writeFile(path.join(projectDir, 'api', 'openapi.yaml'), [
      'openapi: 3.2.0',
      'info: { version: 1.0.0, title: Users }',
      'paths:',
      '  /users/{id}:',
      '    get:',
      '      operationId: getUser',
      '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
      "      responses: { '200': { description: OK, content: { application/json: { schema: { $ref: './schemas.yaml#/User' } } } } }",
      '',
    ].join('\n'))
    const schemas = [
      'User:',
      '  type: object',
      '  required: [id, name]',
      '  properties: { id: { type: string }, name: { type: string } }',
      '',
    ].join('\n')
    await fs.writeFile(path.join(projectDir, 'api', 'schemas.yaml'), schemas)

    const result = await runInit({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(result.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: path.join('api', 'openapi.yaml'), status: 'created' })
    const baseline = parseYaml(await read(CONTRACT_BASELINE_PATH))
    expect(baseline.paths['/users/{id}'].get.responses['200'].content['application/json'].schema).toEqual(parseYaml(schemas).User)
    expect(JSON.stringify(baseline)).not.toContain('schemas.yaml')

    // The scripts as init wrote them: diff passes on the unchanged spec ...
    const gate = {
      base: path.join(projectDir, CONTRACT_BASELINE_PATH),
      head: path.join(projectDir, 'api', 'openapi.yaml'),
      'fail-on-breaking': true,
    }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await diff.run(gate)

    // ... fails once the referenced file drops a required response field and retypes it ...
    await fs.writeFile(
      path.join(projectDir, 'api', 'schemas.yaml'),
      schemas.replace('required: [id, name]', 'required: [id]').replace('name: { type: string }', 'name: { type: integer }'),
    )
    await expect(diff.run(gate)).rejects.toBeInstanceOf(CliExitError)

    // ... and passes again once baseline:update accepts the change.
    await normalize.run({ spec: gate.head, output: gate.base })
    await diff.run(gate)
  })

  it('is never detected as the spec of the project', async () => {
    await fs.mkdir(path.join(projectDir, 'api'))
    await fs.writeFile(path.join(projectDir, 'api', 'spec.yaml'), SPEC)
    await fs.writeFile(path.join(projectDir, CONTRACT_BASELINE_PATH), SPEC)

    expect((await detectSchemas(projectDir)).map(item => item.filePath)).toEqual([path.join('api', 'spec.yaml')])
  })

  it('applies to the spec documents oa-gen lint, diff and normalize load', () => {
    for (const specPath of ['openapi.yaml', 'api/spec.yml', 'openapi.json', 'typespec/main.tsp']) {
      expect(isSpecDocumentPath(specPath), specPath).toBe(true)
    }
    // They read an OpenAPI document whatever the case of its extension ...
    for (const specPath of ['OPENAPI.YAML', 'api/Spec.Yml', 'api/OPENAPI.JSON']) {
      expect(isSpecDocumentPath(specPath), specPath).toBe(true)
    }
    // ... but compile only a `.tsp` file as TypeSpec, and would parse `main.TSP` as YAML.
    for (const specPath of ['src/schema.ts', 'src/routes.tsx', 'spec', 'typespec/main.TSP']) {
      expect(isSpecDocumentPath(specPath), specPath).toBe(false)
    }
  })

  it('gates a spec whose extension is upper case, which oa-gen lint, diff and normalize load', async () => {
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'gated' }))
    await fs.writeFile(path.join(projectDir, 'OPENAPI.YAML'), SPEC)

    const result = await runInit({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(result.detectedSchema?.filePath).toBe('OPENAPI.YAML')
    expect(result.contractBaseline).toEqual({ path: CONTRACT_BASELINE_PATH, specPath: 'OPENAPI.YAML', status: 'created' })
    const pkg = JSON.parse(await read('package.json'))
    expect(pkg.scripts.diff).toBe(`oa-gen diff --base ${CONTRACT_BASELINE_PATH} --head OPENAPI.YAML --fail-on-breaking`)
    expect(pkg.scripts['lint:spec']).toBe('oa-gen lint --spec OPENAPI.YAML')

    // The diff script passes on the spec it was created from.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await diff.run({
      base: path.join(projectDir, CONTRACT_BASELINE_PATH),
      head: path.join(projectDir, 'OPENAPI.YAML'),
      'fail-on-breaking': true,
    })
  })

  it('is created by oa-gen init --archetype enterprise, and kept by the next run', async () => {
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'gated' }))
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)

    const first = await runInit({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(first.contractBaseline).toEqual({ ...plan, status: 'created' })
    const baseline = await read(CONTRACT_BASELINE_PATH)

    // A later change to the spec does not move the baseline: only the baseline:update script does.
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC.replace('/users/{id}', '/people/{id}'))
    const second = await runInit({ cwd: projectDir, archetype: 'enterprise', yes: true, force: true })
    expect(second.contractBaseline).toEqual({ ...plan, status: 'exists' })
    expect(await read(CONTRACT_BASELINE_PATH)).toBe(baseline)

    const mvp = await runInit({ cwd: projectDir, archetype: 'mvp', yes: true })
    expect(mvp.contractBaseline).toBeUndefined()
  })

  it('is reported by the init command, with what to do when it could not be created', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'gated' }))
    // The second run keeps the oa.config.ts the first wrote, and reads its spec from it.
    installCodegenStandIn(projectDir)

    await init.run({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(log.mock.calls.map(([line]) => String(line))).toContain(
      `⚠️ Contract baseline ${CONTRACT_BASELINE_PATH} not created: the spec openapi.yaml does not exist yet. ` +
        'Run the "baseline:update" script once the spec loads; "diff" and "ci:gate" need it.',
    )

    log.mockClear()
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)
    await init.run({ cwd: projectDir, archetype: 'enterprise', yes: true })
    expect(log.mock.calls.map(([line]) => String(line))).toContain(
      `📌 Contract baseline: created ${CONTRACT_BASELINE_PATH} from openapi.yaml; commit it. ` +
        'The "diff" script fails on changes that break it, and "baseline:update" moves it to the spec when you release.',
    )
  })
})
