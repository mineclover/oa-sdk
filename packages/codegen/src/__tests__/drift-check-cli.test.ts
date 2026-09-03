import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

describe('oa-gen check-artifact and drift:check CLI Test Suite', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'drift-cli-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  async function setupBasicWorkspace() {
    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: [
    {
      id: 'test-spec',
      profile: 'component-bundle',
      schemaEntry: './schemas/test.ts',
      outDir: './artifacts/specs',
    },
  ],
};
`,
    )
    await fixture.writeFile(
      'schemas/test.ts',
      `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  count: z.number(),
});
`,
    )
    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)
  }

  describe('Suite 1: Config-Driven Spec Freshness Verification', () => {
    it('passes with exit code 0 when all committed artifacts match source schemas', async () => {
      await setupBasicWorkspace()

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(0)
      expect(checkResult.stdout).toContain('🟢 FRESH')
      expect(checkResult.stdout).toContain('All 1 spec artifacts are fresh')

      const driftResult = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(driftResult.status).toBe(0)
      expect(driftResult.stdout).toContain('🟢 FRESH')
    })
  })

  describe('Suite 2: Spec Mutation Drift Detection', () => {
    it('detects drift and exits with code 1 when a source schema is modified', async () => {
      await setupBasicWorkspace()

      // Mutate source schema by adding a new field
      await fixture.writeFile(
        'schemas/test.ts',
        `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  count: z.number(),
  description: z.string().optional(),
});
`,
      )

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 DRIFT DETECTED')
      expect(checkResult.stdout).toContain('Projected:')
      expect(checkResult.stdout).toContain('Committed:')

      const driftResult = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(driftResult.status).toBe(1)
      expect(driftResult.stdout).toContain('🔴 DRIFT DETECTED')
    })
  })

  describe('Suite 3: Missing Committed Artifact', () => {
    it('exits with code 1 when a committed artifact is deleted from disk', async () => {
      await setupBasicWorkspace()

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.unlink(artifactPath)

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 MISSING')
    })
  })

  describe('Suite 4: Empty (0-Byte) or Corrupt Artifact', () => {
    it('exits with code 1 when an artifact is 0 bytes', async () => {
      await setupBasicWorkspace()

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(artifactPath, '')

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 CORRUPT')
    })

    it('exits with code 1 when artifact contains invalid JSON', async () => {
      await setupBasicWorkspace()

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(artifactPath, 'not-valid-json{[[')

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 CORRUPT')
    })
  })

  describe('Suite 5: Single-Target Manual Invocation Mode', () => {
    it('verifies freshness via explicit --artifact and --schema flags', async () => {
      await setupBasicWorkspace()

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      const schemaPath = path.join(fixture.rootDir, 'schemas/test.ts')

      const checkResult = runOaCli(
        ['check-artifact', '--schema', schemaPath, '--artifact', artifactPath],
        { cwd: fixture.rootDir },
      )
      expect(checkResult.status).toBe(0)
      expect(checkResult.stdout).toContain('fresh')

      // Mutate schema
      await fixture.writeFile(
        'schemas/test.ts',
        `import { z } from 'zod';
export const Item = z.object({
  id: z.string(),
  mutatedField: z.boolean(),
});
`,
      )

      const staleResult = runOaCli(
        ['check-artifact', '--schema', schemaPath, '--artifact', artifactPath],
        { cwd: fixture.rootDir },
      )
      expect(staleResult.status).toBe(1)
      expect(staleResult.stdout).toContain('stale')
    })

    it('preserves legacy --head and --artifact flags for OpenAPI specs', async () => {
      const specA = path.join(fixture.rootDir, 'specA.json')
      const specB = path.join(fixture.rootDir, 'specB.json')

      const doc = {
        openapi: '3.1.0',
        info: { title: 'Legacy', version: '1.0.0' },
        paths: {},
      }
      await fs.writeFile(specA, JSON.stringify(doc))
      await fs.writeFile(specB, JSON.stringify(doc))

      const checkResult = runOaCli(
        ['check-artifact', '--head', specA, '--artifact', specB],
        { cwd: fixture.rootDir },
      )
      expect(checkResult.status).toBe(0)
      expect(checkResult.stdout).toContain('fresh')
    })
  })

  describe('Suite 6: JSON Output Format Conformance', () => {
    it('emits schema-conforming JSON payload with --format json', async () => {
      await setupBasicWorkspace()

      const result = runOaCli(['check-artifact', '--format', 'json'], { cwd: fixture.rootDir })
      expect(result.status).toBe(0)

      const parsed = JSON.parse(result.stdout)
      expect(parsed.schemaVersion).toBe('oa-gen.artifact-freshness.v1')
      expect(parsed.fresh).toBe(true)
      expect(Array.isArray(parsed.targets)).toBe(true)
      expect(parsed.targets).toHaveLength(1)
      expect(parsed.targets[0].status).toBe('fresh')
      expect(parsed.targets[0].projectedHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })
  })

  describe('Suite 7: Global --root Subdirectory Execution', () => {
    it('discovers project root and succeeds when invoked from a nested subdirectory', async () => {
      await setupBasicWorkspace()

      const subDir = path.join(fixture.rootDir, 'packages/nested')
      await fs.mkdir(subDir, { recursive: true })

      const result = runOaCli(['check-artifact', '--root', fixture.rootDir], { cwd: subDir })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('🟢 FRESH')
    })
  })

  describe('Suite 8: CLI Alias Parity', () => {
    it('drift:check and check-artifact exhibit equivalent behavior and help output', async () => {
      const helpCheck = runOaCli(['check-artifact', '--help'])
      const helpDrift = runOaCli(['drift:check', '--help'])

      expect(helpCheck.status).toBe(0)
      expect(helpDrift.status).toBe(0)
      expect(helpCheck.stdout).toContain('--artifact')
      expect(helpDrift.stdout).toContain('--artifact')
      expect(helpCheck.stdout).toContain('--schema')
      expect(helpDrift.stdout).toContain('--schema')
    })
  })
})
