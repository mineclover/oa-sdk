import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ARCHETYPE_PROFILES,
  CONTRACT_BASELINE_PATH,
  TARGET_PROFILES,
  composeInitScripts,
  findRetiredInitScripts,
  runInit,
} from '../../cli/lib/init/index.js'
import type { TargetGenerateOptions, TargetRuntime } from '../../cli/lib/init/types.js'
import { init } from '../../cli/commands/init.js'

/**
 * The scripts of a package.json that `oa-gen init --target fastify --archetype enterprise` wrote
 * before init stopped writing scripts that fail or repeat `generate`, plus one the project wrote.
 */
const EARLIER_ENTERPRISE_SCRIPTS = {
  'test': 'vitest run',
  'dev': 'tsx watch src/server.ts',
  'build': 'tsc',
  'generate:router': 'oa-gen generate --target fastify',
  'mock': 'oa-gen mock --watch',
  'diff': 'oa-gen diff --base origin/main --head HEAD --fail-on-breaking',
  'lint:spec': 'oa-gen lint --categories structure,refs,components,semantics',
  'audit:csp': 'oa-gen audit:csp --bundle ./dist',
  'audit:shape': 'oa-gen audit:shape --fail-on-unsupported',
  'personas:check': 'oa-gen personas:check',
  'ci:gate': 'oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32',
}

/** The gate scripts the enterprise archetype writes for openapi.yaml. */
const GATE = {
  'lint:spec': 'oa-gen lint --spec openapi.yaml',
  'diff': `oa-gen diff --base ${CONTRACT_BASELINE_PATH} --head openapi.yaml --fail-on-breaking`,
  'baseline:update': `oa-gen normalize --spec openapi.yaml --output ${CONTRACT_BASELINE_PATH}`,
  'ci:gate': `oa-gen validate --spec openapi.yaml --require-32 && oa-gen lint --spec openapi.yaml && oa-gen diff --base ${CONTRACT_BASELINE_PATH} --head openapi.yaml --fail-on-breaking`,
}

const SPEC = [
  'openapi: 3.2.0',
  'info: { version: 1.0.0, title: Users }',
  'paths:',
  '  /users:',
  '    get:',
  '      operationId: listUsers',
  "      responses: { '200': { description: OK } }",
  '',
].join('\n')

const manifest = (scripts: Record<string, string>) => JSON.stringify({ name: 'app', scripts })

describe('scripts an earlier oa-gen init wrote', () => {
  it('are found with what replaces them, or to be removed when init no longer writes the name', () => {
    const retired = findRetiredInitScripts(manifest(EARLIER_ENTERPRISE_SCRIPTS), { generate: 'oa-gen generate', ...GATE })
    expect(retired.map(({ name, fix }) => [name, fix])).toEqual([
      ['generate:router', { action: 'remove' }],
      ['audit:csp', { action: 'remove' }],
      ['audit:shape', { action: 'remove' }],
      ['personas:check', { action: 'remove' }],
      ['lint:spec', { action: 'replace', replacement: GATE['lint:spec'] }],
      ['diff', { action: 'replace', replacement: GATE.diff }],
      ['ci:gate', { action: 'replace', replacement: GATE['ci:gate'] }],
    ])
    for (const script of retired) {
      expect(script.command, script.name).toBe(EARLIER_ENTERPRISE_SCRIPTS[script.name as keyof typeof EARLIER_ENTERPRISE_SCRIPTS])
    }
    expect(retired.find(script => script.name === 'diff')?.reason).toBe('oa-gen diff compares two spec files, not git refs')
    expect(retired.find(script => script.name === 'generate:router')?.reason)
      .toBe('oa-gen generate ignores --target, so it only repeats the "generate" script')
  })

  it('include the commands written on Bun and by the other archetypes', () => {
    const retired = findRetiredInitScripts(manifest({
      'generate:router': 'bun x oa-gen generate --target elysia',
      'generate:client': 'oa-gen generate --target client',
      'generate:contract': 'bun x oa-gen generate --target generic',
      'test:contract': 'bun test src/__tests__/contracts',
      'audit:wire': 'oa-gen audit:shape --strict',
      'ci:gate': 'bun x oa-gen diff --base origin/main --fail-on-breaking && bun x oa-gen validate --require-32',
    }), {})
    expect(retired.map(({ name, fix }) => [name, fix.action])).toEqual([
      ['generate:router', 'remove'],
      ['generate:client', 'remove'],
      ['generate:contract', 'remove'],
      ['test:contract', 'remove'],
      ['audit:wire', 'remove'],
      ['ci:gate', 'remove'],
    ])
  })

  it('are matched on the command as well as the name, so a script the project wrote is never one', () => {
    expect(findRetiredInitScripts(manifest({
      'test:contract': 'vitest run tests/contract',
      'generate:client': 'orval',
      'diff': 'oa-gen diff --base api.v1.yaml --head openapi.yaml',
      'personas:check': 'node scripts/personas.js',
    }), {})).toEqual([])
    expect(findRetiredInitScripts(JSON.stringify({ name: 'app' }), {})).toEqual([])
    expect(findRetiredInitScripts('[]', {})).toEqual([])
  })

  it('never include a script the current init writes', () => {
    for (const target of Object.values(TARGET_PROFILES)) {
      const runtimes: TargetRuntime[] = target.id === 'hono' ? ['node', 'bun'] : [target.defaultRuntime]
      for (const runtime of runtimes) {
        for (const archetype of ARCHETYPE_PROFILES) {
          const options: TargetGenerateOptions = {
            cwd: '.',
            frameworkId: target.id,
            runtime,
            detectedSchema: { type: 'openapi-yaml', filePath: 'openapi.yaml', confidence: 1, description: 'spec' },
          }
          const scripts = composeInitScripts(target, archetype, options)
          expect(findRetiredInitScripts(manifest(scripts), scripts), `${target.id} (${runtime}) x ${archetype.id}`).toEqual([])
        }
      }
    }
  })
})

describe('oa-gen init on the package.json of an earlier init', () => {
  let projectDir: string

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-retired-scripts-'))
    await fs.writeFile(path.join(projectDir, 'package.json'), manifest(EARLIER_ENTERPRISE_SCRIPTS))
    await fs.writeFile(path.join(projectDir, 'openapi.yaml'), SPEC)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(projectDir, { recursive: true, force: true })
  })

  const scripts = async () => JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8')).scripts

  it('reports the scripts it keeps, and that the baseline gates nothing until they are replaced', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await init.run({ cwd: projectDir, target: 'fastify', archetype: 'enterprise', yes: true })
    const lines = log.mock.calls.map(([line]) => String(line))

    expect(lines).toContain('⚠️ package.json keeps scripts an earlier oa-gen init wrote, which this one no longer writes:')
    expect(lines).toContain(
      `   - script "diff": "${EARLIER_ENTERPRISE_SCRIPTS.diff}" (oa-gen diff compares two spec files, not git refs); replace it with "${GATE.diff}"`,
    )
    expect(lines).toContain('   - script "personas:check": "oa-gen personas:check" (oa-gen has no personas:check command); remove it')
    expect(lines).toContain(
      `📌 Contract baseline: created ${CONTRACT_BASELINE_PATH} from openapi.yaml; commit it. ` +
        'package.json keeps its own "diff" and "ci:gate" scripts, which init did not replace; ' +
        'replace them with the commands listed above to gate the spec against it.',
    )
    expect(lines.join('\n')).not.toContain('The "diff" script fails on changes that break it')
    expect((await scripts()).diff).toBe(EARLIER_ENTERPRISE_SCRIPTS.diff)
    expect((await scripts())['baseline:update']).toBe(GATE['baseline:update'])
  })

  it('says to replace them before the baseline can be created when the spec does not exist yet', async () => {
    await fs.rm(path.join(projectDir, 'openapi.yaml'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await init.run({ cwd: projectDir, target: 'fastify', archetype: 'enterprise', yes: true })

    expect(log.mock.calls.map(([line]) => String(line))).toContain(
      `⚠️ Contract baseline ${CONTRACT_BASELINE_PATH} not created: the spec openapi.yaml does not exist yet. ` +
        'package.json keeps its own "diff" and "ci:gate" scripts, which init did not replace; ' +
        'replace them with the commands listed above, then run "baseline:update" once the spec loads.',
    )
  })

  it('with --force replaces the scripts it writes again, and still reports the ones to remove', async () => {
    const result = await runInit({ cwd: projectDir, target: 'fastify', archetype: 'enterprise', yes: true, force: true })
    expect(result.retiredScripts?.map(({ name, fix }) => [name, fix.action])).toEqual([
      ['generate:router', 'remove'],
      ['audit:csp', 'remove'],
      ['audit:shape', 'remove'],
      ['personas:check', 'remove'],
    ])
    expect(await scripts()).toMatchObject(GATE)
    expect((await scripts())['personas:check']).toBe(EARLIER_ENTERPRISE_SCRIPTS['personas:check'])
  })

  it('reports the gate scripts as ones to remove for an archetype without a gate', async () => {
    const result = await runInit({ cwd: projectDir, target: 'fastify', archetype: 'mvp', yes: true, dryRun: true })
    expect(result.retiredScripts?.filter(script => script.fix.action === 'replace')).toEqual([])
    expect(result.retiredScripts?.map(script => script.name)).toEqual(expect.arrayContaining(['lint:spec', 'diff', 'ci:gate']))
  })
})
