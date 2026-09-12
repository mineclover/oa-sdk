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
    expect(fs.existsSync(path.join(optionsDir, 'keys.ts'))).toBe(false)
    expect(fs.existsSync(path.join(optionsDir, 'hooks.ts'))).toBe(false)
  })

  it('supports --framework vue and svelte target packages', async () => {
    const vueFile = path.join(tmpDir, 'vue-queries.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: vueFile, framework: 'vue', tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    const vueContent = fs.readFileSync(vueFile, 'utf8')
    expect(vueContent).toContain("from '@tanstack/vue-query'")

    const svelteFile = path.join(tmpDir, 'svelte-queries.ts')
    await generateTanstackCommand.run(
      { spec: sampleSpecPath, output: svelteFile, framework: 'svelte', tier: 'options' },
      { projectRoot: tmpDir, cwd: tmpDir },
    )
    const svelteContent = fs.readFileSync(svelteFile, 'utf8')
    expect(svelteContent).toContain("from '@tanstack/svelte-query'")
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
            queries: 'src/features/users/queries.ts',
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
    const dispatchedQueries = path.join(tmpDir, 'src/features/users/queries.ts')

    expect(fs.existsSync(dispatchedKeys)).toBe(true)
    expect(fs.existsSync(dispatchedQueries)).toBe(true)

    const queriesContent = fs.readFileSync(dispatchedQueries, 'utf8')
    // Dynamic relative import recalculated between separate folders
    expect(queriesContent).toContain('../../api/keys.js')
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
