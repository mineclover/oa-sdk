/**
 * `--incremental` command runs hash each workspace file at most once.
 *
 * Content hashing reads a file as raw bytes (`readFileSync(path)` with no
 * encoding), while spec loading and `$ref` resolution read text. Counting raw
 * reads per fixture file over one in-process command run therefore shows
 * whether the run's scans, dirty detection and target checks share one stamp
 * per file instead of hashing it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { typegen } from '../cli/commands/typegen.js'
import { validate } from '../cli/commands/validate.js'
import type { Command, CommandArgValue } from '../cli/lib/types.js'

const rawReadCounts = vi.hoisted(() => new Map<string, number>())

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const [file, options] = args
    if (typeof file === 'string' && options === undefined) {
      rawReadCounts.set(file, (rawReadCounts.get(file) ?? 0) + 1)
    }
    return actual.readFileSync(...args)
  }) as typeof actual.readFileSync
  return { ...actual, default: { ...actual, readFileSync }, readFileSync }
})

/** Fixture inputs are authored before the runs. */
const PAST = new Date('2001-01-01T00:00:00Z')

let workspace: string
let cacheDir: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-incremental-hash-once-'))
  cacheDir = join(workspace, '.oa-cache')
  // api.yaml -> models/user.yaml -> models/role.yaml (transitive external $ref)
  writeYaml('api.yaml', {
    openapi: '3.2.0',
    info: { title: 'Users', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'getUser',
          responses: {
            '200': {
              description: 'OK',
              content: { 'application/json': { schema: { $ref: './models/user.yaml#/components/schemas/User' } } },
            },
          },
        },
      },
    },
  })
  writeYaml('models/user.yaml', {
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: { id: { type: 'string' }, role: { $ref: './role.yaml#/components/schemas/Role' } },
        },
      },
    },
  })
  writeRole(['admin', 'member'])
  for (const relativePath of ['api.yaml', 'models/user.yaml', 'models/role.yaml']) {
    utimesSync(path(relativePath), PAST, PAST)
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(workspace, { recursive: true, force: true })
})

describe('incremental runs hash each file once', () => {
  it('typegen --incremental hashes the entry spec and each $ref document once per run', async () => {
    const args = { spec: path('api.yaml'), output: path('out.ts'), incremental: true, 'cache-dir': cacheDir }
    const inputsOnce = { 'api.yaml': 1, 'models/role.yaml': 1, 'models/user.yaml': 1 }

    // No record yet: index invalidation, index recording and target recording all stamp the inputs.
    expect(await hashReadsDuring(typegen, args)).toEqual(inputsOnce)

    // A changed input: the target check stamps every recorded input before generating as well.
    writeRole(['admin', 'member', 'guest'])
    expect(await hashReadsDuring(typegen, args)).toEqual(inputsOnce)

    // Reuse: every recorded input and the output are checked once.
    expect(await hashReadsDuring(typegen, args)).toEqual({ ...inputsOnce, 'out.ts': 1 })
  })

  it('validate --incremental hashes the entry spec and each $ref document once per run', async () => {
    const args = { spec: path('api.yaml'), incremental: true, 'cache-dir': cacheDir }
    const inputsOnce = { 'api.yaml': 1, 'models/role.yaml': 1, 'models/user.yaml': 1 }

    expect(await hashReadsDuring(validate, args)).toEqual(inputsOnce)
    // The index now lists the $ref documents, so dirty detection scans them before validation too.
    writeRole(['admin', 'member', 'guest'])
    expect(await hashReadsDuring(validate, args)).toEqual(inputsOnce)
  })
})

function path(relativePath: string): string {
  return join(workspace, relativePath)
}

function writeYaml(relativePath: string, value: unknown): void {
  const filePath = path(relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
}

function writeRole(values: readonly string[]): void {
  writeYaml('models/role.yaml', { components: { schemas: { Role: { type: 'string', enum: values } } } })
}

/** Raw (hashing) reads of workspace files during one command run, keyed by workspace-relative path. */
async function hashReadsDuring(command: Command, args: Record<string, CommandArgValue>): Promise<Record<string, number>> {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  rawReadCounts.clear()
  try {
    await command.run(args)
  } finally {
    vi.restoreAllMocks()
  }
  const prefix = `${workspace}${sep}`
  return Object.fromEntries([...rawReadCounts]
    .filter(([filePath]) => filePath.startsWith(prefix) && !filePath.startsWith(`${cacheDir}${sep}`))
    .map(([filePath, count]) => [filePath.slice(prefix.length).split(sep).join('/'), count] as const)
    .sort(([a], [b]) => a.localeCompare(b)))
}
