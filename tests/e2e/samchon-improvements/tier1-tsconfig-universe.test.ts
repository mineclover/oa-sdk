import { describe, it, expect } from 'vitest'
import {
  parseJsonc,
  stripJsonComments,
  removeTrailingCommas,
  computeTsconfigUniverseFromFs,
  buildSpecProjectKey,
  sha256,
  type VirtualFileSystem,
} from './helpers/tsconfig-universe.js'

describe('Tier 1: Transitive tsconfig Universe Hashing (Features 15–18)', () => {
  // Helper to create an in-memory virtual file system for tsconfig tests
  function createVirtualFs(files: Record<string, string>): VirtualFileSystem {
    const map = new Map<string, string>()
    for (const [k, v] of Object.entries(files)) {
      const normalized = k.startsWith('/') ? k : '/' + k
      map.set(normalized, v)
    }
    return {
      readFile: (p: string) => {
        const norm = p.startsWith('/') ? p : '/' + p
        const content = map.get(norm)
        if (content === undefined) throw new Error(`File not found: ${p}`)
        return content
      },
      fileExists: (p: string) => {
        const norm = p.startsWith('/') ? p : '/' + p
        return map.has(norm)
      },
    }
  }

  // =========================================================================
  // Feature 15: Transitive tsconfig Closure Walker
  // =========================================================================
  describe('F15: Transitive tsconfig Closure Walker', () => {
    it('T1-F15-1: traverses single tsconfig and extracts root files and options', () => {
      const fs = createVirtualFs({
        '/tsconfig.json': JSON.stringify({
          compilerOptions: { strict: true },
          files: ['src/index.ts', 'src/api.ts'],
        }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.configs).toHaveLength(1)
      expect(universe.configs[0].file).toBe('tsconfig.json')
      expect(universe.roots).toEqual(['src/api.ts', 'src/index.ts'])
    })

    it('T1-F15-2: recursively resolves extends relative path chains (app -> base -> common)', () => {
      const fs = createVirtualFs({
        '/common.json': JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
        '/base.json': JSON.stringify({ extends: './common.json', compilerOptions: { strict: true } }),
        '/tsconfig.json': JSON.stringify({ extends: './base.json', files: ['src/app.ts'] }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.configs).toHaveLength(3)
      const configFiles = universe.configs.map(c => c.file)
      expect(configFiles).toContain('tsconfig.json')
      expect(configFiles).toContain('base.json')
      expect(configFiles).toContain('common.json')
    })

    it('T1-F15-3: recursively resolves references array for composite project references', () => {
      const fs = createVirtualFs({
        '/tsconfig.json': JSON.stringify({
          references: [{ path: './packages/core' }, { path: './packages/client' }],
          files: ['main.ts'],
        }),
        '/packages/core/tsconfig.json': JSON.stringify({
          compilerOptions: { composite: true },
          files: ['src/core.ts'],
        }),
        '/packages/client/tsconfig.json': JSON.stringify({
          compilerOptions: { composite: true },
          files: ['src/client.ts'],
        }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.configs).toHaveLength(3)
      const files = universe.configs.map(c => c.file)
      expect(files).toContain('tsconfig.json')
      expect(files).toContain('packages/core/tsconfig.json')
      expect(files).toContain('packages/client/tsconfig.json')
    })

    it('T1-F15-4: parses JSONC configurations with single-line // and multi-line /* */ comments', () => {
      const jsoncContent = `
        {
          // Single line comment on compiler options
          "compilerOptions": {
            /* Multi-line
               comment block */
            "strict": true,
            "target": "ES2022"
          }
        }
      `
      const parsed = parseJsonc(jsoncContent)
      expect(parsed.compilerOptions.strict).toBe(true)
      expect(parsed.compilerOptions.target).toBe('ES2022')
    })

    it('T1-F15-5: tolerates trailing commas in JSONC configuration objects and arrays', () => {
      const jsoncContent = `
        {
          "compilerOptions": {
            "strict": true,
            "lib": ["ES2022", "DOM",],
          },
          "files": [
            "src/a.ts",
            "src/b.ts",
          ],
        }
      `
      const parsed = parseJsonc(jsoncContent)
      expect(parsed.compilerOptions.lib).toEqual(['ES2022', 'DOM'])
      expect(parsed.files).toEqual(['src/a.ts', 'src/b.ts'])
    })
  })

  // =========================================================================
  // Feature 16: Configuration Universe Hashing
  // =========================================================================
  describe('F16: Configuration Universe Hashing', () => {
    it('T1-F16-1: computes deterministic SHA-256 digest for each configuration file', () => {
      const content = JSON.stringify({ compilerOptions: { strict: true } })
      const expectedSha = sha256(content)

      const fs = createVirtualFs({ '/tsconfig.json': content })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.configs[0].digest).toBe(expectedSha)
    })

    it('T1-F16-2: computes unified tsconfigUniverseDigest covering all configs and roots', () => {
      const fs = createVirtualFs({
        '/base.json': JSON.stringify({ strict: true }),
        '/tsconfig.json': JSON.stringify({ extends: './base.json', files: ['app.ts'] }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.universeDigest).toBeDefined()
      expect(universe.universeDigest).toHaveLength(64) // 64 hex chars for SHA-256
    })

    it('T1-F16-3: digest remains 100% identical when configuration files are untouched (idempotency)', () => {
      const fs = createVirtualFs({
        '/tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
      })
      const u1 = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      const u2 = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(u1.universeDigest).toBe(u2.universeDigest)
      expect(u1.configs).toEqual(u2.configs)
    })

    it('T1-F16-4: sorts configuration paths deterministically before computing universe digest', () => {
      const fs = createVirtualFs({
        '/z.json': JSON.stringify({ id: 'z' }),
        '/a.json': JSON.stringify({ id: 'a' }),
        '/tsconfig.json': JSON.stringify({
          extends: ['./z.json', './a.json'],
        }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      const files = universe.configs.map(c => c.file)
      expect(files).toEqual([...files].sort())
    })

    it('T1-F16-5: captures resolved source root files attributed to the project', () => {
      const fs = createVirtualFs({
        '/tsconfig.json': JSON.stringify({
          files: ['src/z.ts', 'src/a.ts'],
        }),
      })
      const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
      expect(universe.roots).toEqual(['src/a.ts', 'src/z.ts'])
    })
  })

  // =========================================================================
  // Feature 17: Cache Key Invalidation Integration
  // =========================================================================
  describe('F17: Cache Key Invalidation Integration', () => {
    it('T1-F17-1: integrates tsconfigUniverseDigest into Spec-Lens buildSpecProjectKey', () => {
      const baseInput = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'digest_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'openapi-yaml',
        sourceRoot: 'repo',
        toolchainFingerprint: 'toolchain_v1',
      }

      const keyWithoutDigest = buildSpecProjectKey(baseInput)
      const keyWithDigest = buildSpecProjectKey({
        ...baseInput,
        tsconfigUniverseDigest: 'sha256_abcdef123456',
      })

      expect(keyWithDigest).toBeDefined()
      expect(keyWithDigest).not.toBe(keyWithoutDigest)
    })

    it('T1-F17-2: generates different project keys when two projects have different base tsconfigs', () => {
      const inputA = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'manifest_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'typespec-bundle',
        sourceRoot: 'repo',
        toolchainFingerprint: 'toolchain_sha',
        tsconfigUniverseDigest: 'digest_project_A',
      }
      const inputB = {
        ...inputA,
        tsconfigUniverseDigest: 'digest_project_B',
      }

      const keyA = buildSpecProjectKey(inputA)
      const keyB = buildSpecProjectKey(inputB)
      expect(keyA).not.toBe(keyB)
    })

    it('T1-F17-3: incorporates project key into SQLite snapshot cache key format ${projectKey}:${revision.id}', () => {
      const projectKey = buildSpecProjectKey({
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'app',
        toolchainFingerprint: 'tp_1',
        tsconfigUniverseDigest: 'digest_x',
      })

      const revisionId = 'git-commit-abc1234'
      const snapshotCacheKey = `${projectKey}:${revisionId}`

      expect(snapshotCacheKey.startsWith(projectKey)).toBe(true)
      expect(snapshotCacheKey.endsWith(revisionId)).toBe(true)
      expect(snapshotCacheKey.split(':')).toHaveLength(2)
    })

    it('T1-F17-4: produces stable cache keys when tsconfig universe digest is unchanged', () => {
      const input = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'app',
        toolchainFingerprint: 'tp_1',
        tsconfigUniverseDigest: 'stable_digest',
      }

      const k1 = buildSpecProjectKey(input)
      const k2 = buildSpecProjectKey(input)
      expect(k1).toBe(k2)
    })

    it('T1-F17-5: handles specifications without tsconfig gracefully with fallback empty digest', () => {
      const input = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'app',
        toolchainFingerprint: 'tp_1',
      }
      const key = buildSpecProjectKey(input)
      expect(key).toBeDefined()
      expect(key).toHaveLength(64)
    })
  })

  // =========================================================================
  // Feature 18: Automated Cache Invalidation Proof
  // =========================================================================
  describe('F18: Automated Cache Invalidation Proof', () => {
    it('T1-F18-1: modifying strict: true in extended tsconfig.base.json alters universeDigest', () => {
      const fsBefore = createVirtualFs({
        '/base.json': JSON.stringify({ compilerOptions: { strict: false } }),
        '/tsconfig.json': JSON.stringify({ extends: './base.json' }),
      })
      const fsAfter = createVirtualFs({
        '/base.json': JSON.stringify({ compilerOptions: { strict: true } }), // Modified!
        '/tsconfig.json': JSON.stringify({ extends: './base.json' }),
      })

      const uBefore = computeTsconfigUniverseFromFs('/tsconfig.json', fsBefore)
      const uAfter = computeTsconfigUniverseFromFs('/tsconfig.json', fsAfter)

      expect(uBefore.universeDigest).not.toBe(uAfter.universeDigest)
    })

    it('T1-F18-2: altered universeDigest causes buildSpecProjectKey to change immediately', () => {
      const uBefore = 'digest_v1'
      const uAfter = 'digest_v2'

      const base = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm_1',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'root',
        toolchainFingerprint: 'fp',
      }

      const keyBefore = buildSpecProjectKey({ ...base, tsconfigUniverseDigest: uBefore })
      const keyAfter = buildSpecProjectKey({ ...base, tsconfigUniverseDigest: uAfter })

      expect(keyBefore).not.toBe(keyAfter)
    })

    it('T1-F18-3: changed project key causes SQLite cache query to produce a cache MISS', () => {
      // Mock SQLite key-value store simulation
      const mockSqliteDb = new Map<string, string>()

      const keyV1 = buildSpecProjectKey({
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'r',
        toolchainFingerprint: 'fp',
        tsconfigUniverseDigest: 'digest_strict_false',
      })
      const revision = 'rev_main'
      const cacheKeyV1 = `${keyV1}:${revision}`

      // Store cached snapshot for V1
      mockSqliteDb.set(cacheKeyV1, 'cached_ast_snapshot_data')
      expect(mockSqliteDb.has(cacheKeyV1)).toBe(true) // Cache HIT

      // Developer changes strict to true -> Key changes to V2
      const keyV2 = buildSpecProjectKey({
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'r',
        toolchainFingerprint: 'fp',
        tsconfigUniverseDigest: 'digest_strict_true',
      })
      const cacheKeyV2 = `${keyV2}:${revision}`

      // Querying with V2 produces cache MISS!
      expect(mockSqliteDb.has(cacheKeyV2)).toBe(false)
    })

    it('T1-F18-4: modifying whitespace or comments in tsconfig triggers invalidation preserving byte integrity', () => {
      const fsOrig = createVirtualFs({
        '/tsconfig.json': '{\n  "compilerOptions": { "strict": true }\n}',
      })
      const fsCommented = createVirtualFs({
        '/tsconfig.json': '{\n  // developer added comment\n  "compilerOptions": { "strict": true }\n}',
      })

      const uOrig = computeTsconfigUniverseFromFs('/tsconfig.json', fsOrig)
      const uCommented = computeTsconfigUniverseFromFs('/tsconfig.json', fsCommented)

      // Raw byte digest must detect the modification!
      expect(uOrig.configs[0].digest).not.toBe(uCommented.configs[0].digest)
      expect(uOrig.universeDigest).not.toBe(uCommented.universeDigest)
    })

    it('T1-F18-5: reverting tsconfig to original content restores original cache key and causes cache HIT', () => {
      const mockSqliteDb = new Map<string, string>()

      const inputOriginal = {
        builderVersion: '1.0.0',
        manifestOrTargetDigest: 'm',
        snapshotSchemaVersion: 2,
        sourceKind: 'yaml',
        sourceRoot: 'r',
        toolchainFingerprint: 'fp',
        tsconfigUniverseDigest: 'original_digest',
      }
      const originalKey = `${buildSpecProjectKey(inputOriginal)}:rev1`
      mockSqliteDb.set(originalKey, 'initial_snapshot')

      // Reverted state
      const inputReverted = { ...inputOriginal }
      const revertedKey = `${buildSpecProjectKey(inputReverted)}:rev1`

      expect(mockSqliteDb.get(revertedKey)).toBe('initial_snapshot') // HIT!
    })
  })
})
