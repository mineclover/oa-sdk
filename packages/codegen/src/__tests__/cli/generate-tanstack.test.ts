import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { generateTanstackCommand } from '../../cli/commands/generate-tanstack.js'
import { generate } from '../../cli/commands/generate.js'
import { CliExitError } from '../../cli/lib/errors.js'

describe('CLI: oa-gen generate:tanstack', () => {
  let tmpDir: string
  let sampleSpecPath: string

  const sampleSpecYaml = `
openapi: 3.2.0
info:
  title: Test User & Pet API
  version: 1.0.0
paths:
  /users:
    get:
      tags:
        - users
      operationId: listUsers
      summary: List all users
      parameters:
        - name: role
          in: query
          schema:
            type: string
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: List of users
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  properties:
                    id:
                      type: string
                    name:
                      type: string
    post:
      tags:
        - users
      operationId: createUser
      summary: Create user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
      responses:
        '201':
          description: Created user
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
  /users/{id}:
    get:
      tags:
        - users
      operationId: getUser
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User detail
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
                  name:
                    type: string
`

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-tanstack-cli-test-'))
    sampleSpecPath = path.join(tmpDir, 'spec.yaml')
    fs.writeFileSync(sampleSpecPath, sampleSpecYaml, 'utf8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('declares valid command metadata and required options matching governance spec', () => {
    expect(generateTanstackCommand.name).toBe('generate:tanstack')
    expect(generateTanstackCommand.options['spec']?.required).toBe(true)
    expect(generateTanstackCommand.options['spec']?.type).toBe('string')
    expect(generateTanstackCommand.options['spec']?.short).toBe('s')
    expect(generateTanstackCommand.options['output']?.type).toBe('string')
    expect(generateTanstackCommand.options['output']?.short).toBe('o')
    expect(generateTanstackCommand.options['config']?.type).toBe('string')
    expect(generateTanstackCommand.options['tier']?.type).toBe('string')
    expect(generateTanstackCommand.options['framework']?.type).toBe('string')
    expect(generateTanstackCommand.options['types-import']?.type).toBe('string')
    expect(generateTanstackCommand.options['client-import']?.type).toBe('string')
    expect(generateTanstackCommand.options['split']?.type).toBe('boolean')
  })

  it('fails fast with CliExitError when --spec is missing', async () => {
    await expect(generateTanstackCommand.run({})).rejects.toThrow(CliExitError)
  })

  it('fails fast with CliExitError when spec file does not exist', async () => {
    await expect(
      generateTanstackCommand.run({ spec: path.join(tmpDir, 'non-existent.yaml') }),
    ).rejects.toThrow(CliExitError)
  })

  it('generates combined 3-tier TanStack Query file by default', async () => {
    const outFile = path.join(tmpDir, 'tanstack.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: outFile },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    expect(fs.existsSync(outFile)).toBe(true)
    const content = fs.readFileSync(outFile, 'utf8')

    // Banner & use client
    expect(content).toContain('// Auto-generated TanStack Query v5 3-Tier Client')
    expect(content).toContain("'use client'")

    // Tier 1: Keys
    expect(content).toContain('export const usersKeys = {')
    expect(content).toContain('export const userKeys = usersKeys')

    // Tier 2: Pure Options
    expect(content).toContain('export function listUsersQueryOptions')
    expect(content).toContain('export function getUserQueryOptions')
    expect(content).toContain('export function createUserMutationOptions')

    // Tier 3: React Composition Hooks
    expect(content).toContain('export function useListUsersQuery')
    expect(content).toContain('export function useGetUserQuery')
    expect(content).toContain('export function useCreateUserMutation')

    // Wire-safety types
    expect(content).toContain('JsonPrimitive')
    expect(content).toContain('Resolved')
  })

  it('generates split files when --split flag is provided', async () => {
    const outDir = path.join(tmpDir, 'split-out')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: outDir, split: true },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    const keysFile = path.join(outDir, 'keys.ts')
    const queriesFile = path.join(outDir, 'queries.ts')
    const hooksFile = path.join(outDir, 'hooks.ts')

    expect(fs.existsSync(keysFile)).toBe(true)
    expect(fs.existsSync(queriesFile)).toBe(true)
    expect(fs.existsSync(hooksFile)).toBe(true)

    const keysContent = fs.readFileSync(keysFile, 'utf8')
    expect(keysContent).toContain('export const usersKeys = {')

    const queriesContent = fs.readFileSync(queriesFile, 'utf8')
    expect(queriesContent).toContain("from './keys.js'")
    expect(queriesContent).toContain('export function listUsersQueryOptions')

    const hooksContent = fs.readFileSync(hooksFile, 'utf8')
    expect(hooksContent).toContain("from './queries.js'")
    expect(hooksContent).toContain("from './keys.js'")
    expect(hooksContent).toContain('export function useListUsersQuery')
  })

  it('honors --tier filter in split mode', async () => {
    const keysDir = path.join(tmpDir, 'keys-only')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: keysDir, split: true, tier: 'keys' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    expect(fs.existsSync(path.join(keysDir, 'keys.ts'))).toBe(true)
    expect(fs.existsSync(path.join(keysDir, 'queries.ts'))).toBe(false)
    expect(fs.existsSync(path.join(keysDir, 'hooks.ts'))).toBe(false)

    const optionsDir = path.join(tmpDir, 'options-only')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: optionsDir, split: true, tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    expect(fs.existsSync(path.join(optionsDir, 'queries.ts'))).toBe(true)
    // Tier 2 imports the key factory, so keys.ts is emitted as a dependency.
    expect(fs.existsSync(path.join(optionsDir, 'keys.ts'))).toBe(true)
    expect(fs.existsSync(path.join(optionsDir, 'hooks.ts'))).toBe(false)
  })

  it('keeps a combined --tier options/hooks file self-contained (no split-module imports)', async () => {
    for (const tier of ['options', 'hooks'] as const) {
      const file = path.join(tmpDir, `combined-${tier}.ts`)
      await generateTanstackCommand.run(
        { spec: sampleSpecPath, output: file, tier },
        { projectRoot: tmpDir, cwd: tmpDir },
      )
      const content = fs.readFileSync(file, 'utf8')
      // A combined file has no sibling keys/queries modules to import from.
      expect(content).not.toMatch(/from '\.\/(?:keys|queries)(?:\.js)?'/)
      expect(content).toContain('listUsersQueryOptions')
      // The key factory the options use is defined in the same file.
      expect(content).toContain('export const usersKeys')
      if (tier === 'hooks') expect(content).toContain('useListUsers')
      else expect(content).not.toContain('useListUsers')
    }
  })

  it('supports --framework vue and svelte target packages', async () => {
    const vueFile = path.join(tmpDir, 'vue-queries.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: vueFile, framework: 'vue', tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    const vueContent = fs.readFileSync(vueFile, 'utf8')
    expect(vueContent).toContain("from '@tanstack/vue-query'")
    // Tier 2 is framework-neutral: only query-core observer types, never React-only names.
    expect(vueContent).toContain('QueryObserverOptions')
    expect(vueContent).not.toContain('UndefinedInitialDataOptions')
    expect(vueContent).not.toContain('UseMutationOptions')

    const svelteFile = path.join(tmpDir, 'svelte-queries.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: svelteFile, framework: 'svelte', tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    const svelteContent = fs.readFileSync(svelteFile, 'utf8')
    expect(svelteContent).toContain("from '@tanstack/svelte-query'")
    expect(svelteContent).toContain('MutationObserverOptions')
    expect(svelteContent).not.toContain('UseMutationOptions')
  })

  it('rejects --tier hooks for Vue/Svelte instead of writing React hooks', async () => {
    await expect(
      generateTanstackCommand.run(
        { spec: sampleSpecPath, output: path.join(tmpDir, 'vue-hooks.ts'), framework: 'vue', tier: 'hooks' },
        { projectRoot: tmpDir, cwd: tmpDir },
      ),
    ).rejects.toBeInstanceOf(CliExitError)

    expect(fs.existsSync(path.join(tmpDir, 'vue-hooks.ts'))).toBe(false)
  })

  it('emits lower tiers as dependencies in --split mode', async () => {
    const outDir = path.join(tmpDir, 'split-options')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: outDir, split: true, tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    // queries.ts imports ./keys.js, so keys.ts must be emitted even for --tier options.
    expect(fs.existsSync(path.join(outDir, 'keys.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'queries.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'hooks.ts'))).toBe(false)
    expect(fs.readFileSync(path.join(outDir, 'queries.ts'), 'utf8')).toContain("from './keys.js'")

    const hooksDir = path.join(tmpDir, 'split-hooks')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: hooksDir, split: true, tier: 'hooks' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    // hooks.ts imports both ./keys.js and ./queries.js.
    expect(fs.existsSync(path.join(hooksDir, 'keys.ts'))).toBe(true)
    expect(fs.existsSync(path.join(hooksDir, 'queries.ts'))).toBe(true)
    expect(fs.existsSync(path.join(hooksDir, 'hooks.ts'))).toBe(true)
  })

  it('keeps every relative import resolvable with pattern-based outputRouting and --split', async () => {
    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        product: {
          outputRouting: {
            pattern: 'src/api/{kind}/index.ts',
          },
        },
      }),
      'utf8',
    )

    await generateTanstackCommand.run(
      { spec: sampleSpecPath, config: configPath, split: true },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    const generated = [
      path.join(tmpDir, 'src/api/keys/index.ts'),
      path.join(tmpDir, 'src/api/queries/index.ts'),
      path.join(tmpDir, 'src/api/queries/hooks.ts'),
    ]
    for (const file of generated) expect(fs.existsSync(file)).toBe(true)

    // The generated client types are normally emitted by pluginClient / a hand-written module.
    fs.writeFileSync(
      path.join(tmpDir, 'src/api/queries/client.ts'),
      'export interface ApiClient {}\n',
      'utf8',
    )

    // `{kind}` routing puts keys and queries in sibling directories; every relative import
    // must resolve (the TS2307 failure mode) instead of assuming a flat output directory.
    for (const file of generated) {
      const content = fs.readFileSync(file, 'utf8')
      for (const match of content.matchAll(/from '(\.[^']+)'/g)) {
        const specifier = match[1]!
        const target = path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
        const indexTarget = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ''), 'index.ts')
        expect(fs.existsSync(target) || fs.existsSync(indexTarget), `${file} → ${specifier}`).toBe(true)
      }
    }
  })

  it('honors --types-import and --client-import specifiers', async () => {
    const customOut = path.join(tmpDir, 'custom-imports.ts')
    await generateTanstackCommand.run(
      {
        spec: sampleSpecPath,
        output: customOut,
        'types-import': '@my-app/types',
        'client-import': '@my-app/api-client',
      },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    const content = fs.readFileSync(customOut, 'utf8')
    expect(content).toContain("from '@my-app/types'")
    expect(content).toContain("from '@my-app/api-client'")
  })

  it('integrates with outputRouting configuration in oa.config.ts', async () => {
    const configPath = path.join(tmpDir, 'oa.config.json')
    const configData = {
      product: {
        outputRouting: {
          byKind: {
            keys: 'src/api/keys.ts',
            queries: 'src/features/users/users.queries.ts',
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf8')

    await generateTanstackCommand.run(
      { spec: sampleSpecPath, config: configPath, split: true },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    const dispatchedKeys = path.join(tmpDir, 'src/api/keys.ts')
    const dispatchedQueries = path.join(tmpDir, 'src/features/users/users.queries.ts')
    const dispatchedHooks = path.join(tmpDir, 'src/features/users/hooks.ts')

    expect(fs.existsSync(dispatchedKeys)).toBe(true)
    expect(fs.existsSync(dispatchedQueries)).toBe(true)
    expect(fs.existsSync(dispatchedHooks)).toBe(true)

    const queriesContent = fs.readFileSync(dispatchedQueries, 'utf8')
    // Dynamic relative import recalculated between separate folders
    expect(queriesContent).toContain('../../api/keys.js')

    const hooksContent = fs.readFileSync(dispatchedHooks, 'utf8')
    expect(hooksContent).toContain("from './users.queries.js'")
  })

  it('respects explicit --output directory in --split mode even when outputRouting is configured', async () => {
    const configPath = path.join(tmpDir, 'oa.config.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        product: {
          outputRouting: {
            byKind: {
              keys: 'src/api/keys.ts',
              queries: 'src/features/users/queries.ts',
            },
          },
        },
      }),
      'utf8',
    )

    const explicitOutDir = path.join(tmpDir, 'explicit-split-out')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, config: configPath, output: explicitOutDir, split: true },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    expect(fs.existsSync(path.join(explicitOutDir, 'keys.ts'))).toBe(true)
    expect(fs.existsSync(path.join(explicitOutDir, 'queries.ts'))).toBe(true)
    expect(fs.existsSync(path.join(explicitOutDir, 'hooks.ts'))).toBe(true)
  })

  it('delegates seamlessly from oa-gen generate --tanstack', async () => {
    const outFile = path.join(tmpDir, 'from-generate.ts')
    await generate.run(
      { tanstack: true, spec: sampleSpecPath, output: outFile },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    expect(fs.existsSync(outFile)).toBe(true)
    const content = fs.readFileSync(outFile, 'utf8')
    expect(content).toContain('usersKeys')
    expect(content).toContain('listUsersQueryOptions')
  })

  it('tracks emitted artifacts in .oa-manifest.json', async () => {
    const outFile = path.join(tmpDir, 'manifest-test.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: outFile },
      { projectRoot: tmpDir, cwd: tmpDir },
    )

    const manifestPath = path.join(tmpDir, '.oa-manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    expect(manifest.version).toBe(1)
    expect(manifest.artifacts.some((a: any) => a.path.includes('manifest-test.ts'))).toBe(true)
  })
})
