/**
 * packages/codegen/src/__tests__/config-cli.test.ts
 *
 * End-to-end integration tests for Config-Driven CLI Execution:
 * 1. oa-gen generate with no arguments auto-loads oa.config.ts and emits all specs & guards
 * 2. Generated artifacts contain OpenAPI 3.1, JSON Schema 2020-12, and canonical extensions
 * 3. oa-gen validate with no arguments validates all profile targets and prints report table
 * 4. Subdirectory execution conformance (running from deep packages/a/b/c resolves root)
 * 5. Validation failure detection when spec violates profile rules
 * 6. Error handling when invoked with no arguments and no config exists
 * 7. Backward compatibility for explicit CLI flags (--config, --spec)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  mkdtempSync,
  symlinkSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import { findProjectRoot } from '@oa-sdk/core'

const REPO_ROOT = findProjectRoot(__dirname)
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const CLI_SRC = resolve(REPO_ROOT, 'packages/codegen/src/cli/index.ts')
const CODEGEN_NODE_MODULES = resolve(REPO_ROOT, 'packages/codegen/node_modules')

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(
  args: string[],
  options: { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined; timeout?: number | undefined } = {},
): CliResult {
  const cwd = options.cwd ?? REPO_ROOT
  const timeout = options.timeout ?? SUBPROCESS_TEST_BUDGET_MS
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  }

  const result = spawnSync('node', [TSX_CLI, CLI_SRC, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('Config-Driven CLI Pipeline (oa-gen generate & validate)', () => {
  let testProjectDir: string

  beforeEach(() => {
    testProjectDir = realpathSync(mkdtempSync(join(tmpdir(), 'oa-config-cli-test-')))
    if (existsSync(CODEGEN_NODE_MODULES)) {
      try {
        symlinkSync(CODEGEN_NODE_MODULES, join(testProjectDir, 'node_modules'), 'junction')
      } catch {
        // ignore if already exists or not supported
      }
    }
  })

  afterEach(() => {
    rmSync(testProjectDir, { recursive: true, force: true })
  })

  it('runs oa-gen generate with no arguments to project specs and guards', () => {
    // 1. Setup sample Zod schemas
    const schemasDir = join(testProjectDir, 'src', 'schemas')
    mkdirSync(schemasDir, { recursive: true })

    writeFileSync(
      join(schemasDir, 'surface.ts'),
      `import { z } from 'zod';
export const SurfaceBlockSchema = z.object({ id: z.string(), kind: z.enum(['css', 'html']) });
export const SurfaceParamSchema = z.object({ name: z.string(), value: z.string() });
`
    )

    writeFileSync(
      join(schemasDir, 'rpc.ts'),
      `import { z } from 'zod';
export const SessionHelloParamsSchema = z.object({ client: z.string() });
export const SessionHelloResultSchema = z.object({ sessionId: z.string() });
export const paths = {
  '/rpc/session.hello': {
    post: {
      operationId: 'sessionHello',
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/SessionHelloParams' } } } },
      responses: { '200': { description: 'ok' } },
    }
  }
};
`
    )

    // 2. Setup oa.config.ts
    writeFileSync(
      join(testProjectDir, 'oa.config.ts'),
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'surface-engine',
      profile: 'component-bundle',
      schemaEntry: './src/schemas/surface.ts',
      outDir: './artifacts/specs',
      title: 'Surface Engine',
    },
    {
      id: 'devlink-contracts',
      profile: 'operation-contract',
      schemaEntry: './src/schemas/rpc.ts',
      outDir: './artifacts/specs',
      title: 'DevLink RPC',
    },
  ],
  guards: {
    outDir: './dist/guards',
    moduleFormat: 'esm',
  }
};`
    )

    // 3. Execute oa-gen generate with NO arguments
    const genRes = runCli(['generate'], { cwd: testProjectDir })
    expect(genRes.status).toBe(0)
    expect(genRes.stdout).toContain('Surface Engine')
    expect(genRes.stdout).toContain('DevLink RPC')

    // 4. Verify generated spec files
    const surfaceOpenApi = join(testProjectDir, 'artifacts', 'specs', 'surface-engine.openapi.json')
    const surfaceSchema = join(testProjectDir, 'artifacts', 'specs', 'surface-engine.schema.json')
    const rpcOpenApi = join(testProjectDir, 'artifacts', 'specs', 'devlink-contracts.openapi.json')

    expect(existsSync(surfaceOpenApi)).toBe(true)
    expect(existsSync(surfaceSchema)).toBe(true)
    expect(existsSync(rpcOpenApi)).toBe(true)

    const surfaceJson = JSON.parse(readFileSync(surfaceOpenApi, 'utf8'))
    expect(surfaceJson.openapi).toBe('3.1.0')
    expect(surfaceJson['x-schema-engine-profile']).toBe('component-bundle')
    expect(surfaceJson['x-schema-engine-version-hash']).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(surfaceJson.components.schemas.SurfaceBlock).toBeDefined()

    const draft2020Json = JSON.parse(readFileSync(surfaceSchema, 'utf8'))
    expect(draft2020Json.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(draft2020Json.$defs.SurfaceBlock).toBeDefined()

    // 5. Verify guards
    const guardJs = join(testProjectDir, 'dist', 'guards', 'guards.js')
    const guardDts = join(testProjectDir, 'dist', 'guards', 'guards.d.ts')
    expect(existsSync(guardJs)).toBe(true)
    expect(existsSync(guardDts)).toBe(true)
  })

  it('runs oa-gen validate with no arguments to validate all profile targets', () => {
    // Setup valid project with oa.config.ts and schema
    const schemasDir = join(testProjectDir, 'src')
    mkdirSync(schemasDir, { recursive: true })
    writeFileSync(
      join(schemasDir, 'models.ts'),
      `import { z } from 'zod';
export const UserSchema = z.object({ id: z.string(), name: z.string() });`
    )

    writeFileSync(
      join(testProjectDir, 'oa.config.ts'),
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'models',
      profile: 'component-bundle',
      schemaEntry: './src/models.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
    )

    // Generate first
    const genRes = runCli(['generate'], { cwd: testProjectDir })
    expect(genRes.status).toBe(0)

    // Validate with NO arguments
    const valRes = runCli(['validate'], { cwd: testProjectDir })
    expect(valRes.status).toBe(0)
    expect(valRes.stdout).toContain('models')
    expect(valRes.stdout).toContain('🟢 PASS')
    expect(valRes.stdout).toContain('1 total targets, 1 passed, 0 failed')
  })

  it('executes generate and validate seamlessly from deep nested subdirectories', () => {
    // Setup config at root
    const schemasDir = join(testProjectDir, 'packages', 'core', 'schemas')
    mkdirSync(schemasDir, { recursive: true })
    writeFileSync(
      join(schemasDir, 'item.ts'),
      `import { z } from 'zod';
export const ItemSchema = z.object({ sku: z.string() });`
    )

    writeFileSync(
      join(testProjectDir, 'oa.config.ts'),
      `export default {
  rootDir: '.',
  specs: [{ id: 'items', profile: 'component-bundle', schemaEntry: './packages/core/schemas/item.ts', outDir: './artifacts/specs' }]
};`
    )

    // Deep nested directory
    const deepDir = join(testProjectDir, 'packages', 'nested', 'deep', 'subpkg')
    mkdirSync(deepDir, { recursive: true })

    // Run generate from deep directory
    const genRes = runCli(['generate'], { cwd: deepDir })
    expect(genRes.status).toBe(0)
    expect(existsSync(join(testProjectDir, 'artifacts', 'specs', 'items.openapi.json'))).toBe(true)

    // Run validate from deep directory
    const valRes = runCli(['validate'], { cwd: deepDir })
    expect(valRes.status).toBe(0)
    expect(valRes.stdout).toContain('🟢 PASS')
  })

  it('exits 1 on validate when a spec violates its profile requirements', () => {
    // Setup an invalid operation-contract with 0 operations
    const schemasDir = join(testProjectDir, 'src')
    mkdirSync(schemasDir, { recursive: true })
    writeFileSync(
      join(schemasDir, 'empty-rpc.ts'),
      `import { z } from 'zod';
export const EmptyModelSchema = z.object({ val: z.string() });
export const paths = {}; // VIOLATION: operation-contract requires at least one operation
`
    )

    writeFileSync(
      join(testProjectDir, 'oa.config.ts'),
      `export default {
  rootDir: '.',
  specs: [{ id: 'bad-contract', profile: 'operation-contract', schemaEntry: './src/empty-rpc.ts', outDir: './artifacts/specs' }]
};`
    )

    // Run generate (produces empty paths spec)
    runCli(['generate'], { cwd: testProjectDir })

    // Run validate -> should fail
    const valRes = runCli(['validate'], { cwd: testProjectDir })
    expect(valRes.status).toBe(1)
    expect(valRes.stdout).toContain('🔴 FAIL')
    expect(valRes.stdout).toContain('operation-contract projections must contain at least one operation')
  })

  it('fails with helpful error message when no config and no arguments are given', () => {
    const emptyDir = testProjectDir

    const genRes = runCli(['generate'], { cwd: emptyDir })
    expect(genRes.status).toBe(1)
    expect(genRes.stderr).toContain('oa.config.ts 설정 파일을 찾을 수 없으며')

    const valRes = runCli(['validate'], { cwd: emptyDir })
    expect(valRes.status).toBe(1)
    expect(valRes.stderr).toContain('oa.config.ts 설정 파일을 찾을 수 없으며')
  })

  it('supports explicit --config and --spec options', () => {
    const schemasDir = join(testProjectDir, 'src')
    mkdirSync(schemasDir, { recursive: true })
    writeFileSync(
      join(schemasDir, 'schema.ts'),
      `import { z } from 'zod';
export const PostSchema = z.object({ id: z.string(), content: z.string() });`
    )

    const customConfigPath = join(testProjectDir, 'custom.config.ts')
    writeFileSync(
      customConfigPath,
      `export default {
  rootDir: '.',
  specs: [{ id: 'custom-spec', profile: 'component-bundle', schemaEntry: './src/schema.ts', outDir: './custom-specs' }]
};`
    )

    // Test explicit --config
    const genRes = runCli(['generate', '--config', customConfigPath], { cwd: testProjectDir })
    expect(genRes.status).toBe(0)
    const emittedOpenApi = join(testProjectDir, 'custom-specs', 'custom-spec.openapi.json')
    expect(existsSync(emittedOpenApi)).toBe(true)

    // Test explicit --spec with validate
    const valRes = runCli(['validate', '--spec', emittedOpenApi], { cwd: testProjectDir })
    expect(valRes.status).toBe(0)
    expect(valRes.stdout).toContain('3.1 호환')

    // Test explicit --config with validate
    const valConfigRes = runCli(['validate', '--config', customConfigPath], { cwd: testProjectDir })
    expect(valConfigRes.status).toBe(0)
    expect(valConfigRes.stdout).toContain('custom-spec')
    expect(valConfigRes.stdout).toContain('🟢 PASS')
  })
})
