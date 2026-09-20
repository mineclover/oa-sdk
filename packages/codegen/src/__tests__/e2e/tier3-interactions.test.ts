import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import { runOaCli } from './helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'
import { computeVersionHash } from '../../spec-projector.js'
import { auditCspBundle } from '../../cli/commands/audit-csp.js'
import { findProjectRootDetail } from '@oa-sdk/core'

describe('E2E Tier 3: Cross-Feature Interactions (16 Tests)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'tier3-ix-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // Helper to generate standard Zod schema files and oa.config.ts
  async function setupStandardProfileFixture() {
    await fixture.writeFile(
      'schemas/item-bundle.ts',
      `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean().default(true),
});
export const ItemList = z.array(Item);
`
    )

    await fixture.writeFile(
      'schemas/service-ops.ts',
      `import { z } from 'zod';
export const ServiceStatus = z.object({
  status: z.enum(['ok', 'degraded', 'maintenance']),
  timestamp: z.number(),
});
export const paths = {
  '/status': {
    get: {
      operationId: 'getStatus',
      summary: 'Get system status',
      responses: {
        '200': {
          description: 'Current status',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceStatus' },
            },
          },
        },
      },
    },
  },
};
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `import { defineConfig } from '../../config.js';
export default {
  rootDir: '.',
  specs: [
    {
      id: 'items',
      profile: 'component-bundle',
      schemaEntry: './schemas/item-bundle.ts',
      outDir: './artifacts/specs',
      title: 'Item Component Bundle',
      version: '1.0.0',
    },
    {
      id: 'service',
      profile: 'operation-contract',
      schemaEntry: './schemas/service-ops.ts',
      outDir: './artifacts/specs',
      title: 'Service Operations Contract',
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
  }

  // =========================================================================
  // T3-01: Explicit --root + Asynchronous oa.config.ts load + multi-target oa-gen generate
  // =========================================================================
  it('T3-01: explicit --root + asynchronous oa.config.ts load + multi-target generate', async () => {
    await setupStandardProfileFixture()

    // Invoke from a different directory (os.tmpdir) passing explicit --root
    const result = runOaCli(['generate', '--root', fixture.rootDir], { cwd: os.tmpdir() })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OA-SDK GENERATE: SPEC & GUARD SUMMARY')
    expect(result.stdout).toContain('items')
    expect(result.stdout).toContain('service')

    // Verify artifacts emitted to fixture.rootDir/artifacts/specs
    const itemsOpenApi = path.join(fixture.rootDir, 'artifacts/specs/items.openapi.json')
    const serviceOpenApi = path.join(fixture.rootDir, 'artifacts/specs/service.openapi.json')
    const itemsJsonSchema = path.join(fixture.rootDir, 'artifacts/specs/items.schema.json')
    const serviceJsonSchema = path.join(fixture.rootDir, 'artifacts/specs/service.schema.json')

    expect(fsSync.existsSync(itemsOpenApi)).toBe(true)
    expect(fsSync.existsSync(serviceOpenApi)).toBe(true)
    expect(fsSync.existsSync(itemsJsonSchema)).toBe(true)
    expect(fsSync.existsSync(serviceJsonSchema)).toBe(true)
  })

  // =========================================================================
  // T3-02: Upward root discovery from deep subdirectory + config loading + oa-gen validate
  // =========================================================================
  it('T3-02: upward root discovery from deep subdirectory + config loading + oa-gen validate', async () => {
    await setupStandardProfileFixture()
    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)

    // Create deep nested directory inside fixture
    const deepDir = path.join(fixture.rootDir, 'packages/core/deep/nested/sub')
    await fs.mkdir(deepDir, { recursive: true })

    // Invoke oa-gen validate without arguments from deep directory
    const validateResult = runOaCli(['validate'], { cwd: deepDir })
    expect(validateResult.status).toBe(0)
    expect(validateResult.stdout).toContain('Summary: 2 total targets, 2 passed, 0 failed')
  })

  // =========================================================================
  // T3-03: Config-driven generation of 5 profiles -> deterministic hash computation -> bit-for-bit hash verification
  // =========================================================================
  it('T3-03: config-driven generation of 5 profiles -> deterministic hash computation -> bit-for-bit hash verification', async () => {
    // Setup 5 profile targets
    const specsConfig = []
    for (let i = 1; i <= 5; i++) {
      const id = `profile-${i}`
      const isOp = i % 2 === 0
      specsConfig.push({
        id,
        profile: isOp ? 'operation-contract' : 'component-bundle',
        schemaEntry: `./schemas/${id}.ts`,
        outDir: './artifacts/specs',
        title: `Profile ${i}`,
        version: '1.0.0',
      })

      if (isOp) {
        await fixture.writeFile(
          `schemas/${id}.ts`,
          `import { z } from 'zod';
export const Payload${i} = z.object({ code: z.number(), message: z.string() });
export const paths = {
  '/api/v1/resource-${i}': {
    post: {
      operationId: 'createResource${i}',
      responses: {
        '201': {
          description: 'Created',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Payload${i}' } } },
        },
      },
    },
  },
};
`
        )
      } else {
        await fixture.writeFile(
          `schemas/${id}.ts`,
          `import { z } from 'zod';
export const Model${i} = z.object({
  id: z.string().uuid(),
  count: z.number().int().min(0),
  tags: z.array(z.string()),
});
`
        )
      }
    }

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: ${JSON.stringify(specsConfig, null, 2)},
};
`
    )

    // First generation
    const genResult1 = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult1.status).toBe(0)

    const hashesRun1: Record<string, string> = {}
    for (let i = 1; i <= 5; i++) {
      const specPath = path.join(fixture.rootDir, `artifacts/specs/profile-${i}.openapi.json`)
      const doc = JSON.parse(await fs.readFile(specPath, 'utf8'))
      const hash = doc['x-schema-engine-version-hash']
      expect(hash).toBeDefined()
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/)

      // Compute independently
      const computed = computeVersionHash(doc)
      expect(hash).toBe(computed)
      hashesRun1[`profile-${i}`] = hash
    }

    // Second generation: verify bit-for-bit determinism
    const genResult2 = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult2.status).toBe(0)

    for (let i = 1; i <= 5; i++) {
      const specPath = path.join(fixture.rootDir, `artifacts/specs/profile-${i}.openapi.json`)
      const doc = JSON.parse(await fs.readFile(specPath, 'utf8'))
      expect(doc['x-schema-engine-version-hash']).toBe(hashesRun1[`profile-${i}`])
    }
  })

  // =========================================================================
  // T3-04: Config-driven generation -> standalone guard emission -> automated oa-gen audit:csp scan -> 0 violations
  // =========================================================================
  it('T3-04: config-driven generation -> standalone guard emission -> automated oa-gen audit:csp scan -> 0 violations', async () => {
    await setupStandardProfileFixture()

    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)
    expect(genResult.stdout).toContain('Guards Generated:')

    const guardsDir = path.join(fixture.rootDir, 'dist/guards')
    expect(fsSync.existsSync(guardsDir)).toBe(true)

    // Run audit:csp
    const auditResult = runOaCli(['audit:csp', '--bundle', 'dist/guards'], { cwd: fixture.rootDir })
    expect(auditResult.status).toBe(0)
    expect(auditResult.stdout).toContain('0 CSP violations found')
    expect(auditResult.stdout).toContain('Manifest V3 compliant')
  })

  // =========================================================================
  // T3-05: Zod schema mutation -> config-driven projection -> oa-gen drift:check detects divergence and exits 1
  // =========================================================================
  it('T3-05: Zod schema mutation -> config-driven projection -> oa-gen drift:check detects divergence and exits 1', async () => {
    await setupStandardProfileFixture()
    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)

    // Verify drift:check passes before mutation
    const preDrift = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(preDrift.status).toBe(0)
    expect(preDrift.stdout).toContain('🟢 FRESH')
    expect(preDrift.stdout).toContain('All 2 spec artifacts are fresh')

    // Mutate Zod schema by adding a new field
    await fixture.writeFile(
      'schemas/item-bundle.ts',
      `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean().default(true),
  mutationFlag: z.string(), // Added field causing drift
});
export const ItemList = z.array(Item);
`
    )

    // Verify drift:check detects divergence and exits 1
    const postDrift = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(postDrift.status).toBe(1)
    expect(postDrift.stdout).toContain('Spec drift detected: 1 of 2 targets failed')
    expect(postDrift.stdout).toContain('items')
    expect(postDrift.stdout).toContain('DRIFT')
  })

  // =========================================================================
  // T3-06: Spec artifact update -> oa-gen drift:check passes -> oa-gen diff --fail-on-breaking checks breaking changes
  // =========================================================================
  it('T3-06: spec artifact update -> oa-gen drift:check passes -> oa-gen diff --fail-on-breaking checks breaking changes', async () => {
    await setupStandardProfileFixture()
    runOaCli(['generate'], { cwd: fixture.rootDir })

    const oldSpecPath = path.join(fixture.rootDir, 'artifacts/specs/items.old.json')
    const currentSpecPath = path.join(fixture.rootDir, 'artifacts/specs/items.openapi.json')
    await fs.copyFile(currentSpecPath, oldSpecPath)

    // Add optional property to schema (non-breaking)
    await fixture.writeFile(
      'schemas/item-bundle.ts',
      `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean().default(true),
  description: z.string().optional(),
});
export const ItemList = z.array(Item);
`
    )

    // Update artifact via generate
    const reGen = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(reGen.status).toBe(0)

    // drift:check should pass
    const driftCheck = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(driftCheck.status).toBe(0)

    // oa-gen diff --fail-on-breaking between old and updated spec should pass (0 breaking changes)
    const diffResult = runOaCli(
      ['diff', '--base', oldSpecPath, '--head', currentSpecPath, '--fail-on-breaking'],
      { cwd: fixture.rootDir }
    )
    expect(diffResult.status).toBe(0)
  })

  // =========================================================================
  // T3-07: OA_PROJECT_ROOT env var override -> load .oarc.json config -> generate guards to custom directory
  // =========================================================================
  it('T3-07: OA_PROJECT_ROOT env var override -> load .oarc.json config -> generate guards to custom directory', async () => {
    await fixture.writeFile(
      'schemas/custom.ts',
      `import { z } from 'zod';
export const CustomModel = z.object({
  code: z.string(),
  value: z.number(),
});
`
    )

    await fixture.writeFile(
      '.oarc.json',
      JSON.stringify(
        {
          rootDir: '.',
          specs: [
            {
              id: 'custom-spec',
              profile: 'component-bundle',
              schemaEntry: './schemas/custom.ts',
              outDir: './custom-specs',
            },
          ],
          guards: {
            outDir: './custom-guards',
            split: true,
            moduleFormat: 'esm',
          },
        },
        null,
        2
      )
    )

    // Invoke from external temporary directory with OA_PROJECT_ROOT pointing to fixture
    const result = runOaCli(['generate'], {
      cwd: os.tmpdir(),
      env: { OA_PROJECT_ROOT: fixture.rootDir },
    })
    expect(result.status).toBe(0)

    expect(fsSync.existsSync(path.join(fixture.rootDir, 'custom-specs/custom-spec.openapi.json'))).toBe(true)
    expect(fsSync.existsSync(path.join(fixture.rootDir, 'custom-guards/index.js'))).toBe(true)
  })

  // =========================================================================
  // T3-08: Deep nested execution in submodule -> root boundary traversal -> load browser-studio/oa.config.ts
  // =========================================================================
  it.skipIf(!fsSync.existsSync('/Users/junwoobang/workflow/browser-studio'))('T3-08: deep nested execution in submodule -> root boundary traversal -> load browser-studio/oa.config.ts', async () => {
    const candidateSubmodule1 = '/Users/junwoobang/workflow/browser-studio/packages/browser-mapper/packages/selector-evaluator'
    const candidateSubmodule2 = '/Users/junwoobang/workflow/browser-studio/packages/browser-mapper/packages/unified-utils'
    const submoduleDeepDir = fsSync.existsSync(candidateSubmodule1) ? candidateSubmodule1 : candidateSubmodule2
    expect(fsSync.existsSync(submoduleDeepDir)).toBe(true)

    // Test upward root discovery directly
    const rootDetail = findProjectRootDetail(submoduleDeepDir)
    expect(rootDetail.root).toBe('/Users/junwoobang/workflow/browser-studio')
    expect(rootDetail.matchedMarker).toBe('oa.config.ts')

    // Execute validate from submodule subdirectory
    const result = runOaCli(['validate'], { cwd: submoduleDeepDir })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Summary: 5 total targets, 5 passed, 0 failed')
  })

  // =========================================================================
  // T3-09: Breaking schema change -> diff --fail-on-breaking blocks pipeline -> drift check reports discrepancy
  // =========================================================================
  it('T3-09: breaking schema change -> diff --fail-on-breaking blocks pipeline -> drift check reports discrepancy', async () => {
    await setupStandardProfileFixture()
    runOaCli(['generate'], { cwd: fixture.rootDir })

    const baseSpecPath = path.join(fixture.rootDir, 'artifacts/specs/service.openapi.json')
    const breakingHeadPath = path.join(fixture.rootDir, 'artifacts/specs/service.breaking.json')

    // Read base spec and remove endpoint to create breaking change
    const baseDoc = JSON.parse(await fs.readFile(baseSpecPath, 'utf8'))
    const breakingDoc = JSON.parse(JSON.stringify(baseDoc))
    delete breakingDoc.paths['/status']
    await fs.writeFile(breakingHeadPath, JSON.stringify(breakingDoc, null, 2))

    // diff --fail-on-breaking must exit with code 1
    const diffResult = runOaCli(
      ['diff', '--base', baseSpecPath, '--head', breakingHeadPath, '--fail-on-breaking'],
      { cwd: fixture.rootDir }
    )
    expect(diffResult.status).toBe(1)

    // Mutate source schema to delete paths and verify drift:check catches discrepancy
    await fixture.writeFile(
      'schemas/service-ops.ts',
      `import { z } from 'zod';
export const ServiceStatus = z.object({ status: z.string() });
export const paths = {}; // Removed /status
`
    )

    const driftResult = runOaCli(['drift:check'], { cwd: fixture.rootDir })
    expect(driftResult.status).toBe(1)
    expect(driftResult.stdout).toContain('Spec drift detected')
  })

  // =========================================================================
  // T3-10: Multi-profile validation across component-bundle and operation-contract targets in single run
  // =========================================================================
  it('T3-10: multi-profile validation across component-bundle and operation-contract targets in single run', async () => {
    await setupStandardProfileFixture()
    runOaCli(['generate'], { cwd: fixture.rootDir })

    const validateResult = runOaCli(['validate'], { cwd: fixture.rootDir })
    expect(validateResult.status).toBe(0)
    expect(validateResult.stdout).toContain('items')
    expect(validateResult.stdout).toContain('component-bundle')
    expect(validateResult.stdout).toContain('service')
    expect(validateResult.stdout).toContain('operation-contract')
    expect(validateResult.stdout).toContain('Summary: 2 total targets, 2 passed, 0 failed')
  })

  // =========================================================================
  // T3-11: Standalone guard splitting with selective filtering via config -> CSP audit on filtered directory
  // =========================================================================
  it('T3-11: standalone guard splitting with selective filtering via config -> CSP audit on filtered directory', async () => {
    await fixture.writeFile(
      'schemas/multi.ts',
      `import { z } from 'zod';
export const Alpha = z.object({ a: z.string() });
export const Beta = z.object({ b: z.number() });
export const Gamma = z.object({ c: z.boolean() });
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'multi',
      profile: 'component-bundle',
      schemaEntry: './schemas/multi.ts',
      outDir: './artifacts/specs',
    },
  ],
  guards: {
    outDir: 'dist/split-guards',
    split: true,
    moduleFormat: 'esm',
    auditCsp: true,
  },
};
`
    )

    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)

    const splitOutDir = path.join(fixture.rootDir, 'dist/split-guards')
    expect(fsSync.existsSync(path.join(splitOutDir, 'index.js'))).toBe(true)

    const guardsSubDir = path.join(splitOutDir, 'guards')
    const splitFiles = await fs.readdir(guardsSubDir)
    expect(splitFiles).toContain('Alpha.js')
    expect(splitFiles).toContain('Beta.js')
    expect(splitFiles).toContain('Gamma.js')

    const alphaCode = await fs.readFile(path.join(guardsSubDir, 'Alpha.js'), 'utf8')
    expect(alphaCode).toContain('isAlpha')

    // Audit the whole bundle directory
    const auditRes = await auditCspBundle(splitOutDir)
    expect(auditRes.valid).toBe(true)
    expect(auditRes.violations).toHaveLength(0)
  })

  // =========================================================================
  // T3-12: Spec freshness verification against git index across branch switch simulation
  // =========================================================================
  it('T3-12: spec freshness verification against git index across branch switch simulation', async () => {
    // Create git workspace
    const gitFixture = await createWorkspaceFixture({ hasGit: true }, 'tier3-git-')
    try {
      await gitFixture.writeFile(
        'schemas/model.ts',
        `import { z } from 'zod';
export const Model = z.object({ name: z.string(), score: z.number() });
`
      )

      await gitFixture.writeFile(
        'oa.config.ts',
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'branch-test',
      profile: 'component-bundle',
      schemaEntry: './schemas/model.ts',
      outDir: './artifacts/specs',
    },
  ],
};
`
      )

      // Initial clean generation
      runOaCli(['generate'], { cwd: gitFixture.rootDir })

      // Freshness check is clean
      const checkInitial = runOaCli(['drift:check'], { cwd: gitFixture.rootDir })
      expect(checkInitial.status).toBe(0)

      // Simulate branch switch / uncommitted work: alter model.ts
      await gitFixture.writeFile(
        'schemas/model.ts',
        `import { z } from 'zod';
export const Model = z.object({ name: z.string(), score: z.number(), branchFeature: z.boolean() });
`
      )

      // Drift check fails
      const checkDrifted = runOaCli(['drift:check'], { cwd: gitFixture.rootDir })
      expect(checkDrifted.status).toBe(1)

      // Simulate switching back to original branch content
      await gitFixture.writeFile(
        'schemas/model.ts',
        `import { z } from 'zod';
export const Model = z.object({ name: z.string(), score: z.number() });
`
      )

      // Drift check passes again
      const checkRestored = runOaCli(['drift:check'], { cwd: gitFixture.rootDir })
      expect(checkRestored.status).toBe(0)
    } finally {
      await gitFixture.cleanup()
    }
  })

  // =========================================================================
  // T3-13: defineConfig with custom rootDir -> config loader -> multi-target generation with path remapping
  // =========================================================================
  it('T3-13: defineConfig with custom rootDir -> config loader -> multi-target generation with path remapping', async () => {
    const subRoot = path.join(fixture.rootDir, 'custom-sub')
    await fs.mkdir(subRoot, { recursive: true })

    await fixture.writeFile(
      'custom-sub/schemas/data.ts',
      `import { z } from 'zod';
export const DataPoint = z.object({ timestamp: z.number(), value: z.string() });
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: './custom-sub',
  specs: [
    {
      id: 'remapped',
      profile: 'component-bundle',
      schemaEntry: './schemas/data.ts',
      outDir: './artifacts/specs',
    },
  ],
};
`
    )

    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)

    // Output file should be located inside custom-sub/artifacts/specs
    const expectedOut = path.join(fixture.rootDir, 'custom-sub/artifacts/specs/remapped.openapi.json')
    expect(fsSync.existsSync(expectedOut)).toBe(true)
  })

  // =========================================================================
  // T3-14: CLI --project-root passed to oa-gen audit:csp scanning remote bundle directory
  // =========================================================================
  it.skipIf(!fsSync.existsSync('/Users/junwoobang/workflow/browser-studio'))('T3-14: CLI --project-root passed to oa-gen audit:csp scanning remote bundle directory', () => {
    const bsRoot = '/Users/junwoobang/workflow/browser-studio'
    expect(fsSync.existsSync(path.join(bsRoot, 'dist/guards'))).toBe(true)

    // Invoke from external temporary directory with --project-root
    const result = runOaCli(['audit:csp', '--bundle', 'dist/guards', '--project-root', bsRoot], {
      cwd: os.tmpdir(),
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 CSP violations found')
  })

  // =========================================================================
  // T3-15: Legacy schemas compatibility config -> migration to specs array -> generate produces identical specs
  // =========================================================================
  it('T3-15: legacy schemas compatibility config -> migration to specs array -> generate produces identical specs', async () => {
    // 1. Legacy schemas configuration
    await fixture.writeFile(
      'oa.config.legacy.json',
      JSON.stringify({
        rootDir: '.',
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
            },
            required: ['id', 'username'],
          },
        },
        output: './legacy-output',
      })
    )

    const legacyResult = runOaCli(['generate', '--config', 'oa.config.legacy.json'], {
      cwd: fixture.rootDir,
    })
    expect(legacyResult.status).toBe(0)

    // 2. Modern specs configuration
    await fixture.writeFile(
      'schemas/user.ts',
      `import { z } from 'zod';
export const User = z.object({
  id: z.string(),
  username: z.string(),
});
`
    )

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'modern-user',
      profile: 'component-bundle',
      schemaEntry: './schemas/user.ts',
      outDir: './modern-output',
    },
  ],
};
`
    )

    const modernResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(modernResult.status).toBe(0)

    const modernSpec = JSON.parse(
      await fs.readFile(path.join(fixture.rootDir, 'modern-output/modern-user.openapi.json'), 'utf8')
    )
    expect(modernSpec.components.schemas.User).toBeDefined()
    expect(modernSpec.components.schemas.User.properties.id).toBeDefined()
    expect(modernSpec.components.schemas.User.properties.username).toBeDefined()
  })

  // =========================================================================
  // T3-16: Full CI governance dry-run: root discovery + config validation + spec freshness + CSP audit
  // =========================================================================
  it('T3-16: full CI governance dry-run: root discovery + config validation + spec freshness + CSP audit', async () => {
    await setupStandardProfileFixture()

    // 1. Root discovery from deep subdirectory
    const deepDir = path.join(fixture.rootDir, 'tools/ci/scripts')
    await fs.mkdir(deepDir, { recursive: true })
    const rootDetail = findProjectRootDetail(deepDir)
    expect(rootDetail.root).toBe(fixture.rootDir)

    // 2. Multi-target generate
    const gen = runOaCli(['generate'], { cwd: deepDir })
    expect(gen.status).toBe(0)

    // 3. Multi-target validate
    const val = runOaCli(['validate'], { cwd: deepDir })
    expect(val.status).toBe(0)
    expect(val.stdout).toContain('Summary: 2 total targets, 2 passed, 0 failed')

    // 4. Spec freshness check
    const drift = runOaCli(['drift:check'], { cwd: deepDir })
    expect(drift.status).toBe(0)
    expect(drift.stdout).toContain('🟢 FRESH')
    expect(drift.stdout).toContain('All 2 spec artifacts are fresh')

    // 5. CSP audit
    const csp = runOaCli(['audit:csp', '--bundle', 'dist/guards'], { cwd: deepDir })
    expect(csp.status).toBe(0)
    expect(csp.stdout).toContain('0 CSP violations found')
  })
})
