import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../cli/commands/generate.js'
import { CliExitError } from '../../cli/lib/errors.js'
import {
  COMPANION_PACKAGES,
  commandCompanion,
  explicitCompanionOutputs,
  type CompanionCommandContext,
  type CompanionImporter,
  type CompanionPackageName,
} from '../../cli/lib/companion-packages.js'
import {
  ARCHETYPE_PROFILES,
  TARGET_PROFILES,
  composeInitCompanionPackages,
  composeInitCoreConfig,
  composeInitDependencies,
  composeInitScripts,
  oaGenCommandsIn,
  REGISTRY_SOURCES,
  resolveOaSdkPackage,
  runInit,
} from '../../cli/lib/init/index.js'
import type { TargetRuntime } from '../../cli/lib/init/types.js'
import { defineConfig, type OaConfig } from '../../config.js'
import { importerWithout } from '../helpers/companion-packages.js'

/**
 * `oa-gen init` writes a configuration that turns companion-produced outputs on
 * explicitly and scripts that run companion-backed commands, so it must list
 * those companion packages in package.json: otherwise `oa-gen generate`, which
 * refuses explicit outputs whose companion is missing, cannot run on the
 * scaffold in a published install.
 */

describe('oaGenCommandsIn', () => {
  it('finds every oa-gen command of a shell command line', () => {
    expect(oaGenCommandsIn('oa-gen mock --watch')).toEqual(['mock'])
    expect(oaGenCommandsIn('bun x oa-gen generate --target client')).toEqual(['generate'])
    expect(oaGenCommandsIn('oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32'))
      .toEqual(['diff', 'validate'])
    expect(oaGenCommandsIn('(oa-gen generate:client;oa-gen pack:client)|tee log')).toEqual(['generate:client', 'pack:client'])
  })

  it('ignores words that merely contain oa-gen', () => {
    expect(oaGenCommandsIn('tsx watch src/oa-gen-server.ts')).toEqual([])
    expect(oaGenCommandsIn('my-oa-gen mock')).toEqual([])
    expect(oaGenCommandsIn('vitest run')).toEqual([])
  })
})

describe('composeInitCompanionPackages', () => {
  it('lists the companions of explicitly enabled outputs and of companion-backed script commands', () => {
    expect(composeInitCompanionPackages(
      { contracts: { pureHandlers: true }, client: { enabled: false } },
      { mock: 'bun x oa-gen mock --watch', client: 'oa-gen generate:tanstack --spec api.yaml' },
    ).sort()).toEqual(['@oa-sdk/client', '@oa-sdk/mock-server', '@oa-sdk/router'])
  })

  it('lists nothing when the configuration enables no companion output and no script needs one', () => {
    expect(composeInitCompanionPackages(
      { contracts: { pureHandlers: false } },
      { generate: 'oa-gen generate', validate: 'oa-gen validate' },
    )).toEqual([])
  })
})

describe('oa-gen init recommends the companion packages its scaffold needs', () => {
  const runtimes: TargetRuntime[] = ['node', 'bun']

  for (const target of Object.values(TARGET_PROFILES)) {
    for (const archetype of ARCHETYPE_PROFILES) {
      for (const runtime of runtimes) {
        it(`${target.id} x ${archetype.id} (${runtime})`, () => {
          const options = { cwd: '/workspace/app', frameworkId: target.id, runtime }
          const { dependencies = {}, devDependencies } = composeInitDependencies(target, archetype, options)
          const listed = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)])

          // What `oa-gen generate` refuses to run without for the scaffolded configuration.
          for (const { packageName, configSwitch } of explicitCompanionOutputs({ core: composeInitCoreConfig(archetype) })) {
            expect(listed.has(packageName), `${configSwitch} needs ${packageName}`).toBe(true)
          }
          // What the scaffolded scripts' commands refuse to run without.
          for (const [script, commandLine] of Object.entries(composeInitScripts(target, archetype, options))) {
            for (const command of oaGenCommandsIn(commandLine)) {
              const packageName = commandCompanion(command)
              if (packageName === undefined) continue
              expect(listed.has(packageName), `script ${script} runs oa-gen ${command}, which needs ${packageName}`).toBe(true)
            }
          }
        })
      }
    }
  }

  it('gives a companion the same specifier whether a profile names it or only the scaffold needs it', () => {
    // fastify names @oa-sdk/router; generic does not, but the scaffold's handler contracts need it.
    const mvp = ARCHETYPE_PROFILES.find(profile => profile.id === 'mvp')!
    const { fastify, generic } = TARGET_PROFILES
    const options = (target: typeof fastify) => ({ cwd: '/workspace/app', frameworkId: target.id, runtime: 'node' as const })
    expect(fastify.getRecommendedDependencies(options(fastify)).oaSdkDevDependencies).toContain('@oa-sdk/router')
    expect(generic.getRecommendedDependencies(options(generic)).oaSdkDevDependencies).not.toContain('@oa-sdk/router')

    const inWorkspace = { ...REGISTRY_SOURCES, workspacePackages: new Set(['@oa-sdk/router']) }
    for (const oaSdkSources of [REGISTRY_SOURCES, inWorkspace]) {
      const expected = resolveOaSdkPackage('@oa-sdk/router', oaSdkSources).specifier
      for (const target of [fastify, generic]) {
        const { devDependencies } = composeInitDependencies(target, mvp, { ...options(target), oaSdkSources })
        expect(devDependencies['@oa-sdk/router'], target.id).toBe(expected)
      }
    }
  })
})

describe('oa-gen init, then oa-gen generate, in a published install', () => {
  let projectDir: string
  let errors: string[]
  let warnings: string[]

  /**
   * A consumer project with @oa-sdk/codegen installed. The scaffolded
   * oa.config.ts imports `defineConfig` from it, so the installed package
   * provides that helper, which returns the configuration unchanged (checked
   * against the real one below); the test does not depend on a codegen build.
   */
  const createConsumerProject = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-init-companions-'))
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }, null, 2))
    fs.writeFileSync(path.join(dir, 'openapi.json'), JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Orders API', version: '1.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            responses: {
              '200': {
                description: 'Orders',
                content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } } } },
              },
            },
          },
        },
      },
      components: {
        schemas: { Order: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      },
    }, null, 2))
    const codegenDir = path.join(dir, 'node_modules', '@oa-sdk', 'codegen')
    fs.mkdirSync(codegenDir, { recursive: true })
    fs.writeFileSync(path.join(codegenDir, 'package.json'), JSON.stringify({
      name: '@oa-sdk/codegen', type: 'module', exports: { '.': './index.js' },
    }))
    fs.writeFileSync(path.join(codegenDir, 'index.js'), 'export const defineConfig = (config) => config\n')
    return dir
  }

  const runGenerate = (importCompanion: CompanionImporter) => {
    const context: CompanionCommandContext = { cwd: projectDir, projectRoot: projectDir, importCompanion }
    return generate.run({}, context)
  }

  const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(projectDir, file), 'utf8')) as T

  beforeEach(() => {
    projectDir = createConsumerProject()
    errors = []
    warnings = []
    const capture = (sink: string[]) => (...parts: unknown[]) => { sink.push(parts.map(String).join(' ')) }
    vi.spyOn(console, 'error').mockImplementation(capture(errors))
    vi.spyOn(console, 'warn').mockImplementation(capture(warnings))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('stands in for the published defineConfig, which returns the configuration unchanged', () => {
    const config: OaConfig = { specs: [] }
    expect(defineConfig(config)).toBe(config)
  })

  for (const target of ['generic', 'fastify', 'elysia']) {
    for (const archetype of ['mvp', 'microservice', 'enterprise']) {
      it(`${target} x ${archetype}: generate names only listed packages, then succeeds once they are installed`, async () => {
        await runInit({ cwd: projectDir, yes: true, target, archetype, spec: 'openapi.json' })
        const manifest = readJson<{
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
          scripts?: Record<string, string>
        }>('package.json')
        const listed = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])
        const unlisted: CompanionPackageName[] = COMPANION_PACKAGES.filter(name => !listed.has(name))

        // Before the listed packages are installed, generate stops with packages init already listed.
        const failure = await runGenerate(importerWithout(...COMPANION_PACKAGES)).then(() => undefined, (error: unknown) => error)
        expect(failure).toBeInstanceOf(CliExitError)
        const message = errors.join('\n')
        const named = COMPANION_PACKAGES.filter(name => message.includes(`requires ${name}`))
        expect(named.sort()).toEqual(['@oa-sdk/client', '@oa-sdk/router'])
        for (const name of named) expect(listed.has(name), `${name} is listed in package.json`).toBe(true)
        expect(fs.existsSync(path.join(projectDir, '.oa-manifest.json'))).toBe(false)

        // Once they are installed, every output the scaffold requests is generated.
        errors.length = 0
        warnings.length = 0
        await runGenerate(importerWithout(...unlisted))
        expect(errors).toEqual([])
        expect(warnings.join('\n')).not.toContain('Skipped outputs')
        const kinds = readJson<{ artifacts: Array<{ kind: string }> }>('.oa-manifest.json').artifacts.map(artifact => artifact.kind)
        expect(kinds).toEqual(expect.arrayContaining(['schemas', 'contract', 'client', 'queries']))

        // Every companion-backed command in the scaffolded scripts can run too.
        for (const commandLine of Object.values(manifest.scripts ?? {})) {
          for (const command of oaGenCommandsIn(commandLine)) {
            const packageName = commandCompanion(command)
            if (packageName !== undefined) expect(listed.has(packageName), `${commandLine} needs ${packageName}`).toBe(true)
          }
        }
      })
    }
  }
})
