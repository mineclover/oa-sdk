/**
 * `oa-gen typegen --incremental` reuse and invalidation.
 *
 * Runs the typegen command in-process against a scratch workspace and observes
 * each decision through the `incremental:` status line on stderr, the output
 * file's mtime, and the workspace index row of the entry spec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { typegen } from '../cli/commands/typegen.js'
import type { CommandArgValue } from '../cli/lib/types.js'
import { openCliIncrementalRun, closeCliIncrementalRun } from '../cli/lib/incremental.js'
import {
  planCliGenerationTarget,
  resolveCliGeneratorIdentity,
  trackedInputPaths,
  type CliGenerationTarget,
} from '../cli/lib/incremental-targets.js'
import { createSQLiteWorkspaceIndex, loadSqliteDriver } from '../sqlite-workspace-index.js'

const packageRoot = resolve(__dirname, '../..')
/** TypeSpec fixtures live inside the package so `@typespec/*` imports resolve from its node_modules. */
const packageTmpBase = resolve(packageRoot, '.tmp-typegen-incremental')

/** A fixed past instant; an output rewritten by a run gets a current mtime instead. */
const PAST = new Date('2001-01-01T00:00:00Z')

type RunResult = {
  /** `incremental:` status lines written to stderr. */
  status: string[]
  /** Every other stderr line (warnings). */
  warnings: string[]
  /** Lines written with console.log (file output confirmations). */
  logs: string[]
  stdout: string
}

let workspace: string
let cacheDir: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typegen-incremental-'))
  cacheDir = join(workspace, '.oa-cache')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(workspace, { recursive: true, force: true })
})

describe('typegen --incremental', () => {
  it('generates every target on the first run, byte-identical to a non-incremental run', async () => {
    writeTwoTargetWorkspace()

    const full = await runTypegen({ spec: path('a/api.yaml'), output: path('full/a.ts') })
    const first = await runTypegen(incrementalArgs('a'))

    expect(first.status).toEqual(['incremental: typegen regenerating (no previous generation record)'])
    expect(first.logs).toEqual([`✅ TypeScript 타입 생성: ${path('out/a.ts')}`])
    expect(readFileSync(path('out/a.ts'), 'utf8')).toBe(readFileSync(path('full/a.ts'), 'utf8'))
    expect(full.status).toEqual([])
    // The transitively referenced schema (api -> user.yaml -> role.yaml) is part of the output.
    expect(readFileSync(path('out/a.ts'), 'utf8')).toContain("export type Role = 'admin' | 'member'")
  })

  it('regenerates nothing when inputs, options, and outputs are unchanged', async () => {
    writeTwoTargetWorkspace()
    await runTypegen(incrementalArgs('a'))
    await runTypegen(incrementalArgs('b'))
    const generatedA = readFileSync(path('out/a.ts'), 'utf8')
    const generatedB = readFileSync(path('out/b.ts'), 'utf8')
    // The index row of the most recently generated entry, written by that run.
    const indexedRunB = lastSeenRun(path('b/api.yaml'))
    expect(indexedRunB).toEqual(expect.any(String))
    backdateOutputs('out/a.ts', 'out/b.ts')

    const secondA = await runTypegen(incrementalArgs('a'))
    const secondB = await runTypegen(incrementalArgs('b'))

    expect(secondA.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/a.ts')})`])
    expect(secondB.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/b.ts')})`])
    expect(secondA.logs).toEqual([])
    expect(secondB.logs).toEqual([])
    expect(outputWasRewritten('out/a.ts')).toBe(false)
    expect(outputWasRewritten('out/b.ts')).toBe(false)
    expect(readFileSync(path('out/a.ts'), 'utf8')).toBe(generatedA)
    expect(readFileSync(path('out/b.ts'), 'utf8')).toBe(generatedB)
    // Reused targets do not rescan or refresh the workspace index either.
    expect(lastSeenRun(path('b/api.yaml'))).toBe(indexedRunB)
  })

  it('regenerates only the target whose transitive $ref input changed', async () => {
    writeTwoTargetWorkspace()
    await runTypegen(incrementalArgs('a'))
    await runTypegen(incrementalArgs('b'))
    backdateOutputs('out/a.ts', 'out/b.ts')

    writeYaml('a/models/role.yaml', {
      components: { schemas: { Role: { type: 'string', enum: ['admin', 'member', 'guest'] } } },
    })
    const changedA = await runTypegen(incrementalArgs('a'))
    const unchangedB = await runTypegen(incrementalArgs('b'))

    expect(changedA.status).toEqual([`incremental: typegen regenerating (input changed: ${path('a/models/role.yaml')})`])
    expect(unchangedB.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/b.ts')})`])
    expect(outputWasRewritten('out/a.ts')).toBe(true)
    expect(outputWasRewritten('out/b.ts')).toBe(false)
    expect(readFileSync(path('out/a.ts'), 'utf8')).toContain("export type Role = 'admin' | 'member' | 'guest'")
    await runTypegen({ spec: path('a/api.yaml'), output: path('full/a.ts') })
    expect(readFileSync(path('out/a.ts'), 'utf8')).toBe(readFileSync(path('full/a.ts'), 'utf8'))

    const settled = await runTypegen(incrementalArgs('a'))
    expect(settled.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/a.ts')})`])
  })

  it('regenerates every target when a generation option changes', async () => {
    writeTwoTargetWorkspace()
    await runTypegen(incrementalArgs('a'))
    await runTypegen(incrementalArgs('b'))

    const restyledA = await runTypegen({ ...incrementalArgs('a'), style: 'interface' })
    const restyledB = await runTypegen({ ...incrementalArgs('b'), style: 'interface' })

    expect(restyledA.status).toEqual(['incremental: typegen regenerating (options changed)'])
    expect(restyledB.status).toEqual(['incremental: typegen regenerating (options changed)'])
    await runTypegen({ spec: path('a/api.yaml'), output: path('full/a.ts'), style: 'interface' })
    expect(readFileSync(path('out/a.ts'), 'utf8')).toBe(readFileSync(path('full/a.ts'), 'utf8'))
    expect(readFileSync(path('out/a.ts'), 'utf8')).toContain('export interface User {')

    const settled = await runTypegen({ ...incrementalArgs('a'), style: 'interface' })
    expect(settled.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/a.ts')})`])
  })

  it('regenerates a deleted or edited output and leaves other outputs alone', async () => {
    writeTwoTargetWorkspace()
    await runTypegen(incrementalArgs('a'))
    await runTypegen(incrementalArgs('b'))
    const generatedA = readFileSync(path('out/a.ts'), 'utf8')
    const generatedB = readFileSync(path('out/b.ts'), 'utf8')
    backdateOutputs('out/b.ts')

    unlinkSync(path('out/a.ts'))
    const deleted = await runTypegen(incrementalArgs('a'))
    const untouched = await runTypegen(incrementalArgs('b'))

    expect(deleted.status).toEqual([`incremental: typegen regenerating (output missing: ${path('out/a.ts')})`])
    expect(readFileSync(path('out/a.ts'), 'utf8')).toBe(generatedA)
    expect(untouched.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/b.ts')})`])
    expect(outputWasRewritten('out/b.ts')).toBe(false)

    writeFileSync(path('out/b.ts'), `${generatedB}// hand edit\n`, 'utf8')
    const edited = await runTypegen(incrementalArgs('b'))

    expect(edited.status).toEqual([`incremental: typegen regenerating (output modified: ${path('out/b.ts')})`])
    expect(readFileSync(path('out/b.ts'), 'utf8')).toBe(generatedB)
  })

  it('regenerates when the generator identity recorded with the target differs', async () => {
    writeTwoTargetWorkspace()
    await runTypegen(incrementalArgs('a'))

    // Simulate a record written by another generator version.
    const db = loadSqliteDriver().open(join(cacheDir, 'state.sqlite')) as {
      prepare(sql: string): { run(...values: unknown[]): unknown }
      close(): void
    }
    try {
      db.prepare('UPDATE generation_targets SET generator_hash = ?').run('0'.repeat(64))
    } finally {
      db.close()
    }

    const rerun = await runTypegen(incrementalArgs('a'))
    expect(rerun.status).toEqual(['incremental: typegen regenerating (generator version changed)'])
    const settled = await runTypegen(incrementalArgs('a'))
    expect(settled.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/a.ts')})`])
  })

  it('replays stdout output and warnings, and tracks a referenced file that does not exist yet', async () => {
    writeYaml('api.yaml', operationSpec('getLater', './later.yaml#/components/schemas/Later'))
    const args = { spec: path('api.yaml'), incremental: true, 'cache-dir': cacheDir }

    const full = await runTypegen({ spec: path('api.yaml') })
    const first = await runTypegen(args)
    const replayed = await runTypegen(args)

    expect(first.stdout).toBe(full.stdout)
    expect(first.warnings).toEqual(full.warnings)
    expect(full.warnings).toEqual([expect.stringContaining(path('later.yaml'))])
    expect(replayed.status).toEqual(['incremental: typegen up to date, regeneration skipped (stdout)'])
    expect(replayed.stdout).toBe(full.stdout)
    expect(replayed.warnings).toEqual(full.warnings)

    writeYaml('later.yaml', { components: { schemas: { Later: { type: 'object', properties: { at: { type: 'string' } } } } } })
    const added = await runTypegen(args)

    expect(added.status).toEqual([`incremental: typegen regenerating (input added: ${path('later.yaml')})`])
    expect(added.warnings).toEqual([])
    expect(added.stdout).toBe((await runTypegen({ spec: path('api.yaml') })).stdout)
    expect(added.stdout).toContain('export type Later = {')
  })

  it('tracks $ref documents inside node_modules by their own content', async () => {
    // A workspace package linked into node_modules (pnpm/yarn/npm workspaces, `link:`)...
    writeJson('packages/schemas/package.json', { name: '@acme/schemas', version: '1.0.0' })
    writeYaml('packages/schemas/user.yaml', objectSchemaDocument('User', ['id']))
    mkdirSync(path('apps/api/node_modules/@acme'), { recursive: true })
    symlinkSync('../../../../packages/schemas', path('apps/api/node_modules/@acme/schemas'), 'dir')
    // ...and a package installed as a plain directory.
    writeJson('apps/api/node_modules/shared-schemas/package.json', { name: 'shared-schemas', version: '1.0.0' })
    writeYaml('apps/api/node_modules/shared-schemas/order.yaml', objectSchemaDocument('Order', ['id']))
    writeYaml('apps/api/api.yaml', apiSpec({
      getUser: './node_modules/@acme/schemas/user.yaml#/components/schemas/User',
      getOrder: './node_modules/shared-schemas/order.yaml#/components/schemas/Order',
    }))
    const args = { spec: path('apps/api/api.yaml'), output: path('out/api.ts'), incremental: true, 'cache-dir': cacheDir }
    const fullOutput = async () => {
      await runTypegen({ spec: path('apps/api/api.yaml'), output: path('full/api.ts') })
      return readFileSync(path('full/api.ts'), 'utf8')
    }

    await runTypegen(args)
    expect((await runTypegen(args)).status)
      .toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/api.ts')})`])

    // Editing a linked package's schema leaves its manifest untouched.
    writeYaml('packages/schemas/user.yaml', objectSchemaDocument('User', ['id', 'email']))
    const linkedEdit = await runTypegen(args)

    expect(linkedEdit.status).toEqual([
      `incremental: typegen regenerating (input changed: ${path('apps/api/node_modules/@acme/schemas/user.yaml')})`,
    ])
    expect(readFileSync(path('out/api.ts'), 'utf8')).toContain('email')
    expect(readFileSync(path('out/api.ts'), 'utf8')).toBe(await fullOutput())

    writeYaml('apps/api/node_modules/shared-schemas/order.yaml', objectSchemaDocument('Order', ['id', 'total']))
    const installedEdit = await runTypegen(args)

    expect(installedEdit.status).toEqual([
      `incremental: typegen regenerating (input changed: ${path('apps/api/node_modules/shared-schemas/order.yaml')})`,
    ])
    expect(readFileSync(path('out/api.ts'), 'utf8')).toContain('total')
    expect(readFileSync(path('out/api.ts'), 'utf8')).toBe(await fullOutput())
  })

  it('tracks TypeSpec sources imported by the entry file', async () => {
    mkdirSync(packageTmpBase, { recursive: true })
    // The TypeSpec compiler reports real paths.
    const tspDir = realpathSync(mkdtempSync(join(packageTmpBase, 'run-')))
    try {
      const mainPath = join(tspDir, 'main.tsp')
      const modelsPath = join(tspDir, 'models.tsp')
      const outputPath = join(tspDir, 'out.ts')
      writeFileSync(mainPath, [
        'import "@typespec/http";',
        'import "./models.tsp";',
        'using Http;',
        '@service(#{ title: "Pets" })',
        'namespace Pets;',
        '@route("/pets") op listPets(): Pet[];',
        '',
      ].join('\n'), 'utf8')
      writeFileSync(modelsPath, 'namespace Pets;\nmodel Pet { name: string; }\n', 'utf8')
      const args = { spec: mainPath, output: outputPath, incremental: true, 'cache-dir': join(tspDir, '.oa-cache') }

      await runTypegen(args)
      const reused = await runTypegen(args)
      expect(reused.status).toEqual([`incremental: typegen up to date, regeneration skipped (${outputPath})`])

      writeFileSync(modelsPath, 'namespace Pets;\nmodel Pet { name: string; age: int32; }\n', 'utf8')
      const changed = await runTypegen(args)

      expect(changed.status).toEqual([`incremental: typegen regenerating (input changed: ${modelsPath})`])
      expect(readFileSync(outputPath, 'utf8')).toContain('age: number')
    } finally {
      rmSync(tspDir, { recursive: true, force: true })
    }
  })
})

describe('incremental generation targets', () => {
  it('resolves the generator identity from installed package versions', () => {
    const ownVersion = (JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string }).version

    expect(resolveCliGeneratorIdentity('format-a', ['@oa-sdk/codegen', 'yaml'])).toEqual({
      format: 'format-a',
      '@oa-sdk/codegen': ownVersion,
      yaml: expect.stringMatching(/^\d+\.\d+\.\d+/),
    })
    expect(resolveCliGeneratorIdentity('format-a', ['@oa-sdk/codegen', '@oa-sdk/not-installed'])).toBeUndefined()
  })

  it('never reuses a target whose generator identity is unknown', () => {
    writeYaml('api.yaml', operationSpec('getThing', '#/components/schemas/Thing'))
    const run = openCliIncrementalRun({ enabled: true, specPath: path('api.yaml'), cacheDir })
    try {
      const target: CliGenerationTarget = {
        command: 'typegen',
        entryPath: path('api.yaml'),
        output: { kind: 'stdout' },
        options: {},
        generator: undefined,
      }
      expect(planCliGenerationTarget(run, target)).toEqual({ action: 'generate', reason: 'generator version unavailable' })
    } finally {
      closeCliIncrementalRun(run)
    }
  })

  it('tracks module files inside installed packages through their manifest and every other input by its own content', () => {
    const nodeModules = join(workspace, 'node_modules')
    const realNodeModules = join(realpathSync(workspace), 'node_modules')
    const entry = join(nodeModules, 'spec-pkg', 'api.tsp')
    const files = {
      entry,
      installedSource: join(nodeModules, '@scope', 'lib', 'lib', 'main.tsp'),
      installedJs: join(nodeModules, '@scope', 'lib', 'dist', 'index.js'),
      virtualStoreSource: join(nodeModules, '.pnpm', 'dep@1.0.0', 'node_modules', 'dep', 'main.tsp'),
      linkedSource: join(nodeModules, '@scope', 'linked', 'lib', 'main.tsp'),
      authoredSource: join(workspace, 'models.tsp'),
      installedRefDocument: join(nodeModules, 'shared-schemas', 'user.yaml'),
      authoredRefDocument: join(workspace, 'models', 'user.yaml'),
    }
    for (const filePath of Object.values(files)) {
      if (filePath === files.linkedSource) continue
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, '', 'utf8')
    }
    // A workspace package linked into node_modules lives outside it.
    mkdirSync(path('packages/lib/lib'), { recursive: true })
    writeFileSync(path('packages/lib/lib/main.tsp'), '', 'utf8')
    symlinkSync('../../packages/lib', join(nodeModules, '@scope', 'linked'), 'dir')

    expect(trackedInputPaths(
      entry,
      [files.installedRefDocument, files.authoredRefDocument],
      [
        files.entry,
        files.installedSource,
        files.installedJs,
        files.virtualStoreSource,
        files.linkedSource,
        files.authoredSource,
      ],
    )).toEqual([
      join(realNodeModules, '.pnpm', 'dep@1.0.0', 'node_modules', 'dep', 'package.json'),
      join(realNodeModules, '@scope', 'lib', 'package.json'),
      files.entry,
      files.linkedSource,
      files.installedRefDocument,
      files.authoredSource,
      files.authoredRefDocument,
    ].sort((a, b) => a.localeCompare(b)))
  })
})

// ─── helpers ────────────────────────────────────────────────

function path(relativePath: string): string {
  return join(workspace, relativePath)
}

function incrementalArgs(name: 'a' | 'b'): Record<string, CommandArgValue> {
  return { spec: path(`${name}/api.yaml`), output: path(`out/${name}.ts`), incremental: true, 'cache-dir': cacheDir }
}

/**
 * Two independent targets sharing one cache:
 *   a/api.yaml -> a/models/user.yaml -> a/models/role.yaml (transitive external $ref)
 *   b/api.yaml -> b/order.yaml
 */
function writeTwoTargetWorkspace(): void {
  writeYaml('a/api.yaml', operationSpec('getUser', './models/user.yaml#/components/schemas/User'))
  writeYaml('a/models/user.yaml', {
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, role: { $ref: './role.yaml#/components/schemas/Role' } },
        },
      },
    },
  })
  writeYaml('a/models/role.yaml', { components: { schemas: { Role: { type: 'string', enum: ['admin', 'member'] } } } })
  writeYaml('b/api.yaml', operationSpec('getOrder', './order.yaml#/components/schemas/Order'))
  writeYaml('b/order.yaml', {
    components: { schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } } },
  })
}

function operationSpec(operationId: string, schemaRef: string): Record<string, unknown> {
  return apiSpec({ [operationId]: schemaRef })
}

/** One GET operation per entry, each responding with the referenced schema. */
function apiSpec(schemaRefsByOperation: Record<string, string>): Record<string, unknown> {
  const operations = Object.entries(schemaRefsByOperation)
  return {
    openapi: '3.2.0',
    info: { title: operations.map(([operationId]) => operationId).join(' '), version: '1.0.0' },
    paths: Object.fromEntries(operations.map(([operationId, schemaRef]) => [`/${operationId}`, {
      get: {
        operationId,
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: { $ref: schemaRef } } } },
        },
      },
    }])),
    ...(operations.some(([, schemaRef]) => schemaRef.startsWith('#/'))
      ? { components: { schemas: { Thing: { type: 'string' } } } }
      : {}),
  }
}

/** A document with one object schema whose properties are all strings. */
function objectSchemaDocument(name: string, properties: readonly string[]): Record<string, unknown> {
  return {
    components: {
      schemas: {
        [name]: {
          type: 'object',
          properties: Object.fromEntries(properties.map(property => [property, { type: 'string' }])),
        },
      },
    },
  }
}

function writeYaml(relativePath: string, value: unknown): void {
  const filePath = path(relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
}

function writeJson(relativePath: string, value: unknown): void {
  const filePath = path(relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function backdateOutputs(...relativePaths: string[]): void {
  for (const relativePath of relativePaths) utimesSync(path(relativePath), PAST, PAST)
}

function outputWasRewritten(relativePath: string): boolean {
  return statSync(path(relativePath)).mtimeMs !== PAST.getTime()
}

function lastSeenRun(filePath: string): string | undefined {
  const index = createSQLiteWorkspaceIndex({ cacheDir })
  try {
    return index.getFile(filePath)?.lastSeenRun
  } finally {
    index.close()
  }
}

async function runTypegen(args: Record<string, CommandArgValue>): Promise<RunResult> {
  const stderr: string[] = []
  const logs: string[] = []
  let stdout = ''
  const warn = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(' '))
  })
  const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(' '))
  })
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    return true
  })
  try {
    await typegen.run(args)
  } finally {
    warn.mockRestore()
    log.mockRestore()
    write.mockRestore()
  }
  return {
    status: stderr.filter(line => line.startsWith('incremental:')),
    warnings: stderr.filter(line => !line.startsWith('incremental:')),
    logs,
    stdout,
  }
}
