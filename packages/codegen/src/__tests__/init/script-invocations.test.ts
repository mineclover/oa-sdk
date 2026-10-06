import * as path from 'node:path'
import { parseArgs } from 'node:util'
import { describe, expect, it } from 'vitest'
import { commands } from '../../cli/commands.js'
import { GLOBAL_OPTIONS } from '../../cli/lib/run.js'
import {
  ARCHETYPE_PROFILES,
  TARGET_PROFILES,
  composeInitScripts,
  scriptPath,
} from '../../cli/lib/init/index.js'
import type { DetectedSchemaItem, TargetGenerateOptions, TargetProfile, TargetRuntime } from '../../cli/lib/init/types.js'
import type { ArchetypeProfile } from '../../cli/lib/init/archetypes/types.js'
import { oaGenArguments, scriptCommands } from '../helpers/script-commands.js'

/**
 * The commands other than `oa-gen` that init adds: a framework target's dev server and build, which
 * run the project's own server code. Nothing else, such as a test runner over tests init does not
 * write, may appear.
 */
const FRAMEWORK_COMMANDS = [
  /^tsx watch src\/[\w-]+\.ts$/,
  /^tsc$/,
  /^bun --watch src\/[\w-]+\.ts$/,
  /^nest start --watch$/,
]

/** `oa-gen` options that name a file the command reads or writes. */
const FILE_OPTIONS = new Set(['spec', 'base', 'head', 'output', 'artifact', 'bundle', 'source', 'file', 'input', 'tsp', 'config'])

/** Spec entry points init records: none found (openapi.yaml), TypeSpec, and a path a shell must not split. */
const SPEC_ENTRIES = ['openapi.yaml', path.join('typespec', 'main.tsp'), path.join('My API', 'openapi.json')]

interface Scaffold {
  target: TargetProfile
  archetype: ArchetypeProfile
  runtime: TargetRuntime
  options: TargetGenerateOptions
  /** Files the scaffold has, as its scripts name them: the spec entry and the archetype's baseline. */
  files: Set<string>
}

function scaffolds(): Scaffold[] {
  const result: Scaffold[] = []
  for (const target of Object.values(TARGET_PROFILES)) {
    // Hono runs on either runtime; every other target on its own.
    const runtimes: TargetRuntime[] = target.id === 'hono' ? ['node', 'bun'] : [target.defaultRuntime]
    for (const runtime of runtimes) {
      for (const archetype of ARCHETYPE_PROFILES) {
        for (const filePath of SPEC_ENTRIES) {
          const detectedSchema: DetectedSchemaItem = { type: 'openapi-yaml', filePath, confidence: 1, description: 'spec' }
          const options: TargetGenerateOptions = { cwd: '.', frameworkId: target.id, runtime, detectedSchema }
          const baseline = archetype.getContractBaseline?.({ ...options, archetypeId: archetype.id })
          const files = new Set([scriptPath(filePath), ...(baseline ? [baseline.path] : [])])
          result.push({ target, archetype, runtime, options, files })
        }
      }
    }
  }
  return result
}

/**
 * Why `args` would not run as written, the way `oa-gen` reads them (lib/run.ts): an unknown
 * command or option, a missing required option, a file the scaffold does not have, or a `--target`
 * that `oa-gen generate` ignores. Empty when it runs.
 */
function invocationProblems(args: readonly string[], files: ReadonlySet<string>): string[] {
  const [name, ...argv] = args
  const command = commands.find(candidate => candidate.name === name)
  if (command === undefined) return [`oa-gen has no command ${name}`]

  const options = { ...GLOBAL_OPTIONS, ...command.options }
  let values: Record<string, unknown>
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: Object.fromEntries(Object.entries(options).map(([key, option]) => [
        key,
        { type: option.type, ...(option.short ? { short: option.short } : {}), ...(option.multiple ? { multiple: true } : {}) },
      ])),
      allowPositionals: false,
    }))
  } catch (error) {
    return [`oa-gen ${name} rejects its arguments: ${error instanceof Error ? error.message : String(error)}`]
  }

  const problems: string[] = []
  for (const [key, option] of Object.entries(command.options)) {
    if (option.required && values[key] === undefined) problems.push(`oa-gen ${name} needs --${key}`)
  }
  for (const [key, value] of Object.entries(values)) {
    if (FILE_OPTIONS.has(key) && typeof value === 'string' && !files.has(value)) {
      problems.push(`oa-gen ${name} --${key} ${value} names a file the scaffold does not have`)
    }
  }
  // `generate` reads --target only as standalone-guards, which init never wants; other values are ignored.
  if (name === 'generate' && values['target'] !== undefined) {
    problems.push(`oa-gen generate ignores --target ${String(values['target'])}`)
  }
  return problems
}

describe('the scripts oa-gen init writes run as written', () => {
  for (const { target, archetype, runtime, options, files } of scaffolds()) {
    const filePath = options.detectedSchema!.filePath
    it(`${target.id} (${runtime}) x ${archetype.id}, spec ${filePath}`, () => {
      const scripts = composeInitScripts(target, archetype, options)
      const problems: string[] = []
      for (const [name, script] of Object.entries(scripts)) {
        for (const command of scriptCommands(script)) {
          const args = oaGenArguments(command)
          if (args === undefined) {
            if (!FRAMEWORK_COMMANDS.some(pattern => pattern.test(command.join(' ')))) {
              problems.push(`${name}: ${command.join(' ')} is not oa-gen nor the framework's dev server or build`)
            }
            continue
          }
          if (runtime === 'bun' && command[0] !== 'bun') problems.push(`${name}: runs oa-gen without bun x on Bun`)
          problems.push(...invocationProblems(args, files).map(problem => `${name}: ${problem}`))
        }
      }
      expect(problems).toEqual([])
    })
  }

  it('reads the scripts as a shell does', () => {
    expect(scriptCommands('oa-gen lint --spec "My API/openapi.json" && bun x oa-gen diff --head a.yaml')).toEqual([
      ['oa-gen', 'lint', '--spec', 'My API/openapi.json'],
      ['bun', 'x', 'oa-gen', 'diff', '--head', 'a.yaml'],
    ])
    expect(() => scriptCommands('oa-gen generate; rm -rf src')).toThrow(/unsupported shell syntax/)
    expect(invocationProblems(['personas:check'], new Set())).toEqual(['oa-gen has no command personas:check'])
    expect(invocationProblems(['audit:shape', '--strict'], new Set())[0]).toMatch(/rejects its arguments/)
    expect(invocationProblems(['diff', '--base', 'origin/main', '--fail-on-breaking'], new Set(['openapi.yaml']))).toEqual([
      'oa-gen diff needs --head',
      'oa-gen diff --base origin/main names a file the scaffold does not have',
    ])
    expect(invocationProblems(['generate', '--target', 'fastify'], new Set())).toEqual(['oa-gen generate ignores --target fastify'])
  })
})
