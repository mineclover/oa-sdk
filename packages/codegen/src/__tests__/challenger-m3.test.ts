/**
 * packages/codegen/src/__tests__/challenger-m3.test.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER TEST SUITE (Milestone 3)
 *
 * 1. SHA-256 Hashing Bit-for-Bit Determinism & Stability Under Stress:
 *    - Arbitrary key permutations (100+ random permutations of deeply nested complex objects)
 *    - RFC 8785 UTF-16 code-unit sorting edge cases (numeric string keys, punctuation, symbols, empty keys, mixed-case ASCII, unicode, surrogate pairs/emoji)
 *    - Deep object nesting stress (20, 50, 100 levels) with scrambled sibling keys at every depth
 *    - Array preservation (strict preservation of array ordering, negative invariance, arrays of permuted objects, null/undefined normalization)
 *    - CRLF vs LF line endings (in strings, mixed CRLF/LF, raw JSON formatting with CRLF vs LF vs minified)
 *    - Self-referential idempotency and vendor extension stripping invariance
 *
 * 2. Spec Drift & Freshness Enforcement Under Stress:
 *    - Missing artifact states (single-target, config-driven single & multi-target, JSON and human output)
 *    - Empty (0-byte) artifact states (single-target, config-driven single & multi-target)
 *    - Corrupted artifact states (truncated JSON, syntax errors, HTML/502 text, binary garbage, non-object JSON: primitives/arrays/null)
 *    - Absolute CLI alias parity between `drift:check` and `check-artifact` across all failure modes
 *    - Spec drift detection under schema mutations (field additions, constraint changes) with diff breakdown
 *    - Config edge cases (missing config file, empty specs array)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  stableStringify,
  computeSha256,
  computeVersionHash,
  stripSchemaEngineExtensions,
} from '../spec-projector.js'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

// =============================================================================
// Helper: Deterministic Pseudo-Random Generator (LCG) for Reproducible Stress
// =============================================================================
function createRng(seed = 123456789) {
  let s = seed
  return function next(): number {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function shuffleEntries<T>(entries: [string, T][], rng: () => number): [string, T][] {
  const arr = [...entries]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const temp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = temp
  }
  return arr
}

function deepPermuteObject(obj: unknown, rng: () => number): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    // Array order MUST be preserved, but elements within can be permuted if they are objects
    return obj.map(item => deepPermuteObject(item, rng))
  }
  const entries = Object.entries(obj as Record<string, unknown>)
  const shuffled = shuffleEntries(entries, rng)
  const result: Record<string, unknown> = {}
  for (const [key, value] of shuffled) {
    result[key] = deepPermuteObject(value, rng)
  }
  return result
}

// =============================================================================
// Part 1: SHA-256 Hashing Determinism & Stability Under Stress
// =============================================================================
describe('M3 Challenger 1: SHA-256 Hashing Determinism & Stability Under Stress', () => {
  describe('Suite 1.1: Arbitrary Key Permutations Under Stress', () => {
    const complexOpenApiDoc = {
      openapi: '3.1.0',
      info: {
        title: 'Stress Test API',
        version: '2.4.0',
        description: 'Comprehensive API specification for hash stress testing.',
        contact: { name: 'API Support', email: 'support@example.com', url: 'https://example.com' },
        license: { name: 'Apache 2.0', identifier: 'Apache-2.0' },
      },
      servers: [
        { url: 'https://api.example.com/v1', description: 'Production' },
        { url: 'https://staging.example.com/v1', description: 'Staging' },
      ],
      paths: {
        '/users/{userId}': {
          get: {
            summary: 'Get user by ID',
            operationId: 'getUserById',
            parameters: [
              { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
              { name: 'fields', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } },
            ],
            responses: {
              '200': {
                description: 'User details',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
                  },
                },
              },
              '404': {
                description: 'Not found',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['id', 'email', 'profile'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              email: { type: 'string', format: 'email' },
              isActive: { type: 'boolean', default: true },
              role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
              profile: {
                type: 'object',
                required: ['firstName', 'lastName'],
                properties: {
                  firstName: { type: 'string', minLength: 1 },
                  lastName: { type: 'string', minLength: 1 },
                  age: { type: 'integer', minimum: 0, maximum: 150 },
                  metadata: {
                    type: 'object',
                    properties: {
                      tags: { type: 'array', items: { type: 'string' } },
                      lastLoginIp: { type: 'string' },
                      settings: {
                        type: 'object',
                        properties: {
                          theme: { type: 'string', enum: ['light', 'dark', 'system'] },
                          notifications: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          ErrorResponse: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    }

    it('asserts bit-for-bit hash identity across 100 arbitrary random key permutations', () => {
      const canonicalHash = computeVersionHash(complexOpenApiDoc)
      expect(canonicalHash).toMatch(/^sha256:[a-f0-9]{64}$/)

      const rng = createRng(42)
      for (let trial = 1; trial <= 100; trial++) {
        const permuted = deepPermuteObject(complexOpenApiDoc, rng)
        const permutedHash = computeVersionHash(permuted)
        expect(permutedHash).toBe(canonicalHash)
      }
    })

    it('asserts stableStringify identity across 50 arbitrary permutations', () => {
      const canonicalString = stableStringify(complexOpenApiDoc)
      const rng = createRng(99)

      for (let trial = 1; trial <= 50; trial++) {
        const permuted = deepPermuteObject(complexOpenApiDoc, rng)
        const permutedString = stableStringify(permuted)
        expect(permutedString).toBe(canonicalString)
      }
    })
  })

  describe('Suite 1.2: RFC 8785 UTF-16 Code-Unit Key Sorting Edge Cases', () => {
    it('sorts numeric string keys by UTF-16 code units, not numerical order', () => {
      // In UTF-16 code-unit order: "0" < "1" < "10" < "100" < "2" < "20" < "3"
      // Default V8 numerical key ordering would erroneously yield: "0", "1", "2", "3", "10", "20", "100"
      const obj1: Record<string, number> = {
        '2': 2,
        '10': 10,
        '0': 0,
        '100': 100,
        '1': 1,
        '20': 20,
        '3': 3,
      }
      const obj2: Record<string, number> = {
        '100': 100,
        '0': 0,
        '3': 3,
        '20': 20,
        '1': 1,
        '2': 2,
        '10': 10,
      }

      const stringified1 = stableStringify(obj1)
      const stringified2 = stableStringify(obj2)

      expect(stringified1).toBe(stringified2)
      expect(stringified1).toBe('{"0":0,"1":1,"10":10,"100":100,"2":2,"20":20,"3":3}')
      expect(computeSha256(obj1)).toBe(computeSha256(obj2))
      expect(computeVersionHash(obj1)).toBe(computeVersionHash(obj2))
    })

    it('handles empty string key, symbols, punctuation, and mixed case in RFC 8785 order', () => {
      const complexKeys = [
        '',
        '$ref',
        '$schema',
        '-hyphen',
        '/slash',
        '0_num',
        ':colon',
        '@at',
        'A_upper',
        'Z_upper',
        '_underscore',
        'a_lower',
        'z_lower',
        '~tilde',
      ]

      const objForward: Record<string, string> = {}
      for (const k of complexKeys) objForward[k] = `val_${k}`

      const objReverse: Record<string, string> = {}
      for (const k of [...complexKeys].reverse()) objReverse[k] = `val_${k}`

      const objShuffled: Record<string, string> = {}
      const rng = createRng(777)
      for (const k of shuffleEntries(complexKeys.map(k => [k, `val_${k}`] as [string, string]), rng)) {
        objShuffled[k[0]] = k[1]
      }

      expect(stableStringify(objForward)).toBe(stableStringify(objReverse))
      expect(stableStringify(objForward)).toBe(stableStringify(objShuffled))
      expect(computeVersionHash(objForward)).toBe(computeVersionHash(objReverse))
      expect(computeVersionHash(objForward)).toBe(computeVersionHash(objShuffled))
    })

    it('handles non-ASCII Unicode diacritics, CJK, and astral plane surrogate pairs (emoji)', () => {
      const unicodeKeys = [
        'apple',
        'äpfel',
        'banana',
        'über',
        '日本語',
        '한국어',
        '🚀_rocket',
        '😀_smile',
      ]

      const objA: Record<string, number> = {}
      for (const k of unicodeKeys) objA[k] = 1

      const objB: Record<string, number> = {}
      for (const k of [...unicodeKeys].reverse()) objB[k] = 1

      expect(stableStringify(objA)).toBe(stableStringify(objB))
      expect(computeSha256(objA)).toBe(computeSha256(objB))
      expect(computeVersionHash(objA)).toBe(computeVersionHash(objB))
    })
  })

  describe('Suite 1.3: Deep Object Nesting Stress (20, 50, 100 levels)', () => {
    function buildDeepTree(depth: number, scramble: boolean): Record<string, unknown> {
      let current: Record<string, unknown> = {
        level: depth,
        leaf: true,
        summary: 'deepest node',
        active: true,
      }

      for (let d = depth - 1; d >= 1; d--) {
        if (scramble) {
          current = {
            nested: current,
            timestamp: 1000 + d,
            level: d,
            id: `node-${d}`,
            alpha: 'a',
          }
        } else {
          current = {
            alpha: 'a',
            id: `node-${d}`,
            level: d,
            nested: current,
            timestamp: 1000 + d,
          }
        }
      }

      return {
        openapi: '3.1.0',
        info: { title: `Deep Tree ${depth}`, version: '1.0.0' },
        data: current,
      }
    }

    it('reaches identical hash at 20 levels of nesting with scrambled keys', () => {
      const treeA = buildDeepTree(20, false)
      const treeB = buildDeepTree(20, true)
      expect(computeVersionHash(treeA)).toBe(computeVersionHash(treeB))
    })

    it('reaches identical hash at 50 levels of nesting with scrambled keys', () => {
      const treeA = buildDeepTree(50, false)
      const treeB = buildDeepTree(50, true)
      expect(computeVersionHash(treeA)).toBe(computeVersionHash(treeB))
    })

    it('reaches identical hash at 100 levels of nesting without stack overflow', () => {
      const treeA = buildDeepTree(100, false)
      const treeB = buildDeepTree(100, true)
      expect(computeVersionHash(treeA)).toBe(computeVersionHash(treeB))
    })
  })

  describe('Suite 1.4: Array Preservation & Strict Invariance', () => {
    it('strictly preserves array ordering of primitives (negative test)', () => {
      const doc1 = { items: [1, 2, 3] }
      const doc2 = { items: [3, 2, 1] }
      const doc3 = { items: [1, 3, 2] }

      const hash1 = computeVersionHash(doc1)
      const hash2 = computeVersionHash(doc2)
      const hash3 = computeVersionHash(doc3)

      expect(hash1).not.toBe(hash2)
      expect(hash1).not.toBe(hash3)
      expect(hash2).not.toBe(hash3)
    })

    it('strictly preserves array ordering of strings (negative test)', () => {
      const docA = { tags: ['alpha', 'beta', 'gamma'] }
      const docB = { tags: ['beta', 'alpha', 'gamma'] }
      expect(computeVersionHash(docA)).not.toBe(computeVersionHash(docB))
    })

    it('preserves array element order while canonically sorting keys of objects inside arrays', () => {
      // Element order: [item0, item1] must remain [item0, item1]
      // But inside item0: { a, b } and { b, a } must match!
      const docA = {
        users: [
          { id: '1', name: 'Alice', role: 'admin' },
          { id: '2', name: 'Bob', role: 'user' },
        ],
      }
      const docB = {
        users: [
          { role: 'admin', id: '1', name: 'Alice' },
          { name: 'Bob', role: 'user', id: '2' },
        ],
      }
      const docC = {
        // Swapped array elements: must NOT match!
        users: [
          { role: 'user', id: '2', name: 'Bob' },
          { id: '1', name: 'Alice', role: 'admin' },
        ],
      }

      expect(computeVersionHash(docA)).toBe(computeVersionHash(docB))
      expect(computeVersionHash(docA)).not.toBe(computeVersionHash(docC))
    })

    it('normalizes undefined in arrays to null according to JSON specification', () => {
      const arrWithUndefined = [1, undefined, 2]
      const arrWithNull = [1, null, 2]

      expect(stableStringify(arrWithUndefined)).toBe('[1,null,2]')
      expect(stableStringify(arrWithNull)).toBe('[1,null,2]')
      expect(computeVersionHash({ data: arrWithUndefined })).toBe(
        computeVersionHash({ data: arrWithNull }),
      )
    })

    it('handles nested arrays and empty arrays consistently', () => {
      const docA = { matrix: [[], [1, 2], [3, [4, 5]]] }
      const docB = { matrix: [[], [1, 2], [3, [4, 5]]] }
      const docC = { matrix: [[], [1, 2], [3, [5, 4]]] }

      expect(computeVersionHash(docA)).toBe(computeVersionHash(docB))
      expect(computeVersionHash(docA)).not.toBe(computeVersionHash(docC))
    })
  })

  describe('Suite 1.5: CRLF vs LF Line Endings & Whitespace Stress', () => {
    it('normalizes CRLF to LF inside multi-line strings across diverse fields', () => {
      const docUnix = {
        openapi: '3.1.0',
        info: {
          title: 'Spec Title',
          version: '1.0.0',
          description: 'Line 1\nLine 2\nLine 3\n',
        },
        components: {
          schemas: {
            MarkdownDoc: {
              type: 'string',
              description: '# Heading\n\nParagraph 1.\nParagraph 2.',
            },
          },
        },
      }

      const docWindows = {
        openapi: '3.1.0',
        info: {
          title: 'Spec Title',
          version: '1.0.0',
          description: 'Line 1\r\nLine 2\r\nLine 3\r\n',
        },
        components: {
          schemas: {
            MarkdownDoc: {
              type: 'string',
              description: '# Heading\r\n\r\nParagraph 1.\r\nParagraph 2.',
            },
          },
        },
      }

      const docMixed = {
        openapi: '3.1.0',
        info: {
          title: 'Spec Title',
          version: '1.0.0',
          description: 'Line 1\r\nLine 2\nLine 3\r\n',
        },
        components: {
          schemas: {
            MarkdownDoc: {
              type: 'string',
              description: '# Heading\n\r\nParagraph 1.\r\nParagraph 2.',
            },
          },
        },
      }

      expect(computeVersionHash(docUnix)).toBe(computeVersionHash(docWindows))
      expect(computeVersionHash(docUnix)).toBe(computeVersionHash(docMixed))
    })

    it('produces identical hash from raw JSON string whether formatted with CRLF, LF, or minified', () => {
      const baseObj = {
        openapi: '3.1.0',
        info: {
          title: 'Line Ending Format Test',
          version: '1.0.0',
          description: 'Multi\nline\ndescription',
        },
      }

      const minifiedJson = JSON.stringify(baseObj)
      const lfPrettyJson = JSON.stringify(baseObj, null, 2)
      const crlfPrettyJson = lfPrettyJson.replace(/\n/g, '\r\n')

      const hashMin = computeVersionHash(minifiedJson)
      const hashLf = computeVersionHash(lfPrettyJson)
      const hashCrlf = computeVersionHash(crlfPrettyJson)
      const hashObj = computeVersionHash(baseObj)

      expect(hashMin).toBe(hashLf)
      expect(hashLf).toBe(hashCrlf)
      expect(hashCrlf).toBe(hashObj)
    })
  })

  describe('Suite 1.6: Vendor Extension Stripping & Self-Referential Invariants', () => {
    const cleanSpec = {
      openapi: '3.1.0',
      info: { title: 'Extension Stripping Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
      components: {
        schemas: {
          Widget: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    }

    it('strips all four standard x-schema-engine-* vendor extensions', () => {
      const withExtensions = {
        ...cleanSpec,
        'x-schema-engine-profile': 'component-bundle',
        'x-schema-engine-version-hash': 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        'x-schema-engine-sources': {
          Widget: { kind: 'file', filePath: 'src/widget.ts', pointer: '#/components/schemas/Widget' },
        },
        'x-schema-engine-refs': [
          { from: '#/components/schemas/Widget', ref: '#/components/schemas/Id', kind: 'schema-component' },
        ],
      }

      expect(computeVersionHash(withExtensions)).toBe(computeVersionHash(cleanSpec))
    })

    it('guarantees self-referential idempotency when version hash is stamped into doc', () => {
      const stampedDoc = { ...cleanSpec }
      const hashInitial = computeVersionHash(stampedDoc)
      ;(stampedDoc as any)['x-schema-engine-version-hash'] = hashInitial

      const hashAfterStamp = computeVersionHash(stampedDoc)
      expect(hashAfterStamp).toBe(hashInitial)
    })

    it('preserves non-schema-engine extensions in content calculation', () => {
      const withCustomExt = {
        ...cleanSpec,
        'x-vendor-custom-field': { key: 'value' },
      }
      expect(computeVersionHash(withCustomExt)).not.toBe(computeVersionHash(cleanSpec))
    })
  })
})

// =============================================================================
// Part 2: Drift Detection Stress Testing (Missing, Empty, Corrupted Artifacts)
// =============================================================================
describe('M3 Challenger 1: Drift Detection Under Missing, Empty, and Corrupted States', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'm3-challenger-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  async function setupStandardWorkspace(targetCount = 1) {
    const specsConfig = []
    for (let i = 1; i <= targetCount; i++) {
      const id = targetCount === 1 ? 'test-spec' : `target-${i}`
      specsConfig.push({
        id,
        profile: 'component-bundle',
        schemaEntry: `./schemas/${id}.ts`,
        outDir: './artifacts/specs',
      })

      await fixture.writeFile(
        `schemas/${id}.ts`,
        `import { z } from 'zod';
export const Entity${i} = z.object({
  id: z.string(),
  value: z.number(),
});
`,
      )
    }

    await fixture.writeFile(
      'oa.config.ts',
      `export default {
  rootDir: '.',
  specs: ${JSON.stringify(specsConfig, null, 2)},
};
`,
    )

    const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
    expect(genResult.status).toBe(0)
  }

  // ===========================================================================
  // 2.1 Missing Artifact States
  // ===========================================================================
  describe('Suite 2.1: Missing Artifact States', () => {
    it('drift:check exits 1 when committed artifact is deleted from disk', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.unlink(artifactPath)

      const driftResult = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(driftResult.status).toBe(1)
      expect(driftResult.stdout).toContain('🔴 MISSING')
      expect(driftResult.stdout).toContain('Spec drift detected: 1 of 1 targets failed')

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 MISSING')
    })

    it('drift:check --format json returns schema-conforming status: missing', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.unlink(artifactPath)

      const result = runOaCli(['drift:check', '--format', 'json'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)

      const parsed = JSON.parse(result.stdout)
      expect(parsed.schemaVersion).toBe('oa-gen.artifact-freshness.v1')
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets[0].status).toBe('missing')
      expect(parsed.targets[0].fresh).toBe(false)
      expect(parsed.targets[0].message).toContain('missing')
    })

    it('handles multi-target config where 1 of 3 artifacts is missing', async () => {
      await setupStandardWorkspace(3)

      // Delete target-2 artifact only
      const target2Path = path.join(fixture.rootDir, 'artifacts/specs/target-2.openapi.json')
      await fs.unlink(target2Path)

      const driftResult = runOaCli(['drift:check', '--format', 'json'], { cwd: fixture.rootDir })
      expect(driftResult.status).toBe(1)

      const parsed = JSON.parse(driftResult.stdout)
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets).toHaveLength(3)

      const t1 = parsed.targets.find((t: any) => t.id === 'target-1')
      const t2 = parsed.targets.find((t: any) => t.id === 'target-2')
      const t3 = parsed.targets.find((t: any) => t.id === 'target-3')

      expect(t1.status).toBe('fresh')
      expect(t1.fresh).toBe(true)

      expect(t2.status).toBe('missing')
      expect(t2.fresh).toBe(false)

      expect(t3.status).toBe('fresh')
      expect(t3.fresh).toBe(true)
    })

    it('single-target manual mode: exits 1 when --artifact file is missing', async () => {
      await setupStandardWorkspace(1)

      const nonExistent = path.join(fixture.rootDir, 'artifacts/specs/non-existent.json')

      // 1. Without schema/head
      const r1 = runOaCli(['check-artifact', '--artifact', nonExistent], { cwd: fixture.rootDir })
      expect(r1.status).toBe(1)
      expect(r1.stderr).toContain('Artifact file missing')

      // 2. With schema
      const schemaPath = path.join(fixture.rootDir, 'schemas/test-spec.ts')
      const r2 = runOaCli(
        ['check-artifact', '--schema', schemaPath, '--artifact', nonExistent],
        { cwd: fixture.rootDir },
      )
      expect(r2.status).toBe(1)
      expect(r2.stderr).toContain('Artifact file missing')

      // 3. drift:check alias
      const r3 = runOaCli(['drift:check', '--artifact', nonExistent], { cwd: fixture.rootDir })
      expect(r3.status).toBe(1)
    })
  })

  // ===========================================================================
  // 2.2 Empty (0-Byte) Artifact States
  // ===========================================================================
  describe('Suite 2.2: Empty (0-Byte) Artifact States', () => {
    it('drift:check exits 1 when artifact is truncated to 0 bytes', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(artifactPath, '')

      const driftResult = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(driftResult.status).toBe(1)
      expect(driftResult.stdout).toContain('🔴 CORRUPT')
      expect(driftResult.stdout).toContain('0 bytes')

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 CORRUPT')
    })

    it('drift:check --format json returns status: corrupt for 0-byte artifact', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(artifactPath, '')

      const result = runOaCli(['drift:check', '--format', 'json'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)

      const parsed = JSON.parse(result.stdout)
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets[0].status).toBe('corrupt')
      expect(parsed.targets[0].message).toContain('0 bytes')
    })

    it('single-target manual mode: exits 1 when --artifact is 0 bytes', async () => {
      await setupStandardWorkspace(1)

      const emptyPath = path.join(fixture.rootDir, 'empty.json')
      await fs.writeFile(emptyPath, '')

      // 1. Single artifact inspection
      const r1 = runOaCli(['check-artifact', '--artifact', emptyPath], { cwd: fixture.rootDir })
      expect(r1.status).toBe(1)
      expect(r1.stderr).toContain('0 bytes')

      // 2. Single artifact inspection with JSON format
      const r1Json = runOaCli(
        ['check-artifact', '--artifact', emptyPath, '--format', 'json'],
        { cwd: fixture.rootDir },
      )
      expect(r1Json.status).toBe(1)
      const parsed1 = JSON.parse(r1Json.stdout)
      expect(parsed1.fresh).toBe(false)
      expect(parsed1.targets[0].status).toBe('corrupt')

      // 3. With schema
      const schemaPath = path.join(fixture.rootDir, 'schemas/test-spec.ts')
      const r2 = runOaCli(
        ['check-artifact', '--schema', schemaPath, '--artifact', emptyPath],
        { cwd: fixture.rootDir },
      )
      expect(r2.status).toBe(1)
      expect(r2.stderr).toContain('0 bytes')

      // 4. drift:check alias
      const r3 = runOaCli(['drift:check', '--artifact', emptyPath], { cwd: fixture.rootDir })
      expect(r3.status).toBe(1)
    })
  })

  // ===========================================================================
  // 2.3 Corrupted Artifact States
  // ===========================================================================
  describe('Suite 2.3: Corrupted Artifact States', () => {
    it('exits 1 on truncated / malformed JSON artifact syntax', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(artifactPath, '{"openapi": "3.1.0", "info": {"title": "incomplete')

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 CORRUPT')
      expect(result.stdout).toContain('Failed to parse artifact JSON')

      const checkResult = runOaCli(['check-artifact'], { cwd: fixture.rootDir })
      expect(checkResult.status).toBe(1)
      expect(checkResult.stdout).toContain('🔴 CORRUPT')
    })

    it('exits 1 on HTML or text response (e.g. 502 Bad Gateway / Cloudflare error)', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      await fs.writeFile(
        artifactPath,
        '<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>',
      )

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 CORRUPT')

      const jsonResult = runOaCli(['drift:check', '--format', 'json'], { cwd: fixture.rootDir })
      expect(jsonResult.status).toBe(1)
      const parsed = JSON.parse(jsonResult.stdout)
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets[0].status).toBe('corrupt')
    })

    it('exits 1 on binary garbage artifact content', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')
      const binaryData = Buffer.from([0x00, 0xff, 0xfe, 0x12, 0x34, 0xde, 0xad, 0xbe, 0xef])
      await fs.writeFile(artifactPath, binaryData)

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 CORRUPT')
    })

    it('exits 1 on non-object valid JSON (array, primitive number, string, null)', async () => {
      await setupStandardWorkspace(1)

      const artifactPath = path.join(fixture.rootDir, 'artifacts/specs/test-spec.openapi.json')

      // Case A: JSON Array
      await fs.writeFile(artifactPath, JSON.stringify(['item1', 'item2']))
      const resArray = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(resArray.status).toBe(1)

      // Case B: JSON String
      await fs.writeFile(artifactPath, JSON.stringify('raw string content'))
      const resString = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(resString.status).toBe(1)

      // Case C: JSON null
      await fs.writeFile(artifactPath, 'null')
      const resNull = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(resNull.status).toBe(1)
    })
  })

  // ===========================================================================
  // 2.4 Spec Drift Detection (Modified Source Schemas)
  // ===========================================================================
  describe('Suite 2.4: Spec Drift Detection (Modified Source Schemas)', () => {
    it('detects drift when schema field is added and reports diff details', async () => {
      await setupStandardWorkspace(1)

      // Mutate source schema by adding a new field
      await fixture.writeFile(
        'schemas/test-spec.ts',
        `import { z } from 'zod';
export const Entity1 = z.object({
  id: z.string(),
  value: z.number(),
  extraField: z.string().optional(),
});
`,
      )

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 DRIFT DETECTED')
      expect(result.stdout).toContain('Projected:')
      expect(result.stdout).toContain('Committed:')
      expect(result.stdout).toContain('Spec drift detected: 1 of 1 targets failed')

      // JSON format contains diff breakdown
      const jsonResult = runOaCli(['drift:check', '--format', 'json'], { cwd: fixture.rootDir })
      expect(jsonResult.status).toBe(1)
      const parsed = JSON.parse(jsonResult.stdout)
      expect(parsed.fresh).toBe(false)
      expect(parsed.targets[0].status).toBe('drift')
      expect(parsed.targets[0].projectedHash).not.toBe(parsed.targets[0].committedHash)
      expect(parsed.targets[0].differences.length).toBeGreaterThan(0)
    })

    it('detects drift when field constraint changes (e.g. minimum value)', async () => {
      await setupStandardWorkspace(1)

      await fixture.writeFile(
        'schemas/test-spec.ts',
        `import { z } from 'zod';
export const Entity1 = z.object({
  id: z.string(),
  value: z.number().min(10),
});
`,
      )

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 DRIFT DETECTED')
    })
  })

  // ===========================================================================
  // 2.5 Config Edge Cases
  // ===========================================================================
  describe('Suite 2.5: Configuration Edge Cases', () => {
    it('exits 1 when invoked without config file and without arguments', async () => {
      // Empty workspace without oa.config.ts
      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('oa.config.ts')
    })

    it('exits 1 when oa.config.ts defines an empty specs list', async () => {
      await fixture.writeFile(
        'oa.config.ts',
        `export default {
  rootDir: '.',
  specs: [],
};
`,
      )

      const result = runOaCli(['drift:check'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('specs 목록이 비어 있습니다')
    })
  })
})
