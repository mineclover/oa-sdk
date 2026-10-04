import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { runOaCli } from './helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'
import { findProjectRoot, findProjectRootDetail } from '@oa-sdk/core'
import { auditCspBundle, auditCspSource } from '../../cli/commands/audit-csp.js'

describe('E2E Tier 4: Real-World Application Scenarios (8 Tests)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tier4-rw-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  const browserStudioRoot = '/Users/junwoobang/workflow/browser-studio'

  // =========================================================================
  // T4-01: Full Browser Studio Spec & Guard Governance Pipeline
  // =========================================================================
  it.skipIf(!fsSync.existsSync(browserStudioRoot))('T4-01: Full Browser Studio Spec & Guard Governance Pipeline', async () => {
    // 1. Validate all 6 profiles declared in browser-studio/oa.config.ts
    const valResult = runOaCli(['validate'], { cwd: browserStudioRoot })
    expect(valResult.status).toBe(0)
    expect(valResult.stdout).toContain('Summary: 6 total targets, 6 passed, 0 failed')
    expect(valResult.stdout).toContain('devlink-contracts')
    expect(valResult.stdout).toContain('devlink-mcp')
    expect(valResult.stdout).toContain('surface-engine')
    expect(valResult.stdout).toContain('visual-ir')
    expect(valResult.stdout).toContain('inspector-controls')
    expect(valResult.stdout).toContain('browser-mapper')

    // 2. CSP audit on guards bundle (262+ standalone guards)
    const auditResult = runOaCli(['audit:csp', '--bundle', 'dist/guards'], { cwd: browserStudioRoot })
    expect(auditResult.status).toBe(0)
    expect(auditResult.stdout).toContain('0 CSP violations found')
    expect(auditResult.stdout).toContain('Manifest V3 compliant')

    // 3. Artifact freshness verification on committed specs
    const targetSpecs = [
      'devlink-contracts',
      'devlink-mcp',
      'surface-engine',
      'visual-ir',
      'inspector-controls',
      'browser-mapper',
    ]

    for (const id of targetSpecs) {
      const artifactFile = path.join(browserStudioRoot, `artifacts/specs/${id}.openapi.json`)
      expect(fsSync.existsSync(artifactFile)).toBe(true)
      const doc = JSON.parse(await fs.readFile(artifactFile, 'utf8'))
      expect(doc['x-schema-engine-version-hash']).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(doc['x-schema-engine-profile']).toBeDefined()
    }
  })

  // =========================================================================
  // T4-02: Nested Submodule Subdirectory Execution Conformance
  // =========================================================================
  it.skipIf(!fsSync.existsSync(browserStudioRoot))('T4-02: Nested Submodule Subdirectory Execution Conformance', () => {
    const candidateSubmodule1 = path.join(
      browserStudioRoot,
      'packages/browser-mapper/packages/selector-evaluator'
    )
    const candidateSubmodule2 = path.join(
      browserStudioRoot,
      'packages/browser-mapper/packages/unified-utils'
    )
    const deepSubmoduleDir = fsSync.existsSync(candidateSubmodule1)
      ? candidateSubmodule1
      : candidateSubmodule2
    expect(fsSync.existsSync(deepSubmoduleDir)).toBe(true)

    // Verify upward root discovery resolves browser-studio root, not submodule
    const detail = findProjectRootDetail(deepSubmoduleDir)
    expect(detail.root).toBe(browserStudioRoot)
    expect(detail.matchedMarker).toBe('oa.config.ts')

    // Run oa-gen validate with no args from submodule directory
    const valResult = runOaCli(['validate'], { cwd: deepSubmoduleDir })
    expect(valResult.status).toBe(0)
    expect(valResult.stdout).toContain('Summary: 6 total targets, 6 passed, 0 failed')

    // Run oa-gen audit:csp with no --root flag from submodule directory
    const auditResult = runOaCli(['audit:csp', '--bundle', 'dist/guards'], { cwd: deepSubmoduleDir })
    expect(auditResult.status).toBe(0)
    expect(auditResult.stdout).toContain('0 CSP violations found')
  })

  // =========================================================================
  // T4-03: CI Pull Request Spec Freshness Gate
  // =========================================================================
  it('T4-03: CI Pull Request Spec Freshness Gate', async () => {
    // Setup simulated repository in fixture
    await fixture.writeFile(
      'schemas/contracts.ts',
      `import { z } from 'zod';
export const UserSession = z.object({
  sessionId: z.string().uuid(),
  userId: z.string(),
  active: z.boolean(),
});
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'session-contract',
      profile: 'component-bundle',
      schemaEntry: './schemas/contracts.ts',
      outDir: './artifacts/specs',
    },
  ],
};
`
    )

    // Initial commit state: generate artifacts
    const initGen = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(initGen.status).toBe(0)

    // CI Check 1: In base branch, drift:check passes
    const baseDrift = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(baseDrift.status).toBe(0)
    expect(baseDrift.stdout).toContain('🟢 FRESH')

    // Developer modifies schema in PR branch but forgets to run oa-gen generate
    await fixture.writeFile(
      'schemas/contracts.ts',
      `import { z } from 'zod';
export const UserSession = z.object({
  sessionId: z.string().uuid(),
  userId: z.string(),
  active: z.boolean(),
  roles: z.array(z.string()), // Added in PR without re-generating artifacts
});
`
    )

    // CI Check 2: PR spec freshness check fails and blocks merge
    const prDrift = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(prDrift.status).toBe(1)
    expect(prDrift.stdout).toContain('Spec drift detected: 1 of 1 targets failed')
    expect(prDrift.stdout).toContain('DRIFT')

    // Developer fixes PR by running generate
    const prFixGen = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(prFixGen.status).toBe(0)

    // CI Check 3: PR re-check passes
    const prFixedDrift = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(prFixedDrift.status).toBe(0)
    expect(prFixedDrift.stdout).toContain('🟢 FRESH')
  })

  // =========================================================================
  // T4-04: Breaking Change Semantic Gate in Release Workflow
  // =========================================================================
  it('T4-04: Breaking Change Semantic Gate in Release Workflow', async () => {
    // Base v1.0.0 spec
    const v1Spec = {
      openapi: '3.1.0',
      info: { title: 'Release Candidate API', version: '1.0.0' },
      paths: {
        '/api/v1/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'User details',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['id', 'email', 'name'],
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' },
                        name: { type: 'string' },
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

    const v1Path = path.join(fixture.rootDir, 'v1.0.0.openapi.json')
    await fs.writeFile(v1Path, JSON.stringify(v1Spec, null, 2))

    // Candidate 1: Breaking change (removed required response property 'email')
    const breakingSpec = JSON.parse(JSON.stringify(v1Spec))
    breakingSpec.paths['/api/v1/users/{id}'].get.responses['200'].content['application/json'].schema.required = ['id', 'name']
    delete breakingSpec.paths['/api/v1/users/{id}'].get.responses['200'].content['application/json'].schema.properties.email

    const breakingPath = path.join(fixture.rootDir, 'candidate-breaking.openapi.json')
    await fs.writeFile(breakingPath, JSON.stringify(breakingSpec, null, 2))

    // Release preflight diff check blocks release
    const breakingResult = runOaCli(
      ['diff', '--base', v1Path, '--head', breakingPath, '--fail-on-breaking'],
      { cwd: fixture.rootDir }
    )
    expect(breakingResult.status).toBe(1)
    expect(breakingResult.stdout).toContain('Breaking Changes')

    // Candidate 2: Compatible change (added optional query parameter and new endpoint)
    const compatibleSpec = JSON.parse(JSON.stringify(v1Spec))
    compatibleSpec.paths['/api/v1/users/{id}'].get.parameters.push({
      name: 'filter',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    })
    compatibleSpec.paths['/api/v1/health'] = {
      get: {
        operationId: 'getHealth',
        responses: { '200': { description: 'Healthy' } },
      },
    }

    const compatiblePath = path.join(fixture.rootDir, 'candidate-compatible.openapi.json')
    await fs.writeFile(compatiblePath, JSON.stringify(compatibleSpec, null, 2))

    // Release preflight diff check approves compatible candidate
    const compatibleResult = runOaCli(
      ['diff', '--base', v1Path, '--head', compatiblePath, '--fail-on-breaking'],
      { cwd: fixture.rootDir }
    )
    expect(compatibleResult.status).toBe(0)
  })

  // =========================================================================
  // T4-05: Manifest V3 Content Script Live-Editing Sandbox Invariant
  // =========================================================================
  it.skipIf(!fsSync.existsSync(browserStudioRoot))('T4-05: Manifest V3 Content Script Live-Editing Sandbox Invariant', async () => {
    const guardsEntry = path.join(browserStudioRoot, 'dist/guards/devlink-contracts.guards.js')
    expect(fsSync.existsSync(guardsEntry)).toBe(true)

    // 1. Perform AST audit ensuring zero prohibited syntax
    const code = await fs.readFile(guardsEntry, 'utf8')
    const violations = await auditCspSource(guardsEntry, code)
    expect(violations).toHaveLength(0)

    // 2. Execute guard functions under sandboxed environment with eval and Function trapped
    const origEval = (globalThis as any).eval
    const origFunction = (globalThis as any).Function

    let evalInvocationCount = 0
    let functionConstructorCount = 0

    try {
      // Disallow eval and Function
      ;(globalThis as any).eval = () => {
        evalInvocationCount++
        throw new Error('CSP Security Error: eval() is strictly disallowed')
      }
      ;(globalThis as any).Function = function () {
        functionConstructorCount++
        throw new Error('CSP Security Error: new Function() is strictly disallowed')
      }

      // Import the compiled guard
      const guardsMod = await import(guardsEntry)
      expect(typeof guardsMod.isNativeRpcRequest).toBe('function')

      // Positive payload acceptance
      const validPayload = {
        id: 'msg-42',
        method: 'session.hello',
      }
      const isValid = guardsMod.isNativeRpcRequest(validPayload)
      expect(isValid).toBe(true)

      // Negative malformed payload rejection
      const invalidPayload = {
        id: 'msg-42',
        method: 'nonexistent.unknown.method',
      }
      const isInvalid = guardsMod.isNativeRpcRequest(invalidPayload)
      expect(isInvalid).toBe(false)

      // Zero trapped calls occurred
      expect(evalInvocationCount).toBe(0)
      expect(functionConstructorCount).toBe(0)
    } finally {
      ;(globalThis as any).eval = origEval
      ;(globalThis as any).Function = origFunction
    }
  })

  // =========================================================================
  // T4-06: Clean Git Clone Fresh-Start Build
  // =========================================================================
  it('T4-06: Clean Git Clone Fresh-Start Build', async () => {
    // Fresh isolated fixture with no .turbo, no dist, no pre-existing caches
    expect(fsSync.existsSync(path.join(fixture.rootDir, 'dist'))).toBe(false)
    expect(fsSync.existsSync(path.join(fixture.rootDir, '.turbo'))).toBe(false)

    // Symlink codegen node_modules so dependencies (zod) resolve in fresh fixture
    const codegenNodeModules = path.resolve(__dirname, '../../../node_modules')
    if (fsSync.existsSync(codegenNodeModules)) {
      try {
        await fs.symlink(codegenNodeModules, path.join(fixture.rootDir, 'node_modules'), 'junction')
      } catch {
        // ignore
      }
    }

    await fixture.writeFile(
      'package.json',
      JSON.stringify(
        {
          name: 'fresh-clone-app',
          type: 'module',
          private: true,
        },
        null,
        2
      )
    )

    await fixture.writeFile(
      'schemas/inventory.ts',
      `import { z } from 'zod';
export const StockItem = z.object({
  sku: z.string().min(3),
  quantity: z.number().int().min(0),
  warehouse: z.string(),
});
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'inventory-bundle',
      profile: 'component-bundle',
      schemaEntry: './schemas/inventory.ts',
      outDir: './artifacts/specs',
      title: 'Inventory Component Bundle',
      version: '1.0.0',
    },
  ],
  guards: {
    outDir: 'dist/guards',
    split: true,
    moduleFormat: 'esm',
    auditCsp: true,
  },
};
`
    )

    // Execute generate from fresh clone state
    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    if (genResult.status !== 0) {
      console.error('T4-06 FAILED with stderr:', genResult.stderr, 'stdout:', genResult.stdout)
    }
    expect(genResult.status).toBe(0)
    expect(genResult.stdout).toContain('Inventory Component Bundle')
    expect(genResult.stdout).toContain('Guards Generated:')

    // Verify all generated outputs exist
    const specOut = path.join(fixture.rootDir, 'artifacts/specs/inventory-bundle.openapi.json')
    const jsonSchemaOut = path.join(fixture.rootDir, 'artifacts/specs/inventory-bundle.schema.json')
    const guardsOut = path.join(fixture.rootDir, 'dist/guards/index.js')

    expect(fsSync.existsSync(specOut)).toBe(true)
    expect(fsSync.existsSync(jsonSchemaOut)).toBe(true)
    expect(fsSync.existsSync(guardsOut)).toBe(true)

    // Verify generated spec contains hash
    const spec = JSON.parse(await fs.readFile(specOut, 'utf8'))
    expect(spec['x-schema-engine-version-hash']).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  // =========================================================================
  // T4-07: Downstream Package Monorepo Linking Resilience
  // =========================================================================
  it.skipIf(!fsSync.existsSync(browserStudioRoot))('T4-07: Downstream Package Monorepo Linking Resilience', async () => {
    const bsPkgPath = path.join(browserStudioRoot, 'package.json')
    const bsPkg = JSON.parse(await fs.readFile(bsPkgPath, 'utf8'))

    // Verify package.json declares correct relative link or published dependency to @oa-sdk/codegen
    expect(bsPkg.devDependencies['@oa-sdk/codegen']).toMatch(
      /^(?:link:\.\.\/oa-sdk\/packages\/codegen|\^?0\.8\.)/
    )
    expect(bsPkg.devDependencies['@oa-sdk/openapi-projection-contract']).toMatch(
      /^(?:link:\.\.\/oa-sdk\/packages\/openapi-projection-contract|\^?0\.2\.)/
    )
    expect(bsPkg.devDependencies['@oa-sdk/parser']).toMatch(
      /^(?:link:\.\.\/oa-sdk\/packages\/parser|\^?0\.3\.)/
    )

    // Verify defineConfig can be dynamically imported from @oa-sdk/codegen
    const codegen = await import('@oa-sdk/codegen')
    expect(typeof codegen.defineConfig).toBe('function')

    const sampleConfig = codegen.defineConfig({
      rootDir: '.',
      specs: [],
    })
    expect(sampleConfig.rootDir).toBe('.')

    // Verify core findProjectRoot utility resolution
    const root = findProjectRoot(browserStudioRoot)
    expect(root).toBe(browserStudioRoot)
  })

  // =========================================================================
  // T4-08: Complete Release Packaging & CSP Audit Gate
  // =========================================================================
  it.skipIf(!fsSync.existsSync(browserStudioRoot))('T4-08: Complete Release Packaging & CSP Audit Gate', async () => {
    const guardsDir = path.join(browserStudioRoot, 'dist/guards')
    expect(fsSync.existsSync(guardsDir)).toBe(true)

    // 1. Audit entire bundle via public auditCspBundle function
    const auditResult = await auditCspBundle(guardsDir)
    expect(auditResult.valid).toBe(true)
    expect(auditResult.violations).toHaveLength(0)

    // 2. Audit every single .js file in dist/guards to ensure zero prohibited imports or eval
    const files = await fs.readdir(guardsDir)
    const jsFiles = files.filter(f => f.endsWith('.js'))
    expect(jsFiles.length).toBeGreaterThan(0)

    for (const jsFile of jsFiles) {
      const filePath = path.join(guardsDir, jsFile)
      const code = await fs.readFile(filePath, 'utf8')

      // Zero eval or Function
      expect(code).not.toMatch(/\beval\s*\(/)
      expect(code).not.toMatch(/\bnew\s+Function\s*\(/)

      // Zero runtime imports of disallowed libraries
      expect(code).not.toMatch(/from\s+['"](?:ajv|zod|@oa-sdk)/)
      expect(code).not.toMatch(/require\s*\(\s*['"](?:ajv|zod|@oa-sdk)/)
    }

    // 3. TypeScript declaration index exists
    expect(files).toContain('index.d.ts')
    const dtsContent = await fs.readFile(path.join(guardsDir, 'index.d.ts'), 'utf8')
    expect(dtsContent.length).toBeGreaterThan(0)

    // 4. CLI Spec verification passed
    const cliSpecResult = runOaCli(['--help'])
    expect(cliSpecResult.status).toBe(0)
    expect(cliSpecResult.stdout).toContain('oa-gen')
  })
})
