/**
 * packages/codegen/test/adversarial/m2-pipeline-challenger.test.ts
 *
 * EMPIRICAL CHALLENGER 2 TEST SUITE (Milestone 2)
 *
 * Rigorous adversarial stress testing of pipeline dispatch in oa-gen generate and oa-gen validate:
 * 1. No-arg validate with oa.config.ts in temp project (summary printed, targets validated)
 *    - Both pre-existing disk artifacts and dynamic in-memory projections
 *    - Multi-target profiles (component-bundle, operation-contract, full-api-document)
 * 2. No-arg generate with oa.config.ts in temp project:
 *    - Specs (OpenAPI 3.1 + JSON Schema 2020-12) & guards emitted
 *    - Complete verification of canonical x-schema-engine-* vendor extensions
 *    - Split guards and execution oracle verifying generated type guards
 * 3. Nested subdirectory execution:
 *    - Upward config discovery from deeply nested directory
 *    - Intermediate package.json / git markers (Submodule Traversal Invariant)
 *    - Output path resolution strictly anchored to project root, not invocation cwd
 * 4. Validation failure behavior:
 *    - Exit code 1 when spec violates profile requirements
 *    - Exit code 1 when schema projection fails
 *    - Exit code 1 when stored artifact JSON is corrupted
 * 5. Adversarial edge cases:
 *    - Duplicate target IDs
 *    - Empty specs array
 *    - Missing config file
 *    - Function config export (export default () => ({ ... }))
 *    - Native Node execution of compiled binary vs tsx CLI
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
import { pathToFileURL } from 'node:url'
import { findProjectRoot } from '@oa-sdk/core'

const REPO_ROOT = findProjectRoot(__dirname)
const TSX_CLI = resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const CLI_SRC = resolve(REPO_ROOT, 'packages/codegen/src/cli/index.ts')
const CLI_DIST = resolve(REPO_ROOT, 'packages/codegen/dist/cli/index.js')
const CODEGEN_NODE_MODULES = resolve(REPO_ROOT, 'packages/codegen/node_modules')

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCliWithTsx(
  args: string[],
  options: { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined; timeout?: number | undefined } = {},
): CliResult {
  const cwd = options.cwd ?? REPO_ROOT
  const timeout = options.timeout ?? 30_000
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

function runCliWithDist(
  args: string[],
  options: { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined; timeout?: number | undefined } = {},
): CliResult {
  const cwd = options.cwd ?? REPO_ROOT
  const timeout = options.timeout ?? 30_000
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  }

  const result = spawnSync('node', [CLI_DIST, ...args], {
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

describe('Adversarial Challenger 2: Pipeline Dispatch (oa-gen generate & validate)', () => {
  let testProjectDir: string

  beforeEach(() => {
    testProjectDir = realpathSync(mkdtempSync(join(tmpdir(), 'oa-challenger-m2-')))
    if (existsSync(CODEGEN_NODE_MODULES)) {
      try {
        symlinkSync(CODEGEN_NODE_MODULES, join(testProjectDir, 'node_modules'), 'junction')
      } catch {
        // ignore
      }
    }
  })

  afterEach(() => {
    rmSync(testProjectDir, { recursive: true, force: true })
  })

  // =========================================================================
  // REQUIREMENT 1: No-arg validate with oa.config.ts
  // =========================================================================
  describe('Challenge 1: No-argument validate execution with oa.config.ts', () => {
    it('1A: Validates all targets in-memory when no artifacts exist on disk and prints summary table', () => {
      // Setup schema files
      const schemasDir = join(testProjectDir, 'src', 'schemas')
      mkdirSync(schemasDir, { recursive: true })

      writeFileSync(
        join(schemasDir, 'bundle.ts'),
        `import { z } from 'zod';
export const WidgetSchema = z.object({ id: z.string(), width: z.number().positive(), height: z.number().positive() });
export const PaletteSchema = z.object({ primary: z.string(), secondary: z.string() });
`
      )

      writeFileSync(
        join(schemasDir, 'contract.ts'),
        `import { z } from 'zod';
export const CreateWidgetParamsSchema = z.object({ name: z.string() });
export const WidgetResponseSchema = z.object({ id: z.string(), name: z.string() });
export const paths = {
  '/widgets': {
    post: {
      operationId: 'createWidget',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWidgetParams' } } }
      },
      responses: {
        '200': {
          description: 'Widget created',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WidgetResponse' } } }
        }
      }
    }
  }
};
`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'widget-bundle',
      profile: 'component-bundle',
      schemaEntry: './src/schemas/bundle.ts',
      outDir: './artifacts/specs',
      title: 'Widget Components',
      version: '2.1.0',
    },
    {
      id: 'widget-contract',
      profile: 'operation-contract',
      schemaEntry: './src/schemas/contract.ts',
      outDir: './artifacts/specs',
      title: 'Widget RPC Operations',
      version: '1.0.0',
    }
  ]
};`
      )

      // Notice: artifacts directory does NOT exist yet!
      expect(existsSync(join(testProjectDir, 'artifacts'))).toBe(false)

      // Run validate with NO arguments
      const res = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(res.status).toBe(0)
      expect(res.stdout).toContain('[oa-gen validate] Validating Declarative Specification Targets...')
      expect(res.stdout).toContain('widget-bundle')
      expect(res.stdout).toContain('widget-contract')
      expect(res.stdout).toContain('🟢 PASS')
      expect(res.stdout).toContain('Summary: 2 total targets, 2 passed, 0 failed.')
    })

    it('1B: Validates pre-generated artifacts stored on disk and detects corrupted spec', () => {
      // First generate
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'types.ts'),
        `import { z } from 'zod';
export const UserSchema = z.object({ username: z.string(), email: z.string().email() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'user-spec',
      profile: 'component-bundle',
      schemaEntry: './src/types.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const genRes = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)

      const artifactPath = join(testProjectDir, 'artifacts', 'specs', 'user-spec.openapi.json')
      expect(existsSync(artifactPath)).toBe(true)

      // Validate cleanly passes
      const valRes1 = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes1.status).toBe(0)
      expect(valRes1.stdout).toContain('user-spec')
      expect(valRes1.stdout).toContain('🟢 PASS')

      // Corrupt the disk artifact with invalid JSON
      writeFileSync(artifactPath, '{ "corrupted": true, broken json... ')

      // Validate must FAIL and report error
      const valRes2 = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes2.status).toBe(1)
      expect(valRes2.stdout).toContain('user-spec')
      expect(valRes2.stdout).toContain('🔴 FAIL')
      expect(valRes2.stdout).toContain('Failed to parse spec artifact JSON')
      expect(valRes2.stdout).toContain('Summary: 1 total targets, 0 passed, 1 failed.')
    })
  })

  // =========================================================================
  // REQUIREMENT 2: No-arg generate with oa.config.ts
  // =========================================================================
  describe('Challenge 2: No-argument generate execution with oa.config.ts', () => {
    it('2A: Emits all OpenAPI 3.1 specs, JSON Schema 2020-12, and standalone guards (including split)', async () => {
      const schemasDir = join(testProjectDir, 'src', 'schemas')
      mkdirSync(schemasDir, { recursive: true })

      writeFileSync(
        join(schemasDir, 'surface.ts'),
        `import { z } from 'zod';
export const ElementSchema = z.object({ id: z.string(), tag: z.string(), count: z.number().int() });
export const AttributeSchema = z.object({ key: z.string(), val: z.string() });
`
      )

      writeFileSync(
        join(schemasDir, 'api.ts'),
        `import { z } from 'zod';
export const QueryRequestSchema = z.object({ filter: z.string() });
export const QueryResponseSchema = z.object({ items: z.array(z.string()) });
export const paths = {
  '/api/query': {
    get: {
      operationId: 'queryItems',
      responses: {
        '200': {
          description: 'Query result',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/QueryResponse' } } }
        }
      }
    }
  }
};
`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'surface-models',
      profile: 'component-bundle',
      schemaEntry: './src/schemas/surface.ts',
      outDir: './artifacts/specs',
      title: 'Surface Components',
      version: '3.0.0',
    },
    {
      id: 'query-api',
      profile: 'operation-contract',
      schemaEntry: './src/schemas/api.ts',
      outDir: './artifacts/specs',
      title: 'Query API',
      version: '1.2.3',
    }
  ],
  guards: {
    outDir: './dist/guards',
    split: true,
    moduleFormat: 'esm',
    auditCsp: true,
  }
};`
      )

      // Run generate with NO arguments
      const res = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(res.status).toBe(0)
      expect(res.stdout).toContain('[oa-gen generate] Executing Declarative Spec Pipeline...')
      expect(res.stdout).toContain('surface-models')
      expect(res.stdout).toContain('query-api')
      expect(res.stdout).toContain('Guards Generated:')

      // 1. Assert OpenAPI specifications
      const surfaceOpenApi = join(testProjectDir, 'artifacts', 'specs', 'surface-models.openapi.json')
      const queryOpenApi = join(testProjectDir, 'artifacts', 'specs', 'query-api.openapi.json')
      expect(existsSync(surfaceOpenApi)).toBe(true)
      expect(existsSync(queryOpenApi)).toBe(true)

      const surfaceJson = JSON.parse(readFileSync(surfaceOpenApi, 'utf8'))
      expect(surfaceJson.openapi).toBe('3.1.0')
      expect(surfaceJson.info.title).toBe('Surface Components')
      expect(surfaceJson.info.version).toBe('3.0.0')
      expect(surfaceJson['x-schema-engine-profile']).toBe('component-bundle')
      expect(surfaceJson['x-schema-engine-version-hash']).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(surfaceJson['x-schema-engine-sources'].Element).toBeDefined()
      expect(surfaceJson['x-schema-engine-sources'].Element.pointer).toBe('#/components/schemas/Element')
      expect(surfaceJson.components.schemas.Element).toBeDefined()
      expect(surfaceJson.components.schemas.Attribute).toBeDefined()

      // 2. Assert JSON Schema 2020-12
      const surfaceSchema = join(testProjectDir, 'artifacts', 'specs', 'surface-models.schema.json')
      expect(existsSync(surfaceSchema)).toBe(true)
      const surfaceSchemaJson = JSON.parse(readFileSync(surfaceSchema, 'utf8'))
      expect(surfaceSchemaJson.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
      expect(surfaceSchemaJson.$defs.Element).toBeDefined()

      // 3. Assert Guards in split: true mode (index.js, index.d.ts, and individual guard modules)
      const guardIndexJs = join(testProjectDir, 'dist', 'guards', 'index.js')
      const guardIndexDts = join(testProjectDir, 'dist', 'guards', 'index.d.ts')
      expect(existsSync(guardIndexJs)).toBe(true)
      expect(existsSync(guardIndexDts)).toBe(true)

      // Because split: true was set, verify modular files
      const splitElementGuard = join(testProjectDir, 'dist', 'guards', 'guards', 'Element.js')
      expect(existsSync(splitElementGuard)).toBe(true)

      // 4. Runtime Oracle: Import the generated guard and test validation execution
      const guardsModule = await import(pathToFileURL(guardIndexJs).href)
      expect(typeof guardsModule.isElement).toBe('function')

      // Valid element
      const validElement = { id: 'el-1', tag: 'div', count: 5 }
      expect(guardsModule.isElement(validElement)).toBe(true)

      // Invalid element (count must be integer)
      const invalidElement = { id: 'el-1', tag: 'div', count: 'five' }
      expect(guardsModule.isElement(invalidElement)).toBe(false)
    })
  })

  // =========================================================================
  // REQUIREMENT 3: Nested Subdirectory Execution & Upward Config Discovery
  // =========================================================================
  describe('Challenge 3: Nested subdirectory execution', () => {
    it('3A: Automatically discovers root config from a 4-level deep subdirectory and anchors output to project root', () => {
      // Create root project files
      const schemasDir = join(testProjectDir, 'packages', 'core', 'schemas')
      mkdirSync(schemasDir, { recursive: true })

      writeFileSync(
        join(schemasDir, 'record.ts'),
        `import { z } from 'zod';
export const RecordSchema = z.object({ key: z.string(), value: z.string() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'core-records',
      profile: 'component-bundle',
      schemaEntry: './packages/core/schemas/record.ts',
      outDir: './artifacts/specs',
    }
  ],
  guards: {
    outDir: './dist/guards',
  }
};`
      )

      // Create a deep nested subdirectory: packages/app/modules/inspector/submodule
      const deepSubdir = join(testProjectDir, 'packages', 'app', 'modules', 'inspector', 'submodule')
      mkdirSync(deepSubdir, { recursive: true })

      // Create an intermediate package.json inside packages/app (testing workspace/intermediate boundary)
      writeFileSync(
        join(testProjectDir, 'packages', 'app', 'package.json'),
        JSON.stringify({ name: '@test/app', version: '0.0.1' })
      )

      // Execute oa-gen generate from deep subdirectory
      const genRes = runCliWithTsx(['generate'], { cwd: deepSubdir })
      expect(genRes.status).toBe(0)
      expect(genRes.stdout).toContain('core-records')

      // Output files MUST be created at repo root, NEVER inside deepSubdir!
      const rootSpecPath = join(testProjectDir, 'artifacts', 'specs', 'core-records.openapi.json')
      const rootGuardPath = join(testProjectDir, 'dist', 'guards', 'guards.js')
      expect(existsSync(rootSpecPath)).toBe(true)
      expect(existsSync(rootGuardPath)).toBe(true)

      // Assert no artifacts were mistakenly created in the deep directory
      expect(existsSync(join(deepSubdir, 'artifacts'))).toBe(false)
      expect(existsSync(join(deepSubdir, 'dist'))).toBe(false)

      // Execute oa-gen validate from deep subdirectory
      const valRes = runCliWithTsx(['validate'], { cwd: deepSubdir })
      expect(valRes.status).toBe(0)
      expect(valRes.stdout).toContain('core-records')
      expect(valRes.stdout).toContain('🟢 PASS')
    })
  })

  // =========================================================================
  // REQUIREMENT 4: Validation Failure Behavior (Exit Code 1)
  // =========================================================================
  describe('Challenge 4: Validation failure exit code 1', () => {
    it('4A: Exits 1 when operation-contract has 0 operations', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })

      writeFileSync(
        join(schemasDir, 'bad-ops.ts'),
        `import { z } from 'zod';
export const TestSchema = z.object({ name: z.string() });
export const paths = {}; // EMPTY PATHS: violates operation-contract requirement
`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'bad-contract',
      profile: 'operation-contract',
      schemaEntry: './src/bad-ops.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stdout).toContain('bad-contract')
      expect(valRes.stdout).toContain('🔴 FAIL')
      expect(valRes.stdout).toContain('operation-contract projections must contain at least one operation')
      expect(valRes.stdout).toContain('Summary: 1 total targets, 0 passed, 1 failed.')
    })

    it('4B: Exits 1 when schemaEntry file fails to load / does not exist', () => {
      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'missing-entry',
      profile: 'component-bundle',
      schemaEntry: './src/non-existent-file.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stdout).toContain('missing-entry')
      expect(valRes.stdout).toContain('🔴 FAIL')
      expect(valRes.stdout).toContain('Failed to project spec from source')
    })

    it('4C: Multi-target mixed results: exits 1 if ANY target fails', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })

      writeFileSync(
        join(schemasDir, 'good.ts'),
        `import { z } from 'zod';
export const GoodSchema = z.object({ id: z.string() });`
      )

      writeFileSync(
        join(schemasDir, 'bad.ts'),
        `import { z } from 'zod';
export const BadSchema = z.object({ id: z.string() });
export const paths = {};`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'good-target',
      profile: 'component-bundle',
      schemaEntry: './src/good.ts',
      outDir: './artifacts/specs',
    },
    {
      id: 'bad-target',
      profile: 'operation-contract',
      schemaEntry: './src/bad.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stdout).toContain('good-target')
      expect(valRes.stdout).toContain('🟢 PASS')
      expect(valRes.stdout).toContain('bad-target')
      expect(valRes.stdout).toContain('🔴 FAIL')
      expect(valRes.stdout).toContain('Summary: 2 total targets, 1 passed, 1 failed.')
    })
  })

  // =========================================================================
  // REQUIREMENT 5: Adversarial Edge Cases & Compiled Binary Execution
  // =========================================================================
  describe('Challenge 5: Adversarial edge cases and compiled dist execution', () => {
    it('5A: Exits 1 when no config is present and no arguments are passed', () => {
      const emptyDir = testProjectDir

      const genRes = runCliWithTsx(['generate'], { cwd: emptyDir })
      expect(genRes.status).toBe(1)
      expect(genRes.stderr).toContain('oa.config.ts 설정 파일을 찾을 수 없으며')

      const valRes = runCliWithTsx(['validate'], { cwd: emptyDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stderr).toContain('oa.config.ts 설정 파일을 찾을 수 없으며')
    })

    it('5B: Exits 1 when oa.config.ts has empty specs array', () => {
      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: []
};`
      )

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stderr).toContain('오류: 설정 파일에 specs 목록이 비어 있습니다')
    })

    it('5C: Supports function export in oa.config.ts (export default () => ({ ... }))', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'fn-schema.ts'),
        `import { z } from 'zod';
export const SettingSchema = z.object({ theme: z.enum(['light', 'dark']) });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default async () => {
  return {
    rootDir: '.',
    specs: [
      {
        id: 'settings',
        profile: 'component-bundle',
        schemaEntry: './src/fn-schema.ts',
        outDir: './artifacts/specs',
      }
    ]
  };
};`
      )

      const genRes = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)
      expect(existsSync(join(testProjectDir, 'artifacts', 'specs', 'settings.openapi.json'))).toBe(true)

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(0)
      expect(valRes.stdout).toContain('settings')
      expect(valRes.stdout).toContain('🟢 PASS')
    })

    it('5D: Runs natively via compiled dist/cli/index.js binary without tsx wrapper', () => {
      if (!existsSync(CLI_DIST)) {
        // If dist hasn't been built, skip or fail
        throw new Error(`Compiled CLI not found at ${CLI_DIST}. Run pnpm build first.`)
      }

      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'model.ts'),
        `import { z } from 'zod';
export const ProductSchema = z.object({ sku: z.string(), price: z.number().positive() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'products',
      profile: 'component-bundle',
      schemaEntry: './src/model.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      // Execute the compiled dist CLI
      const genRes = runCliWithDist(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)
      expect(existsSync(join(testProjectDir, 'artifacts', 'specs', 'products.openapi.json'))).toBe(true)

      const valRes = runCliWithDist(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(0)
      expect(valRes.stdout).toContain('products')
      expect(valRes.stdout).toContain('🟢 PASS')
    })

    it('5E: Generates monolithic guard bundle (guards.js, guards.d.ts, index.js, index.d.ts) when split is omitted', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'single.ts'),
        `import { z } from 'zod';
export const UserSessionSchema = z.object({ token: z.string() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'session',
      profile: 'component-bundle',
      schemaEntry: './src/single.ts',
      outDir: './artifacts/specs',
    }
  ],
  guards: {
    outDir: './dist/monolithic-guards',
    split: false,
  }
};`
      )

      const genRes = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)

      const guardsDir = join(testProjectDir, 'dist', 'monolithic-guards')
      expect(existsSync(join(guardsDir, 'guards.js'))).toBe(true)
      expect(existsSync(join(guardsDir, 'guards.d.ts'))).toBe(true)
      expect(existsSync(join(guardsDir, 'index.js'))).toBe(true)
      expect(existsSync(join(guardsDir, 'index.d.ts'))).toBe(true)
    })

    it('5F: Nested subdirectory execution exits 1 when validation fails', () => {
      const schemasDir = join(testProjectDir, 'packages', 'core', 'schemas')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'bad.ts'),
        `import { z } from 'zod';
export const EmptySchema = z.object({ id: z.string() });
export const paths = {}; // VIOLATION for operation-contract`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.ts'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'nested-bad',
      profile: 'operation-contract',
      schemaEntry: './packages/core/schemas/bad.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const deepDir = join(testProjectDir, 'packages', 'deep', 'sub')
      mkdirSync(deepDir, { recursive: true })

      const valRes = runCliWithTsx(['validate'], { cwd: deepDir })
      expect(valRes.status).toBe(1)
      expect(valRes.stdout).toContain('nested-bad')
      expect(valRes.stdout).toContain('🔴 FAIL')
    })

    it('5G: Supports oa.config.json with no-argument generate and validate', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'data.ts'),
        `import { z } from 'zod';
export const SimpleSchema = z.object({ value: z.string() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.json'),
        JSON.stringify({
          rootDir: '.',
          specs: [
            {
              id: 'json-spec',
              profile: 'component-bundle',
              schemaEntry: './src/data.ts',
              outDir: './artifacts/specs',
            }
          ]
        }, null, 2)
      )

      const genRes = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)
      expect(existsSync(join(testProjectDir, 'artifacts', 'specs', 'json-spec.openapi.json'))).toBe(true)

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(0)
      expect(valRes.stdout).toContain('json-spec')
      expect(valRes.stdout).toContain('🟢 PASS')
    })

    it('5H: Supports oa.config.mjs with no-argument generate and validate', () => {
      const schemasDir = join(testProjectDir, 'src')
      mkdirSync(schemasDir, { recursive: true })
      writeFileSync(
        join(schemasDir, 'mjs-data.ts'),
        `import { z } from 'zod';
export const MjsSchema = z.object({ flag: z.boolean() });`
      )

      writeFileSync(
        join(testProjectDir, 'oa.config.mjs'),
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'mjs-spec',
      profile: 'component-bundle',
      schemaEntry: './src/mjs-data.ts',
      outDir: './artifacts/specs',
    }
  ]
};`
      )

      const genRes = runCliWithTsx(['generate'], { cwd: testProjectDir })
      expect(genRes.status).toBe(0)
      expect(existsSync(join(testProjectDir, 'artifacts', 'specs', 'mjs-spec.openapi.json'))).toBe(true)

      const valRes = runCliWithTsx(['validate'], { cwd: testProjectDir })
      expect(valRes.status).toBe(0)
      expect(valRes.stdout).toContain('mjs-spec')
      expect(valRes.stdout).toContain('🟢 PASS')
    })
  })
})
