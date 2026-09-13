/**
 * Automated Empirical Verification Test Suite for Documented CLI Commands & Recipes
 *
 * Grounded in:
 * - docs/guides/quick-start.md
 * - docs/guides/onboarding-playbook.md
 * - docs/guides/declarative-spec-configuration.md
 * - docs/guides/cli-command-reference.md
 *
 * Verifies:
 * - Suite 1: Help Flag Matrix Coverage (all 11 CLI targets)
 * - Suite 2: Quick Start CLI Pipeline Execution in isolated temp directory
 * - Suite 3: Onboarding Framework Targets & Runtime Isolation
 * - Suite 4: Lifecycle Archetype Presets & Safety Gates
 * - Suite 5: Configuration Recipe Schema & Type Validation
 * - Suite 6: TanStack Query & Handler Contract End-to-End Type Safety
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { generateRouter, generateHandlerContract } from '@oa-sdk/router'
import type { OasDocument } from '@oa-sdk/parser'
import {
  defineConfig,
  validateOaConfig,
  createPathDispatcher,
} from '@oa-sdk/codegen'

// ── Environment & Binary Discovery ──────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../..')
const distCliBin = resolve(repoRoot, 'packages/codegen/dist/cli/index.js')
const srcCliBin = resolve(repoRoot, 'packages/codegen/src/cli/index.ts')

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

// Resolve Zod .d.ts path from @oa-sdk/codegen dependency tree for hermetic compilation
const codegenPkgPath = resolve(repoRoot, 'packages/codegen/package.json')
const codegenRequire = createRequire(codegenPkgPath)
const zodPkgDir = dirname(codegenRequire.resolve('zod/package.json'))
const zodDtsPath = resolve(zodPkgDir, 'index.d.ts')

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Executes the oa-gen CLI binary synchronously with captured output and exit code.
 */
export function runCli(args: string[], cwd: string = repoRoot): CliResult {
  const isDist = existsSync(distCliBin)
  const execArgs = isDist ? [distCliBin, ...args] : ['--import', 'tsx', srcCliBin, ...args]

  try {
    const stdout = execFileSync(process.execPath, execArgs, {
      cwd,
      timeout: 30_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? error.message ?? '',
      exitCode: error.status ?? error.exitCode ?? 1,
    }
  }
}

/**
 * Executes tsc --noEmit in the designated working directory.
 * Throws a formatted Error with compiler diagnostics if typechecking fails.
 */
export function runTsc(cwd: string): void {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error: any) {
    const stdoutStr = error.stdout?.toString('utf8') ?? ''
    const stderrStr = error.stderr?.toString('utf8') ?? ''
    const diagnostics = [stdoutStr.trim(), stderrStr.trim()].filter(Boolean).join('\n')
    throw new Error(`tsc --noEmit failed in ${cwd}:\n${diagnostics || error.message}`)
  }
}

// ── Fixture OpenAPI 3.2 Specification for Pipeline & Targets ───────────────

const QUICK_START_OPENAPI_32 = `openapi: 3.2.0
info:
  title: Quick Start API
  version: 1.0.0
  description: Empirical verification specification matching quick-start.md
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      responses:
        '200':
          description: A list of users
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ListUsersResponse'
components:
  schemas:
    User:
      type: object
      required:
        - id
        - email
        - name
        - role
        - createdAt
      properties:
        id:
          type: string
        email:
          type: string
          format: email
        name:
          type: string
        role:
          type: string
          enum:
            - admin
            - user
            - guest
        createdAt:
          type: string
          format: date-time
    ListUsersResponse:
      type: object
      required:
        - items
        - total
      properties:
        items:
          type: array
          items:
            $ref: '#/components/schemas/User'
        total:
          type: integer
`

const sampleOas32Spec: OasDocument = {
  openapi: '3.2.0',
  info: { title: 'Empirical Verification API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        summary: 'List users with pagination',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20 },
          },
        ],
        responses: {
          '200': {
            description: 'User list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'User created',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUserById',
        summary: 'Get user by ID',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'User details',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    '/search': {
      query: {
        operationId: 'searchCatalog',
        summary: 'OAS 3.2 QUERY method search',
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
}

// ── Suite 1: Help Flag Matrix Coverage ─────────────────────────────────────

describe('Suite 1: Help Flag Matrix Coverage', () => {
  const helpTargets: Array<{ name: string; args: string[]; expectedSnippet: string }> = [
    { name: 'root (oa-gen --help)', args: ['--help'], expectedSnippet: 'oa-gen' },
    { name: 'init', args: ['init', '--help'], expectedSnippet: 'oa-gen init' },
    { name: 'validate', args: ['validate', '--help'], expectedSnippet: 'oa-gen validate' },
    { name: 'typegen', args: ['typegen', '--help'], expectedSnippet: 'oa-gen typegen' },
    { name: 'generate:zod', args: ['generate:zod', '--help'], expectedSnippet: 'oa-gen generate:zod' },
    { name: 'audit:shape', args: ['audit:shape', '--help'], expectedSnippet: 'oa-gen audit:shape' },
    { name: 'mock', args: ['mock', '--help'], expectedSnippet: 'oa-gen mock' },
    { name: 'diff', args: ['diff', '--help'], expectedSnippet: 'oa-gen diff' },
    { name: 'tsp diff', args: ['tsp', 'diff', '--help'], expectedSnippet: 'oa-gen tsp diff' },
    { name: 'generate', args: ['generate', '--help'], expectedSnippet: 'oa-gen generate' },
    { name: 'generate:tanstack', args: ['generate:tanstack', '--help'], expectedSnippet: 'oa-gen generate:tanstack' },
  ]

  it.each(helpTargets)('displays help and exits with 0 for "$name"', ({ args, expectedSnippet }) => {
    const res = runCli(args)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain(expectedSnippet)
    expect(res.stdout.trim().length).toBeGreaterThan(0)
  })

  it('supports short -h flag for root and subcommands', () => {
    const rootRes = runCli(['-h'])
    expect(rootRes.exitCode).toBe(0)
    expect(rootRes.stdout).toContain('oa-gen')

    const initRes = runCli(['init', '-h'])
    expect(initRes.exitCode).toBe(0)
    expect(initRes.stdout).toContain('oa-gen init')
  })

  it('rejects unknown commands with exit code 1', () => {
    const res = runCli(['non-existent-subcommand', '--help'])
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('알 수 없는 커맨드')
  })
})

// ── Suite 2: Quick Start CLI Pipeline Execution ────────────────────────────

describe('Suite 2: Quick Start CLI Pipeline Execution', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oa-quick-start-pipeline-'))
  })

  afterAll(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('executes full Quick Start pipeline from init to tsc --noEmit', () => {
    // 0. Seed basic openapi.yaml
    const specPath = join(tmpDir, 'openapi.yaml')
    writeFileSync(specPath, QUICK_START_OPENAPI_32, 'utf8')

    // Step 1: oa-gen init --yes
    const initRes = runCli(['init', '--yes'], tmpDir)
    expect(initRes.exitCode).toBe(0)
    expect(initRes.stdout).toContain('Target framework selected')
    expect(existsSync(join(tmpDir, 'oa.config.ts'))).toBe(true)

    // Step 2: oa-gen validate --spec ./openapi.yaml --require-32
    const validateRes = runCli(['validate', '--spec', './openapi.yaml', '--require-32'], tmpDir)
    expect(validateRes.exitCode).toBe(0)
    expect(validateRes.stdout).toContain('Valid')

    // Step 3: oa-gen typegen --spec ./openapi.yaml -o types.ts
    const typegenRes = runCli(['typegen', '--spec', './openapi.yaml', '-o', 'types.ts'], tmpDir)
    expect(typegenRes.exitCode).toBe(0)
    const typesFile = join(tmpDir, 'types.ts')
    expect(existsSync(typesFile)).toBe(true)
    const typesContent = readFileSync(typesFile, 'utf8')
    expect(typesContent).toContain('export type User = {')

    // Step 4: oa-gen generate:zod --spec ./openapi.yaml -o schemas.ts
    const zodRes = runCli(['generate:zod', '--spec', './openapi.yaml', '-o', 'schemas.ts'], tmpDir)
    expect(zodRes.exitCode).toBe(0)
    const schemasFile = join(tmpDir, 'schemas.ts')
    expect(existsSync(schemasFile)).toBe(true)
    const schemasContent = readFileSync(schemasFile, 'utf8')
    expect(schemasContent).toContain('export const UserSchema = z.object(')

    // Step 5: oa-gen audit:shape --source ./types.ts
    const auditRes = runCli(['audit:shape', '--source', './types.ts'], tmpDir)
    expect(auditRes.exitCode).toBe(0)
    expect(auditRes.stdout).toContain('0 shape issues found')

    // Step 6: Compile generated files with tsc --noEmit
    const tsconfigPath = join(tmpDir, 'tsconfig.json')
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            module: 'ESNext',
            moduleResolution: 'bundler',
            target: 'ES2022',
            skipLibCheck: true,
            paths: {
              zod: [zodDtsPath],
            },
          },
          include: ['types.ts', 'schemas.ts'],
        },
        null,
        2,
      ),
      'utf8',
    )

    expect(() => runTsc(tmpDir)).not.toThrow()
  })

  it('fails validate when --require-32 is passed against OpenAPI 3.1.0 spec', () => {
    const invalid31Dir = mkdtempSync(join(tmpdir(), 'oa-invalid-31-'))
    try {
      const specPath = join(invalid31Dir, 'openapi.yaml')
      writeFileSync(specPath, 'openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n', 'utf8')

      const res = runCli(['validate', '--spec', './openapi.yaml', '--require-32'], invalid31Dir)
      expect(res.exitCode).toBe(1)
      expect(res.stdout).toContain('oa-sdk managed contracts require OpenAPI 3.2.x')
    } finally {
      rmSync(invalid31Dir, { recursive: true, force: true })
    }
  })

  it('fails audit:shape when source contains unsupported shapes (mapped types)', () => {
    const badShapeDir = mkdtempSync(join(tmpdir(), 'oa-bad-shape-'))
    try {
      const badFile = join(badShapeDir, 'bad.ts')
      writeFileSync(badFile, 'export type UnsupportedMap = { [K in string]: number };\n', 'utf8')

      const res = runCli(['audit:shape', '--source', './bad.ts'], badShapeDir)
      expect(res.exitCode).toBe(1)
      expect(res.stdout).toContain('unsupported shape')
    } finally {
      rmSync(badShapeDir, { recursive: true, force: true })
    }
  })

  it('fails typegen and generate:zod when required --spec is missing', () => {
    const typegenRes = runCli(['typegen'])
    expect(typegenRes.exitCode).toBe(1)
    expect(typegenRes.stderr).toContain('--spec 옵션이 필요합니다')

    const zodRes = runCli(['generate:zod'])
    expect(zodRes.exitCode).toBe(1)
    expect(zodRes.stderr).toContain('--spec 옵션이 필요합니다')
  })
})

// ── Suite 3: Onboarding Framework Targets & Runtime Isolation ──────────────

describe('Suite 3: Onboarding Framework Targets & Runtime Isolation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oa-suite3-'))
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('Suite 3.1: Fastify Target — configures Fastify JIT schema acceleration, tsx scripts, and FastifyPluginAsync stub', () => {
    const fixtureDir = join(tmpDir, 'fastify-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-fastify-app', dependencies: { fastify: '^4.26.0' } }, null, 2),
      'utf8',
    )
    writeFileSync(
      join(fixtureDir, 'openapi.yaml'),
      'openapi: 3.2.0\ninfo:\n  title: Fastify API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )

    const res = runCli(['init', '--target', 'fastify', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Target framework selected: fastify (runtime: node)')

    // 1. Verify oa.config.ts content
    const configPath = join(fixtureDir, 'oa.config.ts')
    expect(existsSync(configPath)).toBe(true)
    const configContent = readFileSync(configPath, 'utf8')
    expect(configContent).toContain("target: 'fastify'")
    expect(configContent).toContain("framework: 'fastify'")
    expect(configContent).toContain('jitSchema: true')
    expect(configContent).toContain("runtime: 'node'")

    // 2. Verify package.json scripts & dependencies
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['dev']).toBe('tsx watch src/server.ts')
    expect(pkg.scripts['generate:router']).toBe('oa-gen generate --target fastify')
    expect(pkg.scripts['mock']).toBe('oa-gen mock --watch')
    expect(pkg.devDependencies['tsx']).toBeDefined()
    expect(pkg.devDependencies['@types/node']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/codegen']).toBe('workspace:*')
    expect(pkg.devDependencies['@oa-sdk/router']).toBe('workspace:*')

    // 3. Verify Fastify router binder generation with FastifyPluginAsync and JIT schema inlining
    const fastifyCode = generateRouter(sampleOas32Spec, { target: 'fastify' })
    expect(fastifyCode).toContain("import type { FastifyPluginAsync } from 'fastify'")
    expect(fastifyCode).toContain('export const apiRouter: FastifyPluginAsync')
    expect(fastifyCode).toContain("fastify.get('/users/:id'")
    expect(fastifyCode).toContain('"params": {')
    expect(fastifyCode).toContain('"querystring": {')
    expect(fastifyCode).toContain('"response": {')
    expect(fastifyCode).toContain('export default apiRouter')
  })

  it('Suite 3.2: Elysia Target — configures Bun native isolation (zero tsx), new Elysia() binder, and handler contracts', () => {
    const fixtureDir = join(tmpDir, 'elysia-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-elysia-app', dependencies: { elysia: '^1.0.0' } }, null, 2),
      'utf8',
    )
    writeFileSync(join(fixtureDir, 'bun.lockb'), '', 'utf8')
    writeFileSync(
      join(fixtureDir, 'openapi.yaml'),
      'openapi: 3.2.0\ninfo:\n  title: Elysia API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )

    const res = runCli(['init', '--target', 'elysia', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Target framework selected: elysia (runtime: bun)')

    // 1. Verify oa.config.ts content
    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("target: 'elysia'")
    expect(configContent).toContain("framework: 'elysia'")
    expect(configContent).toContain('zeroCopy: true')
    expect(configContent).toContain("runtime: 'bun'")

    // 2. Verify Bun native scripts & strict runtime isolation (ZERO tsx / Node tools)
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['dev']).toBe('bun --watch src/index.ts')
    expect(pkg.scripts['generate:router']).toBe('bun x oa-gen generate --target elysia')
    expect(pkg.scripts['mock']).toBe('bun x oa-gen mock --watch')
    expect(pkg.devDependencies['tsx']).toBeUndefined()
    expect(pkg.devDependencies['nodemon']).toBeUndefined()
    expect(pkg.devDependencies['@types/node']).toBeUndefined()
    expect(pkg.devDependencies['vitest']).toBeUndefined()
    expect(pkg.devDependencies['@types/bun']).toBe('latest')

    // 3. Verify Elysia router binder generation with new Elysia() & zero-copy destructuring
    const elysiaCode = generateRouter(sampleOas32Spec, { target: 'elysia' })
    expect(elysiaCode).toContain("import { Elysia } from 'elysia'")
    expect(elysiaCode).toContain('export const app = new Elysia()')
    expect(elysiaCode).toContain(".get('/users/:id', async ({ params, set })")
    expect(elysiaCode).toContain('export default app')

    // 4. Verify pure handler contract generation
    const contractCode = generateHandlerContract(sampleOas32Spec)
    expect(contractCode).toContain('export interface ApiHandlers<TContext = unknown>')
    expect(contractCode).toContain('export type HandlerResponse')
    expect(contractCode).toContain('export interface GetUserByIdContext<TContext = unknown>')
    expect(contractCode).not.toContain("from 'elysia'")
    expect(contractCode).not.toContain("from 'fastify'")
  })

  it('Suite 3.3: Express Target — configures Express router registration and OAS 3.2 method guards', () => {
    const fixtureDir = join(tmpDir, 'express-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-express-app', dependencies: { express: '^4.19.0' } }, null, 2),
      'utf8',
    )
    writeFileSync(
      join(fixtureDir, 'openapi.yaml'),
      'openapi: 3.2.0\ninfo:\n  title: Express API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )

    const res = runCli(['init', '--target', 'express', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Target framework selected: express (runtime: node)')

    // 1. Verify oa.config.ts content
    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("target: 'express'")
    expect(configContent).toContain("framework: 'express'")
    expect(configContent).toContain("runtime: 'node'")

    // 2. Verify package.json scripts
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['dev']).toBe('tsx watch src/app.ts')
    expect(pkg.scripts['generate:router']).toBe('oa-gen generate --target express')
    expect(pkg.scripts['mock']).toBe('oa-gen mock --watch')
    expect(pkg.devDependencies['@types/express']).toBeDefined()
    expect(pkg.devDependencies['tsx']).toBeDefined()

    // 3. Verify Express router generation and OAS 3.2 method guards
    const expressCode = generateRouter(sampleOas32Spec, { target: 'express' })
    expect(expressCode).toContain("import { Router } from 'express'")
    expect(expressCode).toContain('const router = Router()')
    expect(expressCode).toContain("router.get('/users', async (req, res)")
    expect(expressCode).toContain("router.all('/search', async (req, res, next)")
    expect(expressCode).toContain("if (req.method !== 'QUERY') return next()")
    expect(expressCode).toContain('export default router')
  })

  it('Suite 3.4: NestJS Target — configures generic fallback and preserves existing build/start scripts', () => {
    const fixtureDir = join(tmpDir, 'nestjs-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify(
        {
          name: 'my-nest-app',
          scripts: {
            'start:dev': 'nest start --watch',
            'build': 'nest build',
            'test': 'jest',
          },
          dependencies: {
            '@nestjs/core': '^10.0.0',
            '@nestjs/common': '^10.0.0',
          },
        },
        null,
        2,
      ),
      'utf8',
    )
    writeFileSync(
      join(fixtureDir, 'openapi.yaml'),
      'openapi: 3.2.0\ninfo:\n  title: NestJS API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )

    const res = runCli(['init', '--target', 'nestjs', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Target framework selected: nestjs (runtime: node)')

    // 1. Verify oa.config.ts content
    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("framework: 'nestjs'")

    // 2. Verify non-destructive script preservation
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['start:dev']).toBe('nest start --watch')
    expect(pkg.scripts['build']).toBe('nest build')
    expect(pkg.scripts['test']).toBe('jest')
    expect(pkg.scripts['generate:contract']).toBe('oa-gen generate --target generic')
    expect(pkg.scripts['mock']).toBe('oa-gen mock --watch')
    expect(pkg.devDependencies['@oa-sdk/codegen']).toBe('workspace:*')
    expect(pkg.devDependencies['@oa-sdk/router']).toBe('workspace:*')
  })

  it('Suite 3.5: Dry-Run Mode (--dry-run) — performs discovery and previews config with zero disk mutations', () => {
    const fixtureDir = join(tmpDir, 'dry-run-app')
    mkdirSync(fixtureDir, { recursive: true })
    const initialPkg = JSON.stringify({ name: 'dry-app', version: '1.0.0' }, null, 2)
    writeFileSync(join(fixtureDir, 'package.json'), initialPkg, 'utf8')
    writeFileSync(
      join(fixtureDir, 'openapi.yaml'),
      'openapi: 3.2.0\ninfo:\n  title: Dry Run API\n  version: 1.0.0\npaths: {}\n',
      'utf8',
    )

    const res = runCli(['init', '--target', 'fastify', '--dry-run', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('🔍 [dry-run] oa.config.ts would be generated at:')
    expect(res.stdout).toContain('package.json patches')

    // Verify ZERO files written to disk
    expect(existsSync(join(fixtureDir, 'oa.config.ts'))).toBe(false)
    const currentPkg = readFileSync(join(fixtureDir, 'package.json'), 'utf8')
    expect(currentPkg).toBe(initialPkg)
  })

  it('Suite 3.6: Force Mode (--force) — cleanly overwrites existing oa.config.ts while preserving custom scripts', () => {
    const fixtureDir = join(tmpDir, 'force-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify(
        {
          name: 'force-app',
          scripts: { custom: 'node run-custom.js' },
        },
        null,
        2,
      ),
      'utf8',
    )
    const legacyConfig = '// LEGACY CONFIG CONTENT'
    writeFileSync(join(fixtureDir, 'oa.config.ts'), legacyConfig, 'utf8')

    // 1. Without --force: existing config retained
    const resNoForce = runCli(['init', '--target', 'express', '--yes'], fixtureDir)
    expect(resNoForce.exitCode).toBe(0)
    expect(resNoForce.stdout).toContain('Existing config retained:')
    expect(readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')).toBe(legacyConfig)

    // 2. With --force: cleanly overwritten
    const resForce = runCli(['init', '--target', 'express', '--yes', '--force'], fixtureDir)
    expect(resForce.exitCode).toBe(0)
    expect(resForce.stdout).toContain('Generated:')
    const newConfig = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(newConfig).not.toBe(legacyConfig)
    expect(newConfig).toContain("target: 'express'")

    // 3. Custom scripts preserved
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['custom']).toBe('node run-custom.js')
    expect(pkg.scripts['generate:router']).toBe('oa-gen generate --target express')
  })
})

// ── Suite 4: Lifecycle Archetype Presets & Safety Gates ────────────────────

describe('Suite 4: Lifecycle Archetype Presets & Safety Gates', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oa-suite4-'))
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('Suite 4.1: MVP Archetype — configures rapid prototyping with relaxed wire safety and warn linting', () => {
    const fixtureDir = join(tmpDir, 'mvp-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-mvp-app' }, null, 2),
      'utf8',
    )

    const res = runCli(['init', '--target', 'fastify', '--archetype', 'mvp', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Lifecycle archetype preset: mvp')

    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("archetype: 'mvp'")
    expect(configContent).toContain('wireFormatSafety: false')
    expect(configContent).toContain('driftCheck: false')
    expect(configContent).toContain('failOnBreaking: false')
    expect(configContent).toContain("preflightLint: 'warn'")
    expect(configContent).toContain("outDir: './src/client'")

    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['mock']).toBe('oa-gen mock --watch')
    expect(pkg.scripts['generate:client']).toBe('oa-gen generate --target client')
    expect(pkg.scripts['validate']).toBe('oa-gen validate')
    expect(pkg.scripts['test:contract']).toBeUndefined()
  })

  it('Suite 4.2: Microservice Archetype — configures JIT schema acceleration, strict wire typing, and contract tests', () => {
    const fixtureDir = join(tmpDir, 'microservice-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-microservice-app' }, null, 2),
      'utf8',
    )

    const res = runCli(['init', '--target', 'fastify', '--archetype', 'microservice', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Lifecycle archetype preset: microservice')

    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("archetype: 'microservice'")
    expect(configContent).toContain('jitSchema: true')
    expect(configContent).toContain('wireFormatSafety: true')
    expect(configContent).toContain('driftCheck: true')
    expect(configContent).toContain('failOnBreaking: false')
    expect(configContent).toContain("preflightLint: 'error'")
    expect(configContent).toContain("outDir: './src/contracts'")
    expect(configContent).toContain('resolveSymbolCycles: true')

    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:contract']).toBe('vitest run src/__tests__/contracts')
    expect(pkg.scripts['audit:wire']).toBe('oa-gen audit:shape --strict')
    expect(pkg.scripts['generate:contract']).toBe('oa-gen generate --target generic')
    expect(pkg.devDependencies['vitest']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/core']).toBe('workspace:*')
  })

  it('Suite 4.3: Enterprise Archetype — configures strict CI drift defense, breaking diff gates, and persona coverage', () => {
    const fixtureDir = join(tmpDir, 'enterprise-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'my-enterprise-app' }, null, 2),
      'utf8',
    )

    const res = runCli(['init', '--target', 'fastify', '--archetype', 'enterprise', '--yes'], fixtureDir)
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toContain('Lifecycle archetype preset: enterprise')

    const configContent = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(configContent).toContain("archetype: 'enterprise'")
    expect(configContent).toContain('driftCheck: true')
    expect(configContent).toContain('failOnBreaking: true')
    expect(configContent).toContain("baseRef: 'origin/main'")
    expect(configContent).toContain("preflightLint: 'error'")
    expect(configContent).toContain('wireFormatSafety: true')
    expect(configContent).toContain('personas: {')
    expect(configContent).toContain('enforceCoverage: true')
    expect(configContent).toContain('minCoverageRatio: 0.8')

    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['diff']).toBe('oa-gen diff --base origin/main --head HEAD --fail-on-breaking')
    expect(pkg.scripts['ci:gate']).toBe('oa-gen diff --base origin/main --fail-on-breaking && oa-gen validate --require-32')
    expect(pkg.scripts['personas:check']).toBe('oa-gen personas:check')
    expect(pkg.scripts['audit:csp']).toBe('oa-gen audit:csp --bundle ./dist')
    expect(pkg.scripts['audit:shape']).toBe('oa-gen audit:shape --fail-on-unsupported')
    expect(pkg.devDependencies['@oa-sdk/personas']).toBe('workspace:*')
  })

  it('Suite 4.4: Archetype Lifecycle Evolution & Validation Gates — verifies rejection of invalid archetypes and seamless promotion', () => {
    const fixtureDir = join(tmpDir, 'evolution-app')
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(
      join(fixtureDir, 'package.json'),
      JSON.stringify({ name: 'evolving-app' }, null, 2),
      'utf8',
    )

    // 1. Rejection of invalid archetype
    const resInvalid = runCli(['init', '--target', 'fastify', '--archetype', 'invalid-archetype', '--yes'], fixtureDir)
    expect(resInvalid.exitCode).toBe(1)
    expect(resInvalid.stderr).toContain('Invalid archetype: "invalid-archetype"')

    // 2. Day 1: Initialize as MVP
    const resMvp = runCli(['init', '--target', 'fastify', '--archetype', 'mvp', '--yes'], fixtureDir)
    expect(resMvp.exitCode).toBe(0)
    let config = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(config).toContain("archetype: 'mvp'")
    expect(config).toContain('failOnBreaking: false')

    // 3. Day 180: Seamless upgrade to Enterprise with --force
    const resEnterprise = runCli(
      ['init', '--target', 'fastify', '--archetype', 'enterprise', '--yes', '--force'],
      fixtureDir,
    )
    expect(resEnterprise.exitCode).toBe(0)
    config = readFileSync(join(fixtureDir, 'oa.config.ts'), 'utf8')
    expect(config).toContain("archetype: 'enterprise'")
    expect(config).toContain('failOnBreaking: true')
    const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
    expect(pkg.scripts['ci:gate']).toBeDefined()
    expect(pkg.devDependencies['@oa-sdk/personas']).toBe('workspace:*')
  })
})

// ── Suite 5: Configuration Recipe Schema & Type Validation ─────────────────

describe('Suite 5: Configuration Recipe Schema & Type Validation', () => {
  describe('Recipe 1: Feature-Sliced Design (FSD) Output Path Routing (§4.5)', () => {
    const fsdConfig = defineConfig({
      rootDir: '.',
      outputRouting: {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
        rules: [
          {
            tag: ['common', 'shared', 'auth', 'system'],
            target: 'src/shared/api/{tag}.{kind}.ts',
          },
          {
            kind: 'schemas',
            target: 'src/shared/api/schemas.ts',
          },
        ],
        byKind: {
          client: 'src/shared/api/client.ts',
        },
      },
    })

    it('validates strictly against validateOaConfig with 0 errors', () => {
      const result = validateOaConfig(fsdConfig)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('routes standard domain artifacts into feature slice directories via pattern', () => {
      const dispatcher = createPathDispatcher(fsdConfig.outputRouting)

      const contract = dispatcher.dispatch({ tag: 'users', kind: 'contract' })
      expect(contract.relativePath).toBe('src/features/users/api/users.contract.ts')
      expect(contract.matchedBy).toBe('pattern')

      const queries = dispatcher.dispatch({ tag: 'users', kind: 'queries' })
      expect(queries.relativePath).toBe('src/features/users/api/users.queries.ts')
      expect(queries.matchedBy).toBe('pattern')

      const keys = dispatcher.dispatch({ tag: 'users', kind: 'keys' })
      expect(keys.relativePath).toBe('src/features/users/api/users.keys.ts')
      expect(keys.matchedBy).toBe('pattern')
    })

    it('diverts shared tags (auth, shared, common, system) into shared directory via rule', () => {
      const dispatcher = createPathDispatcher(fsdConfig.outputRouting)

      const authQueries = dispatcher.dispatch({ tag: 'auth', kind: 'queries' })
      expect(authQueries.relativePath).toBe('src/shared/api/auth.queries.ts')
      expect(authQueries.matchedBy).toBe('rule')
      expect(authQueries.ruleIndex).toBe(0)

      const systemContract = dispatcher.dispatch({ tag: 'system', kind: 'contract' })
      expect(systemContract.relativePath).toBe('src/shared/api/system.contract.ts')
      expect(systemContract.matchedBy).toBe('rule')
      expect(systemContract.ruleIndex).toBe(0)
    })

    it('diverts schema artifacts into shared directory via kind rule', () => {
      const dispatcher = createPathDispatcher(fsdConfig.outputRouting)

      const schemas = dispatcher.dispatch({ tag: 'users', kind: 'schemas' })
      expect(schemas.relativePath).toBe('src/shared/api/schemas.ts')
      expect(schemas.matchedBy).toBe('rule')
      expect(schemas.ruleIndex).toBe(1)
    })

    it('maps client SDK to single shared location via byKind mapping', () => {
      const dispatcher = createPathDispatcher(fsdConfig.outputRouting)

      const client = dispatcher.dispatch({ tag: 'users', kind: 'client' })
      expect(client.relativePath).toBe('src/shared/api/client.ts')
      expect(client.matchedBy).toBe('byKind')
    })

    it('normalizes multi-word tags to kebab-case in path segments', () => {
      const dispatcher = createPathDispatcher(fsdConfig.outputRouting)

      const dispatched = dispatcher.dispatch({ tag: 'userProfile', kind: 'queries' })
      expect(dispatched.relativePath).toBe('src/features/user-profile/api/user-profile.queries.ts')
    })
  })

  describe('Recipe 2: Monorepo Multi-Package Distribution Routing (§4.6)', () => {
    const monorepoConfig = defineConfig({
      rootDir: '.',
      outputRouting: {
        byKind: {
          contract: 'packages/contracts/src/api.contract.ts',
          guards: 'packages/contracts/src/guards.ts',
          schemas: 'packages/contracts/src/schemas.ts',
          client: 'packages/client-sdk/src/index.ts',
          queries: 'apps/web/src/api/queries.ts',
          keys: 'apps/web/src/api/keys.ts',
        },
        rules: [
          {
            kind: 'queries',
            target: 'apps/web/src/api/{tag}.queries.ts',
          },
          {
            kind: 'keys',
            target: 'apps/web/src/api/{tag}.keys.ts',
          },
        ],
      },
    })

    it('validates strictly against validateOaConfig with 0 errors', () => {
      const result = validateOaConfig(monorepoConfig)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('routes backend contracts and guards to packages/contracts via byKind', () => {
      const dispatcher = createPathDispatcher(monorepoConfig.outputRouting)

      const contract = dispatcher.dispatch({ tag: 'users', kind: 'contract' })
      expect(contract.relativePath).toBe('packages/contracts/src/api.contract.ts')
      expect(contract.matchedBy).toBe('byKind')

      const guards = dispatcher.dispatch({ tag: 'users', kind: 'guards' })
      expect(guards.relativePath).toBe('packages/contracts/src/guards.ts')
      expect(guards.matchedBy).toBe('byKind')

      const schemas = dispatcher.dispatch({ tag: 'users', kind: 'schemas' })
      expect(schemas.relativePath).toBe('packages/contracts/src/schemas.ts')
      expect(schemas.matchedBy).toBe('byKind')
    })

    it('routes client SDK to packages/client-sdk via byKind', () => {
      const dispatcher = createPathDispatcher(monorepoConfig.outputRouting)

      const client = dispatcher.dispatch({ tag: 'users', kind: 'client' })
      expect(client.relativePath).toBe('packages/client-sdk/src/index.ts')
      expect(client.matchedBy).toBe('byKind')
    })

    it('prioritizes tagged rules over byKind for frontend queries and keys', () => {
      const dispatcher = createPathDispatcher(monorepoConfig.outputRouting)

      const queries = dispatcher.dispatch({ tag: 'users', kind: 'queries' })
      expect(queries.relativePath).toBe('apps/web/src/api/users.queries.ts')
      expect(queries.matchedBy).toBe('rule')
      expect(queries.ruleIndex).toBe(0)

      const keys = dispatcher.dispatch({ tag: 'users', kind: 'keys' })
      expect(keys.relativePath).toBe('apps/web/src/api/users.keys.ts')
      expect(keys.matchedBy).toBe('rule')
      expect(keys.ruleIndex).toBe(1)
    })
  })

  describe('Recipe 3: Microservice Lifecycle Archetype (§5.3)', () => {
    const microserviceConfig = defineConfig({
      rootDir: '.',
      archetype: 'microservice',
      core: {
        client: { enabled: true, wireFormatSafety: true },
        gates: { driftCheck: true, failOnBreaking: true },
      },
      product: {
        archetype: 'microservice',
        framework: 'fastify',
        jitSchema: true,
      },
    })

    it('validates strictly against validateOaConfig with 0 errors', () => {
      const result = validateOaConfig(microserviceConfig)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('preserves dual-layer boundary between core contracts and product lifecycle', () => {
      expect(microserviceConfig.archetype).toBe('microservice')
      expect(microserviceConfig.core?.client?.wireFormatSafety).toBe(true)
      expect(microserviceConfig.core?.gates?.driftCheck).toBe(true)
      expect(microserviceConfig.core?.gates?.failOnBreaking).toBe(true)

      expect(microserviceConfig.product?.archetype).toBe('microservice')
      expect(microserviceConfig.product?.framework).toBe('fastify')
      expect(microserviceConfig.product?.jitSchema).toBe(true)
    })
  })

  describe('Path Dispatcher Fallbacks and Edge Cases', () => {
    it('falls back to default conventions when outputRouting is empty', () => {
      const dispatcher = createPathDispatcher()

      const tagged = dispatcher.dispatch({ tag: 'users', kind: 'queries' })
      expect(tagged.relativePath).toBe('src/api/users/users.queries.ts')
      expect(tagged.matchedBy).toBe('default')

      const untagged = dispatcher.dispatch({ kind: 'queries' })
      expect(untagged.relativePath).toBe('src/api/generated/queries.ts')
      expect(untagged.matchedBy).toBe('default')
    })

    it('rejects invalid configurations gracefully in validateOaConfig', () => {
      expect(validateOaConfig(null).valid).toBe(false)
      expect(validateOaConfig(undefined).valid).toBe(false)
      expect(validateOaConfig({ rootDir: '.', archetype: 'invalid-archetype' as any }).valid).toBe(false)
      expect(
        validateOaConfig({
          rootDir: '.',
          outputRouting: { rules: [{ target: '' }] },
        }).valid,
      ).toBe(false)
    })
  })
})

// ── Suite 6: TanStack Query & Handler Contract End-to-End Type Safety ──────

describe('Suite 6: TanStack Query & Handler Contract End-to-End Type Safety', () => {
  let suite6TmpDir: string

  beforeAll(() => {
    suite6TmpDir = mkdtempSync(join(tmpdir(), 'oa-suite6-tanstack-'))
  })

  afterAll(() => {
    if (existsSync(suite6TmpDir)) {
      rmSync(suite6TmpDir, { recursive: true, force: true })
    }
  })

  it('executes oa-gen generate:tanstack, generates handler contracts, and passes tsc --noEmit with 0 diagnostics', () => {
    // 1. Define OpenAPI 3.2 Specification Fixture
    const oas32Spec = {
      openapi: '3.2.0',
      info: { title: 'User Management Full-Stack API', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            tags: ['users'],
            operationId: 'listUsers',
            summary: 'List users with filters',
            parameters: [
              { name: 'role', in: 'query', schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'List of users',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        required: ['id', 'name', 'email'],
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          email: { type: 'string' },
                          createdAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          post: {
            tags: ['users'],
            operationId: 'createUser',
            summary: 'Create a new user',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name', 'email'],
                    properties: {
                      name: { type: 'string' },
                      email: { type: 'string' },
                      role: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created user',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'name', 'email'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/users/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            tags: ['users'],
            operationId: 'getUser',
            summary: 'Get user detail by ID',
            responses: {
              '200': {
                description: 'User details',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'name', 'email'],
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    const specPath = join(suite6TmpDir, 'openapi.json')
    writeFileSync(specPath, JSON.stringify(oas32Spec, null, 2), 'utf8')

    // 2. Execute oa-gen generate:tanstack CLI in isolated directory
    const cliResult = runCli(
      [
        'generate:tanstack',
        '--spec',
        specPath,
        '--output',
        suite6TmpDir,
        '--split',
        '--types-import',
        './types.js',
        '--client-import',
        './client.js',
      ],
      suite6TmpDir,
    )

    expect(cliResult.exitCode).toBe(0)
    expect(existsSync(join(suite6TmpDir, 'keys.ts'))).toBe(true)
    expect(existsSync(join(suite6TmpDir, 'queries.ts'))).toBe(true)
    expect(existsSync(join(suite6TmpDir, 'hooks.ts'))).toBe(true)

    const keysContent = readFileSync(join(suite6TmpDir, 'keys.ts'), 'utf8')
    expect(keysContent).toContain('export const usersKeys = {')
    expect(keysContent).toContain("all: ['users'] as const")

    const queriesContent = readFileSync(join(suite6TmpDir, 'queries.ts'), 'utf8')
    expect(queriesContent).toContain('export function listUsersQueryOptions')
    expect(queriesContent).toContain('export function createUserMutationOptions')
    expect(queriesContent).toContain('export function getUserQueryOptions')

    const hooksContent = readFileSync(join(suite6TmpDir, 'hooks.ts'), 'utf8')
    expect(hooksContent).toContain('export function useListUsersQuery')
    expect(hooksContent).toContain('export function useGetUserQuery')

    // 3. Generate Backend Handler Contract via generateHandlerContract
    const contractCode = generateHandlerContract(oas32Spec as any, {
      contractName: 'UserApiHandlers',
      typesImport: './types.js',
    })
    writeFileSync(join(suite6TmpDir, 'contract.ts'), contractCode, 'utf8')

    expect(contractCode).toContain('export type ListUsersHandler')
    expect(contractCode).toContain('export type CreateUserHandler')
    expect(contractCode).toContain('export type GetUserHandler')
    expect(contractCode).toContain('export type HandlerResponse<TSuccess')

    // 4. Setup Isolated Project Manifest and tsconfig.json
    writeFileSync(join(suite6TmpDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    writeFileSync(
      join(suite6TmpDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    // 5. Provide Ambient Type Shims for React Query & Client SDK
    writeFileSync(
      join(suite6TmpDir, 'query-shim.d.ts'),
      `
declare module '@tanstack/react-query' {
  export function queryOptions<TQueryFnData, TError = Error, TData = TQueryFnData, TQueryKey extends readonly unknown[] = readonly unknown[]>(
    options: { queryKey: TQueryKey; queryFn: (context: { signal?: AbortSignal }) => Promise<TQueryFnData> } & Record<string, any>
  ): { queryKey: TQueryKey; queryFn: (context: { signal?: AbortSignal }) => Promise<TQueryFnData> };
  export function mutationOptions<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
    options: { mutationKey?: readonly unknown[]; mutationFn?: (variables: TVariables) => Promise<TData> } & Record<string, any>
  ): { mutationKey?: readonly unknown[]; mutationFn: (variables: TVariables) => Promise<TData> };
  export function useQuery<TData = any, TError = any>(options: any, client?: any): any;
  export function useMutation<TData, TError, TVariables, TContext>(options: any, client?: any): any;
  export type UndefinedInitialDataOptions<TQueryFnData, TError, TData, TQueryKey> = {
    queryKey: TQueryKey;
    queryFn: (ctx: { signal?: AbortSignal }) => Promise<TQueryFnData>;
  };
  export type UseMutationOptions<TData, TError, TVariables, TContext> = {
    mutationKey?: readonly unknown[];
    mutationFn: (variables: TVariables) => Promise<TData>;
  };
  export type UseQueryOptions<TData, TError, TQueryData, TQueryKey> = any;
  export type UseQueryResult<TData, TError> = any;
  export type UseMutationResult<TData, TError, TVariables, TContext> = any;
  export type QueryClient = any;
}
`,
      'utf8',
    )

    writeFileSync(
      join(suite6TmpDir, 'client-shim.d.ts'),
      `
declare module '@oa-sdk/client' {
  export type JsonPrimitive<T> = T extends Date
    ? string
    : T extends (...args: any[]) => any
      ? never
      : T extends object
        ? { [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: JsonPrimitive<T[K]> }
        : T;
  export type Resolved<T> = JsonPrimitive<T>;
  export type ClientMethodOptions = {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  };
}
`,
      'utf8',
    )

    // 6. Write Shared Wire Domain Types matching OAS 3.2 Spec
    writeFileSync(
      join(suite6TmpDir, 'types.ts'),
      `
export type UserRecord = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
};

export type ListUsersQueryParams = { role?: string; limit?: number };
export type ListUsersResponse = UserRecord[];

export type CreateUserBody = { name: string; email: string; role?: string };
export type CreateUserResponse = UserRecord;

export type GetUserPathParams = { id: string };
export type GetUserResponse = UserRecord;
`,
      'utf8',
    )

    // 7. Write Typed Fetch Client SDK Interface
    writeFileSync(
      join(suite6TmpDir, 'client.ts'),
      `
import type {
  ListUsersQueryParams,
  ListUsersResponse,
  CreateUserBody,
  CreateUserResponse,
  GetUserPathParams,
  GetUserResponse,
} from './types.js';
import type { JsonPrimitive, Resolved, ClientMethodOptions } from '@oa-sdk/client';

export interface ApiClient {
  listUsers(query?: ListUsersQueryParams, options?: ClientMethodOptions): Promise<JsonPrimitive<ListUsersResponse>>;
  createUser(body: Resolved<CreateUserBody>, options?: ClientMethodOptions): Promise<JsonPrimitive<CreateUserResponse>>;
  getUser(params: GetUserPathParams, options?: ClientMethodOptions): Promise<JsonPrimitive<GetUserResponse>>;
}
`,
      'utf8',
    )

    // 8. Write Full-Stack Implementation and Parity Consumer
    writeFileSync(
      join(suite6TmpDir, 'parity-implementation.ts'),
      `
import type { ListUsersHandler, CreateUserHandler, GetUserHandler } from './contract.js';
import { listUsersQueryOptions, createUserMutationOptions, getUserQueryOptions } from './queries.js';
import { useListUsersQuery, useGetUserQuery } from './hooks.js';
import type { ApiClient } from './client.js';

// Backend Service Implementations matching Handler Contracts
export const listUsersHandler: ListUsersHandler = async (ctx) => {
  const role = ctx?.query?.role;
  return [
    { id: 'usr_1', name: 'Alice Developer', email: 'alice@example.com', createdAt: new Date() },
    { id: 'usr_2', name: 'Bob Engineer', email: 'bob@example.com', createdAt: new Date() },
  ];
};

export const createUserHandler: CreateUserHandler = async (ctx) => {
  return {
    status: 200,
    body: {
      id: 'usr_new',
      name: ctx.body.name,
      email: ctx.body.email,
      createdAt: new Date(),
    },
  };
};

export const getUserHandler: GetUserHandler = async (ctx) => {
  return {
    status: 200,
    body: {
      id: ctx.params.id,
      name: 'Alice Developer',
      email: 'alice@example.com',
      createdAt: new Date(),
    },
  };
};

// Frontend Client Consumers matching TanStack Query Options
export async function fetchUsersFromClient(client: ApiClient) {
  const queryOpts = listUsersQueryOptions(client, { role: 'admin' });
  const data = await queryOpts.queryFn({ signal: undefined });

  // Verifies JsonPrimitive wire format safety: Date serialized to string
  const userCreatedAtIso: string = data[0].createdAt;
  const userEmail: string = data[0].email;
  return { userCreatedAtIso, userEmail };
}

export async function createNewUserFromClient(client: ApiClient) {
  const mutationOpts = createUserMutationOptions(client);
  const created = await mutationOpts.mutationFn({
    body: {
      name: 'Charlie',
      email: 'charlie@example.com',
    },
  });
  return created.id;
}
`,
      'utf8',
    )

    // 9. Execute runTsc and Assert 0 TypeScript Diagnostics
    expect(() => runTsc(suite6TmpDir)).not.toThrow()
  })
})
