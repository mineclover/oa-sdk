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
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { typegen } from '../cli/commands/typegen.js'
import type { CommandArgValue } from '../cli/lib/types.js'
import { openCliIncrementalRun, closeCliIncrementalRun } from '../cli/lib/incremental.js'
import {
  planCliGenerationTarget,
  resolveCliGeneratorIdentity,
  type CliGenerationTarget,
} from '../cli/lib/incremental-targets.js'
import type { InputObservation } from '../cli/lib/input-observations.js'
import { observeModuleGraph } from '../cli/lib/module-graph-observer.js'
import { compileTypeSpecInMemory } from '../cli/lib/typespec-mock-compiler.js'
import { createSQLiteWorkspaceIndex, loadSqliteDriver } from '../sqlite-workspace-index.js'

const packageRoot = resolve(__dirname, '../..')
/** TypeSpec fixtures live inside the package so `@typespec/*` imports resolve from its node_modules. */
const packageTmpBase = resolve(packageRoot, '.tmp-typegen-incremental')
const TSX_CLI = resolve(packageRoot, '../../node_modules/tsx/dist/cli.mjs')
const CLI_SRC = resolve(packageRoot, 'src/cli/index.ts')

/**
 * A fixed past instant. Outputs are backdated to it so a rewrite is visible as
 * a current mtime; fixture inputs are backdated to it to state that they were
 * authored before the runs (an input first read while a run is in progress is
 * deliberately not trusted, see the race tests).
 */
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

type RunHooks = {
  /** Called once the generated output has been written, before the run records its target. */
  afterOutput?: () => void
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
    backdateInputs('api.yaml')
    const args = { spec: path('api.yaml'), incremental: true, 'cache-dir': cacheDir }

    const full = await runTypegen({ spec: path('api.yaml') })
    const first = await runTypegen(args)
    // The first run only learns about later.yaml after generating. Its directory was just written,
    // so nothing proves later.yaml was absent while generation ran; the next run checks it up front
    // and settles.
    const confirmed = await runTypegen(args)
    const replayed = await runTypegen(args)

    expect(first.stdout).toBe(full.stdout)
    expect(first.warnings).toEqual(full.warnings)
    expect(full.warnings).toEqual([expect.stringContaining(path('later.yaml'))])
    expect(confirmed.status).toEqual([
      `incremental: typegen regenerating (input not verified: ${path('later.yaml')} (may have changed during generation))`,
    ])
    expect(confirmed.stdout).toBe(full.stdout)
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

  it('trusts that a missing $ref document was absent when its directory predates the run', async () => {
    writeYaml('api.yaml', operationSpec('getLater', './later.yaml#/components/schemas/Later'))
    // The runs write only inside out/ and the cache directory, so the directory later.yaml would
    // be created in keeps a modification time from before the runs.
    mkdirSync(path('out'))
    mkdirSync(cacheDir)
    backdateInputs('api.yaml', '.')
    const args = { spec: path('api.yaml'), output: path('out/api.ts'), incremental: true, 'cache-dir': cacheDir }

    const first = await runTypegen(args)
    expect(first.status).toEqual(['incremental: typegen regenerating (no previous generation record)'])
    const reused = await runTypegen(args)
    expect(reused.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path('out/api.ts')})`])

    writeYaml('later.yaml', { components: { schemas: { Later: { type: 'object', properties: { at: { type: 'string' } } } } } })
    const added = await runTypegen(args)
    expect(added.status).toEqual([`incremental: typegen regenerating (input added: ${path('later.yaml')})`])
    expect(readFileSync(path('out/api.ts'), 'utf8')).toContain('export type Later = {')
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
    backdateInputs(
      'packages/schemas/package.json',
      'packages/schemas/user.yaml',
      'apps/api/node_modules/shared-schemas/package.json',
      'apps/api/node_modules/shared-schemas/order.yaml',
      'apps/api/api.yaml',
    )
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

  it('does not trust a newly discovered input that changes or disappears while the run is generating', async () => {
    writeTwoTargetWorkspace()

    // role.yaml is first read during generation; it changes before the run records the target.
    const editedDuringRun = await runTypegen(incrementalArgs('a'), {
      afterOutput: () => writeYaml('a/models/role.yaml', {
        components: { schemas: { Role: { type: 'string', enum: ['admin', 'member', 'guest'] } } },
      }),
    })
    expect(editedDuringRun.status).toEqual(['incremental: typegen regenerating (no previous generation record)'])
    expect(readFileSync(path('out/a.ts'), 'utf8')).toContain("export type Role = 'admin' | 'member'\n")

    const afterEdit = await runTypegen(incrementalArgs('a'))
    expect(afterEdit.status).toEqual([
      `incremental: typegen regenerating (input not verified: ${path('a/models/role.yaml')} (may have changed during generation))`,
    ])
    expect(readFileSync(path('out/a.ts'), 'utf8')).toContain("export type Role = 'admin' | 'member' | 'guest'")

    // order.yaml is first read during generation; it is deleted before the run records the target.
    await runTypegen(incrementalArgs('b'), { afterOutput: () => unlinkSync(path('b/order.yaml')) })
    expect(readFileSync(path('out/b.ts'), 'utf8')).toContain('export type Order = {')

    const afterDelete = await runTypegen(incrementalArgs('b'))
    expect(afterDelete.status).toEqual([
      `incremental: typegen regenerating (input not verified: ${path('b/order.yaml')} (may have changed during generation))`,
    ])
    await runTypegen({ spec: path('b/api.yaml'), output: path('full/b.ts') })
    expect(readFileSync(path('out/b.ts'), 'utf8')).toBe(readFileSync(path('full/b.ts'), 'utf8'))
    expect(readFileSync(path('out/b.ts'), 'utf8')).not.toContain('export type Order = {')

    for (const name of ['a', 'b'] as const) {
      const settled = await runTypegen(incrementalArgs(name))
      expect(settled.status).toEqual([`incremental: typegen up to date, regeneration skipped (${path(`out/${name}.ts`)})`])
    }
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

  it('tracks how TypeSpec imports resolve: a changed library manifest and a re-pointed library link', async () => {
    const root = createPackageTmpDir()
    try {
      const at = (relativePath: string) => join(root, relativePath)
      writeText(at('app/main.tsp'), [
        'import "@typespec/http";',
        'import "@acme/mylib";',
        'using Http;',
        '@service(#{ title: "App" })',
        'namespace App;',
        '@route("/thing") op getThing(): Lib.Thing;',
        '',
      ].join('\n'))
      // A workspace library linked into the app's node_modules, and a second checkout of the same
      // version (identical manifest) whose source differs.
      writeText(at('packages/mylib/package.json'), libraryManifest('lib/main.tsp'))
      writeText(at('packages/mylib/lib/main.tsp'), 'namespace Lib;\nmodel Thing { a: string; }\n')
      writeText(at('packages/mylib/lib/v2.tsp'), 'namespace Lib;\nmodel Thing { a: string; b: string; }\n')
      writeText(at('packages/mylib2/package.json'), libraryManifest('lib/main.tsp'))
      writeText(at('packages/mylib2/lib/main.tsp'), 'namespace Lib;\nmodel Thing { a: string; c: string; }\n')
      mkdirSync(at('app/node_modules/@acme'), { recursive: true })
      symlinkSync('../../../packages/mylib', at('app/node_modules/@acme/mylib'), 'dir')
      const outputPath = at('app/out.ts')
      const args = { spec: at('app/main.tsp'), output: outputPath, incremental: true, 'cache-dir': at('.oa-cache') }
      const fullOutput = async () => {
        await runTypegen({ spec: at('app/main.tsp'), output: at('app/full.ts') })
        return readFileSync(at('app/full.ts'), 'utf8')
      }
      const upToDate = [`incremental: typegen up to date, regeneration skipped (${outputPath})`]

      await runTypegen(args)
      expect((await runTypegen(args)).status).toEqual(upToDate)

      // The linked library now names another main file; every source read so far is unchanged.
      writeText(at('packages/mylib/package.json'), libraryManifest('lib/v2.tsp'))
      const manifestEdit = await runTypegen(args)

      expect(manifestEdit.status).toEqual([
        expect.stringMatching(regeneratingBecause(`input changed: ${at('app/node_modules/@acme/mylib/package.json')}`)),
      ])
      expect(readFileSync(outputPath, 'utf8')).toContain('b: string')
      expect(readFileSync(outputPath, 'utf8')).toBe(await fullOutput())
      expect((await runTypegen(args)).status).toEqual(upToDate)

      writeText(at('packages/mylib/package.json'), libraryManifest('lib/main.tsp'))
      await runTypegen(args)
      expect(readFileSync(outputPath, 'utf8')).not.toContain('b: string')
      expect((await runTypegen(args)).status).toEqual(upToDate)

      // The link is re-pointed at the other checkout: same manifest, and every file read so far is
      // unchanged, but the import now resolves elsewhere.
      unlinkSync(at('app/node_modules/@acme/mylib'))
      symlinkSync('../../../packages/mylib2', at('app/node_modules/@acme/mylib'), 'dir')
      const relinked = await runTypegen(args)

      expect(relinked.status).toEqual([
        expect.stringMatching(regeneratingBecause(`input link target changed: ${at('app/node_modules/@acme/mylib')}`)),
      ])
      expect(readFileSync(outputPath, 'utf8')).toContain('c: string')
      expect(readFileSync(outputPath, 'utf8')).toBe(await fullOutput())
      expect((await runTypegen(args)).status).toEqual(upToDate)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never trusts a decorator module the process loaded before it was edited', async () => {
    // In one process Node keeps the module it loaded first, so a regeneration after the edit still
    // runs the old decorator. The module loader reports the bytes it loaded, and they no longer
    // match the file, so the result is not trusted. (A fresh process sees the edit, see below.)
    const root = createPackageTmpDir()
    try {
      writeDecoratorProject(root, 'Version A')
      const outputPath = join(root, 'out.ts')
      const implPath = join(root, 'decorators/impl.js')
      const args = { spec: join(root, 'main.tsp'), output: outputPath, incremental: true, 'cache-dir': join(root, '.oa-cache') }

      await runTypegen(args)
      expect((await runTypegen(args)).status)
        .toEqual([`incremental: typegen up to date, regeneration skipped (${outputPath})`])

      writeText(implPath, decoratorImplementation('Version B'))
      const edited = await runTypegen(args)
      expect(edited.status).toEqual([expect.stringMatching(regeneratingBecause(`input changed: ${implPath}`))])
      expect(readFileSync(outputPath, 'utf8')).toContain('/** Version A: first checkout */')

      const next = await runTypegen(args)
      expect(next.status).toEqual([
        expect.stringMatching(regeneratingBecause(`input not verified: ${implPath} (changed during generation)`)),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not trust an imported TypeSpec source that differs from the text the compiler read', async () => {
    mkdirSync(packageTmpBase, { recursive: true })
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
      for (const filePath of [mainPath, modelsPath]) utimesSync(filePath, PAST, PAST)
      const args = { spec: mainPath, output: outputPath, incremental: true, 'cache-dir': join(tspDir, '.oa-cache') }

      // models.tsp is first seen by the compiler. It is rewritten after generation with its old
      // mtime restored (as a timestamp-preserving copy would), so only its content tells.
      const first = await runTypegen(args, {
        afterOutput: () => {
          writeFileSync(modelsPath, 'namespace Pets;\nmodel Pet { name: string; age: int32; }\n', 'utf8')
          utimesSync(modelsPath, PAST, PAST)
        },
      })
      expect(first.status).toEqual(['incremental: typegen regenerating (no previous generation record)'])
      expect(readFileSync(outputPath, 'utf8')).not.toContain('age: number')

      const next = await runTypegen(args)
      expect(next.status).toEqual([
        `incremental: typegen regenerating (input not verified: ${modelsPath} (changed during generation))`,
      ])
      expect(readFileSync(outputPath, 'utf8')).toContain('age: number')

      const settled = await runTypegen(args)
      expect(settled.status).toEqual([`incremental: typegen up to date, regeneration skipped (${outputPath})`])
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

  it('observes the module graph of a decorator entry: authored modules by content and resolution, installed packages by manifest', async () => {
    const root = createPackageTmpDir()
    try {
      const at = (relativePath: string) => join(root, relativePath)
      writeText(at('package.json'), '{ "type": "module" }\n')
      writeText(at('main.tsp'), [
        'import "./decorators/index.js";',
        'namespace Pets;',
        'extern dec petDoc(target: Reflection.Model);',
        '@petDoc model Pet { name: string; }',
        '',
      ].join('\n'))
      writeText(at('decorators/index.js'), 'export { $decorators } from "./impl.js";\n')
      writeText(at('decorators/impl.js'), [
        'import installed from "dep";',
        'import linked from "@acme/linked";',
        'export const $decorators = { Pets: { petDoc() { return installed + linked; } } };',
        '',
      ].join('\n'))
      // An installed package, and a workspace package linked into node_modules.
      writeText(at('node_modules/dep/package.json'), '{ "name": "dep", "version": "1.0.0", "type": "module", "main": "index.js" }\n')
      writeText(at('node_modules/dep/index.js'), 'export default 1;\n')
      writeText(at('packages/linked/package.json'), '{ "name": "@acme/linked", "type": "module", "main": "main.js" }\n')
      writeText(at('packages/linked/main.js'), 'export default 2;\n')
      mkdirSync(at('node_modules/@acme'), { recursive: true })
      symlinkSync('../../packages/linked', at('node_modules/@acme/linked'), 'dir')

      // The compiler imports the decorator entry; its module graph is observed while it loads.
      const compiled = await compileTypeSpecInMemory(at('main.tsp'), { recordInputs: true })
      const sha256Of = (relativePath: string) => createHash('sha256').update(readFileSync(at(relativePath))).digest('hex')

      const graph = describeObservations(observeModuleGraph([at('decorators/index.js')]), root)
      expect(graph).toEqual([
        `content decorators/impl.js sha256=${sha256Of('decorators/impl.js')}`,
        `content decorators/index.js sha256=${sha256Of('decorators/index.js')}`,
        'content decorators/package.json',
        'content node_modules/@acme/linked/package.json',
        'content node_modules/dep/package.json',
        'content package.json',
        `content packages/linked/main.js sha256=${sha256Of('packages/linked/main.js')}`,
        'content packages/linked/package.json',
        'entry decorators/node_modules/@acme/linked = absent',
        'entry decorators/node_modules/dep = absent',
        'entry node_modules/@acme/linked = directory',
        'entry node_modules/dep = directory',
        'realpath decorators/impl.js = decorators/impl.js',
        'realpath node_modules/@acme/linked = packages/linked',
        'realpath node_modules/dep = node_modules/dep',
      ])
      // The compilation reports the graph with what its host observed.
      expect(describeObservations(compiled.inputs ?? [], root)).toEqual(expect.arrayContaining(graph))
      expect(describeObservations(compiled.inputs ?? [], root)).toEqual(expect.arrayContaining([
        `content main.tsp text`,
        'entry decorators/index.js = file',
        'realpath decorators/index.js = decorators/index.js',
      ]))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('typegen --incremental in fresh processes', () => {
  it('regenerates when a module imported by a decorator entry changes', () => {
    // Each run is a new CLI process, as in real use, so an edited decorator module is loaded anew.
    const root = createPackageTmpDir()
    try {
      writeDecoratorProject(root, 'Version A')
      const implPath = join(root, 'decorators/impl.js')
      const outputPath = join(root, 'out.ts')
      // Absolute paths: the CLI resolves relative ones from the project root it discovers.
      const specPath = join(root, 'main.tsp')
      const incrementalArgs = ['typegen', '-s', specPath, '-o', outputPath, '--incremental', '--cache-dir', join(root, '.oa-cache')]
      const fullOutput = () => {
        expect(runCliProcess(['typegen', '-s', specPath, '-o', join(root, 'full.ts')], root).status).toBe(0)
        return readFileSync(join(root, 'full.ts'), 'utf8')
      }
      const upToDate = [`incremental: typegen up to date, regeneration skipped (${outputPath})`]

      expect(runCliProcess(incrementalArgs, root).incremental)
        .toEqual(['incremental: typegen regenerating (no previous generation record)'])
      expect(runCliProcess(incrementalArgs, root).incremental).toEqual(upToDate)
      expect(readFileSync(outputPath, 'utf8')).toContain('/** Version A: first checkout */')

      // The decorator entry re-exports from impl.js; only impl.js changes.
      writeText(implPath, decoratorImplementation('Version B'))
      const edited = runCliProcess(incrementalArgs, root)

      expect(edited.status).toBe(0)
      expect(edited.incremental).toEqual([expect.stringMatching(regeneratingBecause(`input changed: ${implPath}`))])
      expect(readFileSync(outputPath, 'utf8')).toContain('/** Version B: first checkout */')
      expect(readFileSync(outputPath, 'utf8')).toBe(fullOutput())
      expect(runCliProcess(incrementalArgs, root).incremental).toEqual(upToDate)

      // impl.js imports @acme/doc-text, whose link is re-pointed at another checkout of the same version.
      const linkPath = join(root, 'node_modules/@acme/doc-text')
      unlinkSync(linkPath)
      symlinkSync('../../packages/doc-text-2', linkPath, 'dir')
      const relinked = runCliProcess(incrementalArgs, root)

      expect(relinked.status).toBe(0)
      expect(relinked.incremental).toEqual([expect.stringMatching(regeneratingBecause(`input link target changed: ${linkPath}`))])
      expect(readFileSync(outputPath, 'utf8')).toContain('/** Version B: second checkout */')
      expect(readFileSync(outputPath, 'utf8')).toBe(fullOutput())
      expect(runCliProcess(incrementalArgs, root).incremental).toEqual(upToDate)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 300_000)
})

// ─── helpers ────────────────────────────────────────────────

function path(relativePath: string): string {
  return join(workspace, relativePath)
}

/** A scratch directory inside the package, so `@typespec/*` imports resolve; real path, as the compiler reports. */
function createPackageTmpDir(): string {
  mkdirSync(packageTmpBase, { recursive: true })
  return realpathSync(mkdtempSync(join(packageTmpBase, 'run-')))
}

function writeText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function libraryManifest(tspMain: string): string {
  return `${JSON.stringify({ name: '@acme/mylib', version: '1.0.0', tspMain }, null, 2)}\n`
}

/**
 * A TypeSpec project whose `@petDoc` decorator is implemented in JS: the entry
 * `decorators/index.js` re-exports the implementation from `decorators/impl.js`,
 * which documents the model with `label` and the text exported by the
 * workspace package `@acme/doc-text`, linked into node_modules from
 * `packages/doc-text-1` (`packages/doc-text-2` is a second checkout of the same
 * version). Every file and directory is backdated: the project was authored
 * before the runs.
 */
function writeDecoratorProject(root: string, label: string): void {
  for (const [checkout, docText] of [['doc-text-1', 'first checkout'], ['doc-text-2', 'second checkout']] as const) {
    writeText(join(root, 'packages', checkout, 'package.json'), `${JSON.stringify({
      name: '@acme/doc-text', version: '1.0.0', type: 'module', main: 'index.js',
    })}\n`)
    writeText(join(root, 'packages', checkout, 'index.js'), `export const docText = ${JSON.stringify(docText)};\n`)
  }
  mkdirSync(join(root, 'node_modules/@acme'), { recursive: true })
  symlinkSync('../../packages/doc-text-1', join(root, 'node_modules/@acme/doc-text'), 'dir')
  writeText(join(root, 'package.json'), '{ "type": "module" }\n')
  writeText(join(root, 'main.tsp'), [
    'import "@typespec/http";',
    'import "./decorators/index.js";',
    'using Http;',
    '@service(#{ title: "Pets" })',
    'namespace Pets;',
    'extern dec petDoc(target: Reflection.Model);',
    '@petDoc model Pet { name: string; }',
    '@route("/pets") op listPets(): Pet[];',
    '',
  ].join('\n'))
  writeText(join(root, 'decorators/index.js'), 'export { $decorators } from "./impl.js";\n')
  writeText(join(root, 'decorators/impl.js'), decoratorImplementation(label))
  backdateTree(root)
}

function decoratorImplementation(label: string): string {
  return [
    'import { $doc } from "@typespec/compiler";',
    'import { docText } from "@acme/doc-text";',
    `const label = ${JSON.stringify(label)};`,
    'export const $decorators = { Pets: { petDoc(context, target) { $doc(context, target, `${label}: ${docText}`); } } };',
    '',
  ].join('\n')
}

function backdateTree(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) backdateTree(entryPath)
    else if (entry.isFile()) utimesSync(entryPath, PAST, PAST)
  }
  utimesSync(directory, PAST, PAST)
}

/** The status line of a run that regenerates because of `reason`, possibly followed by more changes. */
function regeneratingBecause(reason: string): RegExp {
  const escaped = reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^incremental: typegen regenerating \\(${escaped}( \\(\\+\\d+ more\\))?\\)$`)
}

/** Observations under `root` as sorted, de-duplicated lines with root-relative paths. */
function describeObservations(observations: readonly InputObservation[], root: string): string[] {
  const inside = (filePath: string) => !relative(root, filePath).startsWith('..')
  const show = (filePath: string) => relative(root, filePath).split('\\').join('/')
  const lines = new Set<string>()
  for (const observation of observations) {
    if (!inside(observation.path)) continue
    const subject = `${observation.kind} ${show(observation.path)}`
    if ('unverified' in observation) lines.add(`${subject} unverified: ${observation.unverified}`)
    else if (observation.kind === 'content') {
      const consumed = observation.consumed
      lines.add(!consumed ? subject
        : 'text' in consumed ? `${subject} text`
        : 'sha256' in consumed ? `${subject} sha256=${consumed.sha256}`
        : `${subject} absent`)
    } else if (observation.kind === 'realpath') {
      lines.add(`${subject} = ${observation.value === null ? 'null' : show(observation.value)}`)
    } else {
      lines.add(`${subject} = ${observation.value}`)
    }
  }
  return [...lines].sort()
}

type CliProcessResult = { status: number | null; stdout: string; stderr: string; incremental: string[] }

/** Run the CLI from source in a new Node.js process. */
function runCliProcess(args: readonly string[], cwd: string): CliProcessResult {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_SRC, ...args], { cwd, encoding: 'utf8', timeout: 120_000 })
  const stderr = result.stderr ?? ''
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr,
    incremental: stderr.split('\n').filter(line => line.startsWith('incremental:')),
  }
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
  backdateInputs('a/api.yaml', 'a/models/user.yaml', 'a/models/role.yaml', 'b/api.yaml', 'b/order.yaml')
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

/** Inputs authored before the runs: their last modification precedes every run of the test. */
function backdateInputs(...relativePaths: string[]): void {
  for (const relativePath of relativePaths) utimesSync(path(relativePath), PAST, PAST)
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

async function runTypegen(args: Record<string, CommandArgValue>, hooks: RunHooks = {}): Promise<RunResult> {
  const stderr: string[] = []
  const logs: string[] = []
  let stdout = ''
  // The output is complete when typegen confirms the file write (console.log) or writes stdout.
  const outputWritten = () => hooks.afterOutput?.()
  const warn = vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(' '))
  })
  const log = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    logs.push(parts.map(String).join(' '))
    outputWritten()
  })
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    outputWritten()
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
