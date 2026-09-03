/**
 * packages/codegen/src/__tests__/challenger-m3-breaking-diff.test.ts
 *
 * Empirical Adversarial Challenge Suite for Milestone 3 (Challenger 2):
 * 1. The 11 Endpoint Breaking Change Rules (and Component Schema Breaking Rules)
 * 2. Exit Code Semantics under --fail-on-breaking (1 on breaking, 0 on non-breaking)
 * 3. Root Resolution from Deep Subdirectories for diff and check-artifact / drift:check
 * 4. Adversarial Stress & Edge Cases: Circular $ref, special characters, unordered arrays, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

describe('M3 Adversarial Challenge Suite (Challenger 2: Breaking Diff & Root-Aware Invocation)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'm3-challenger2-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // Helper to write JSON specs and run diff
  async function runDiffWithDocs(baseDoc: unknown, headDoc: unknown, extraArgs: string[] = [], cwd?: string) {
    const baseFile = path.join(fixture.rootDir, 'base.json')
    const headFile = path.join(fixture.rootDir, 'head.json')
    await fs.writeFile(baseFile, JSON.stringify(baseDoc))
    await fs.writeFile(headFile, JSON.stringify(headDoc))
    return runOaCli(['diff', '--base', baseFile, '--head', headFile, ...extraArgs], {
      cwd: cwd ?? fixture.rootDir,
    })
  }

  // Base endpoint template
  const baseStandardEndpoint = {
    summary: 'Standard operation',
    operationId: 'standardOp',
    parameters: [
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      { name: 'filter', in: 'query', required: false, schema: { type: 'string' } },
    ],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              age: { type: 'integer' },
            },
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
      },
      '400': {
        description: 'Bad Request',
      },
    },
  }

  // =========================================================================
  // SECTION 1: The 11 Endpoint Breaking Change Rules
  // =========================================================================
  describe('Section 1: The 11 Endpoint Breaking Change Rules', () => {
    it('Rule 1: endpoint-removed — selectively removes HTTP methods and paths', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 1', version: '1.0.0' },
        paths: {
          '/users': {
            get: { ...baseStandardEndpoint, operationId: 'getUsers' },
            post: { ...baseStandardEndpoint, operationId: 'createUser' },
          },
          '/users/{id}': {
            get: { ...baseStandardEndpoint, operationId: 'getUserById' },
            delete: { ...baseStandardEndpoint, operationId: 'deleteUser' },
          },
        },
      }
      // Head removes DELETE /users/{id} and POST /users
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 1', version: '1.0.0' },
        paths: {
          '/users': {
            get: { ...baseStandardEndpoint, operationId: 'getUsers' },
          },
          '/users/{id}': {
            get: { ...baseStandardEndpoint, operationId: 'getUserById' },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('endpoint-removed')
      expect(result.stdout).toContain('DELETE /users/{id}')
      expect(result.stdout).toContain('POST /users')
      expect(result.stdout).not.toContain('GET /users')
    })

    it('Rule 2: operation-id-changed — detects renamed operationId', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 2', version: '1.0.0' },
        paths: { '/users': { get: { ...baseStandardEndpoint, operationId: 'listUsers' } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 2', version: '1.0.0' },
        paths: { '/users': { get: { ...baseStandardEndpoint, operationId: 'fetchAllUsers' } } },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('operation-id-changed')
      expect(result.stdout).toContain('listUsers')
      expect(result.stdout).toContain('fetchAllUsers')
    })

    it('Rule 3: required-parameter-added — detects newly added required query, header, or path param', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 3', version: '1.0.0' },
        paths: { '/orders': { get: baseStandardEndpoint } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 3', version: '1.0.0' },
        paths: {
          '/orders': {
            get: {
              ...baseStandardEndpoint,
              parameters: [
                ...baseStandardEndpoint.parameters,
                { name: 'X-Tenant-Id', in: 'header', required: true, schema: { type: 'string' } },
              ],
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('required-parameter-added')
      expect(result.stdout).toContain('header:X-Tenant-Id')
    })

    it('Rule 4: parameter-removed — detects removal of existing parameter', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 4', version: '1.0.0' },
        paths: { '/items': { get: baseStandardEndpoint } },
      }
      // Remove 'filter' parameter
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 4', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              ...baseStandardEndpoint,
              parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-removed')
      expect(result.stdout).toContain('query:filter')
    })

    it('Rule 5: parameter-required — detects optional parameter becoming required', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 5', version: '1.0.0' },
        paths: { '/items': { get: baseStandardEndpoint } },
      }
      // 'limit' was required: false, now required: true
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 5', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              ...baseStandardEndpoint,
              parameters: [
                { name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
                { name: 'filter', in: 'query', required: false, schema: { type: 'string' } },
              ],
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-required')
      expect(result.stdout).toContain('query:limit')
    })

    it('Rule 6: parameter-schema-changed — detects parameter type mutation', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 6', version: '1.0.0' },
        paths: { '/items': { get: baseStandardEndpoint } },
      }
      // 'limit' type changes from integer to string
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 6', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              ...baseStandardEndpoint,
              parameters: [
                { name: 'limit', in: 'query', required: false, schema: { type: 'string' } },
                { name: 'filter', in: 'query', required: false, schema: { type: 'string' } },
              ],
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-schema-changed')
      expect(result.stdout).toContain('query:limit')
    })

    it('Rule 7: request-body-required — detects request body becoming required', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 7', version: '1.0.0' },
        paths: { '/items': { post: baseStandardEndpoint } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 7', version: '1.0.0' },
        paths: {
          '/items': {
            post: {
              ...baseStandardEndpoint,
              requestBody: { ...baseStandardEndpoint.requestBody, required: true },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-body-required')
    })

    it('Rule 8: request-required-field-added — detects new required field in request body', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 8', version: '1.0.0' },
        paths: { '/items': { post: baseStandardEndpoint } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 8', version: '1.0.0' },
        paths: {
          '/items': {
            post: {
              ...baseStandardEndpoint,
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['name', 'age'], // 'age' added to required
                      properties: {
                        name: { type: 'string' },
                        age: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-required-field-added')
      expect(result.stdout).toContain('age')
    })

    it('Rule 9: request-schema-changed — detects property type change in request body schema', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 9', version: '1.0.0' },
        paths: { '/items': { post: baseStandardEndpoint } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 9', version: '1.0.0' },
        paths: {
          '/items': {
            post: {
              ...baseStandardEndpoint,
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['name'],
                      properties: {
                        name: { type: 'string' },
                        age: { type: 'string' }, // changed from integer to string
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-schema-changed')
    })

    it('Rule 10: response-removed — detects removal of existing response status code', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 10', version: '1.0.0' },
        paths: { '/items': { get: baseStandardEndpoint } },
      }
      // Remove '400' response
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 10', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              ...baseStandardEndpoint,
              responses: {
                '200': baseStandardEndpoint.responses['200'],
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('response-removed')
      expect(result.stdout).toContain('Response 400 was removed')
    })

    it('Rule 11: response-schema-changed — detects response schema property mutation', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Rule 11', version: '1.0.0' },
        paths: { '/items': { get: baseStandardEndpoint } },
      }
      // 'id' changed from string to integer
      const head = {
        openapi: '3.1.0',
        info: { title: 'Rule 11', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              ...baseStandardEndpoint,
              responses: {
                ...baseStandardEndpoint.responses,
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          status: { type: 'string' },
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
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('response-schema-changed')
      expect(result.stdout).toContain('Response 200 schema changed')
    })
  })

  // =========================================================================
  // SECTION 2: Component Schema Breaking Changes & Boundary Rules
  // =========================================================================
  describe('Section 2: Component Schema Breaking Changes (component-bundle)', () => {
    it('Schema Rule: schema-removed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            User: { type: 'object', properties: { id: { type: 'string' } } },
            AuditLog: { type: 'object', properties: { timestamp: { type: 'string' } } },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            User: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('schema-removed')
      expect(result.stdout).toContain('AuditLog')
    })

    it('Schema Rule: type-changed on property and root schema', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            Metric: { type: 'integer' },
            Account: { type: 'object', properties: { active: { type: 'boolean' } } },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            Metric: { type: 'string' }, // root type changed
            Account: { type: 'object', properties: { active: { type: 'string' } } }, // prop type changed
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('type-changed')
    })

    it('Schema Rule: constraint-narrowed (maximum lowered, minimum raised)', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            BoundedInt: { type: 'integer', minimum: 10, maximum: 100 },
          },
        },
      }
      // Narrowing: minimum 10 -> 20, maximum 100 -> 80
      const head = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            BoundedInt: { type: 'integer', minimum: 20, maximum: 80 },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('constraint-narrowed')
    })

    it('Schema Rule: constraint-widened is classified as NON-BREAKING (exit code 0)', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            BoundedInt: { type: 'integer', minimum: 20, maximum: 80 },
          },
        },
      }
      // Widening: minimum 20 -> 10, maximum 80 -> 100
      const head = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            BoundedInt: { type: 'integer', minimum: 10, maximum: 100 },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('widened')
    })

    it('Schema Rule: nullable-removed detects property nullable transition to non-nullable', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            Profile: {
              type: 'object',
              properties: { bio: { type: 'string', nullable: true } },
            },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'CS', version: '1.0.0' },
        components: {
          schemas: {
            Profile: {
              type: 'object',
              properties: { bio: { type: 'string', nullable: false } },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('nullable-removed')
    })
  })

  // =========================================================================
  // SECTION 3: Exit Codes Under --fail-on-breaking
  // =========================================================================
  describe('Section 3: Exit Codes Under --fail-on-breaking', () => {
    const breakingDoc = {
      openapi: '3.1.0',
      info: { title: 'Break', version: '1' },
      paths: { '/old': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const emptyDoc = {
      openapi: '3.1.0',
      info: { title: 'Break', version: '1' },
      paths: {},
    }
    const nonBreakingDoc = {
      openapi: '3.1.0',
      info: { title: 'NonBreak', version: '1' },
      paths: {
        '/old': {
          get: {
            summary: 'Updated summary', // non-breaking
            responses: {
              '200': { description: 'OK' },
              '201': { description: 'Created' }, // non-breaking addition
            },
          },
        },
        '/new-endpoint': { get: { responses: { '200': { description: 'OK' } } } }, // non-breaking addition
      },
    }

    it('exits 1 when breaking changes exist AND --fail-on-breaking is specified', async () => {
      const result = await runDiffWithDocs(breakingDoc, emptyDoc, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('endpoint-removed')
    })

    it('exits 0 when breaking changes exist WITHOUT --fail-on-breaking', async () => {
      const result = await runDiffWithDocs(breakingDoc, emptyDoc, [])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('endpoint-removed')
    })

    it('exits 0 when only non-breaking changes exist WITH --fail-on-breaking', async () => {
      const result = await runDiffWithDocs(breakingDoc, nonBreakingDoc, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('#### Added')
    })

    it('exits 1 when mixed breaking AND non-breaking changes exist WITH --fail-on-breaking', async () => {
      const mixedHead = {
        openapi: '3.1.0',
        info: { title: 'Mixed', version: '1' },
        paths: {
          // /old removed (breaking)
          // /new added (non-breaking)
          '/new': { get: { responses: { '200': { description: 'OK' } } } },
        },
      }
      const result = await runDiffWithDocs(breakingDoc, mixedHead, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('endpoint-removed')
      expect(result.stdout).toContain('GET /new')
    })

    it('exits 0 for identical specs WITH --fail-on-breaking', async () => {
      const result = await runDiffWithDocs(breakingDoc, breakingDoc, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('exits 0 for semantic equivalent with differing key order and whitespace', async () => {
      const docA = {
        openapi: '3.1.0',
        info: { title: 'Equiv', version: '1' },
        paths: {
          '/test': {
            get: {
              operationId: 'testOp',
              responses: { '200': { description: 'OK' } },
              parameters: [{ name: 'a', in: 'query' }, { name: 'b', in: 'query' }],
            },
          },
        },
      }
      const docB = {
        paths: {
          '/test': {
            get: {
              parameters: [{ name: 'b', in: 'query' }, { name: 'a', in: 'query' }],
              responses: { '200': { description: 'OK' } },
              operationId: 'testOp',
            },
          },
        },
        info: { version: '1', title: 'Equiv' },
        openapi: '3.1.0',
      }
      const result = await runDiffWithDocs(docA, docB, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })
  })

  // =========================================================================
  // SECTION 4: Subdirectory Root Resolution for `diff`
  // =========================================================================
  describe('Section 4: Subdirectory Root Resolution for diff', () => {
    let deepSubdir: string

    beforeEach(async () => {
      deepSubdir = path.join(fixture.rootDir, 'packages/engine/sub/deep')
      await fs.mkdir(deepSubdir, { recursive: true })

      await fixture.writeFile(
        'specs/base.json',
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Base', version: '1' },
          paths: { '/test': { get: { responses: { '200': { description: 'OK' } } } } },
        }),
      )
      await fixture.writeFile(
        'specs/head.json',
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Head', version: '1' },
          paths: { '/test': { get: { responses: { '200': { description: 'OK' } } } } },
        }),
      )
    })

    it('resolves relative paths from 4-level deep subdirectory via explicit --root', () => {
      const result = runOaCli(
        ['diff', '--root', fixture.rootDir, '--base', 'specs/base.json', '--head', 'specs/head.json'],
        { cwd: deepSubdir },
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('resolves relative paths from deep subdirectory via explicit --project-root', () => {
      const result = runOaCli(
        ['diff', '--project-root', fixture.rootDir, '--base', 'specs/base.json', '--head', 'specs/head.json'],
        { cwd: deepSubdir },
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('resolves relative paths automatically via upward root discovery (oa.config.ts) from deep subdirectory', async () => {
      // Put oa.config.ts in rootDir
      await fixture.writeFile('oa.config.ts', 'export default { rootDir: "." };\n')

      const result = runOaCli(
        ['diff', '--base', 'specs/base.json', '--head', 'specs/head.json'],
        { cwd: deepSubdir },
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('propagates exit code 1 on breaking change from deep subdirectory', async () => {
      await fixture.writeFile(
        'specs/head-broken.json',
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Head', version: '1' },
          paths: {},
        }),
      )
      const result = runOaCli(
        [
          'diff',
          '--root',
          fixture.rootDir,
          '--base',
          'specs/base.json',
          '--head',
          'specs/head-broken.json',
          '--fail-on-breaking',
        ],
        { cwd: deepSubdir },
      )
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('endpoint-removed')
    })
  })

  // =========================================================================
  // SECTION 5: Subdirectory Root Resolution for `check-artifact` & `drift:check`
  // =========================================================================
  describe('Section 5: Subdirectory Root Resolution for check-artifact & drift:check', () => {
    let deepSubdir: string

    beforeEach(async () => {
      deepSubdir = path.join(fixture.rootDir, 'apps/studio/nested/child')
      await fs.mkdir(deepSubdir, { recursive: true })

      await fixture.writeFile(
        'oa.config.ts',
        `export default {
  rootDir: '.',
  specs: [
    {
      id: 'core-profile',
      profile: 'component-bundle',
      schemaEntry: './schemas/core.ts',
      outDir: './artifacts/specs',
    },
  ],
};
`,
      )
      await fixture.writeFile(
        'schemas/core.ts',
        `import { z } from 'zod';
export const Widget = z.object({
  id: z.string(),
  name: z.string(),
});
`,
      )

      // Generate the initial artifact
      const genResult = runOaCli(['generate'], { cwd: fixture.rootDir })
      expect(genResult.status).toBe(0)
    })

    it('runs config-driven check-artifact from deep subdirectory without explicit flags via upward discovery', () => {
      const result = runOaCli(['check-artifact'], { cwd: deepSubdir })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('🟢 FRESH')
      expect(result.stdout).toContain('core-profile')
    })

    it('runs drift:check alias from deep subdirectory with --root', () => {
      const result = runOaCli(['drift:check', '--root', fixture.rootDir], { cwd: deepSubdir })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('🟢 FRESH')
    })

    it('runs single-target check-artifact from deep subdirectory with relative paths via --root', () => {
      const result = runOaCli(
        [
          'check-artifact',
          '--schema',
          'schemas/core.ts',
          '--artifact',
          'artifacts/specs/core-profile.openapi.json',
          '--root',
          fixture.rootDir,
        ],
        { cwd: deepSubdir },
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('fresh')
    })

    it('detects schema mutation drift from deep subdirectory and exits 1', async () => {
      // Mutate source schema
      await fixture.writeFile(
        'schemas/core.ts',
        `import { z } from 'zod';
export const Widget = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()), // added field -> drift!
});
`,
      )

      const result = runOaCli(['drift:check'], { cwd: deepSubdir })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('🔴 DRIFT DETECTED')
      expect(result.stdout).toContain('core-profile')
    })
  })

  // =========================================================================
  // SECTION 6: Adversarial Stress & Edge Cases
  // =========================================================================
  describe('Section 6: Adversarial Stress & Edge Cases', () => {
    it('handles recursive / circular $ref structures without crashing or infinite recursion', async () => {
      const circularBase = {
        openapi: '3.1.0',
        info: { title: 'Tree', version: '1.0.0' },
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }
      const circularHead = {
        openapi: '3.1.0',
        info: { title: 'Tree', version: '1.0.0' },
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              properties: {
                value: { type: 'integer' }, // type changed in recursive schema
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(circularBase, circularHead, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('type-changed')
    })

    it('handles special characters in path templates and property names', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'Special', version: '1' },
        paths: {
          '/api/v1/orgs/{org-id}/repos/{repo.name}:activate': {
            post: {
              operationId: 'activateRepo',
              parameters: [
                { name: 'org-id', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'repo.name', in: 'path', required: true, schema: { type: 'string' } },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'Special', version: '1' },
        paths: {
          '/api/v1/orgs/{org-id}/repos/{repo.name}:activate': {
            post: {
              operationId: 'activateRepo',
              parameters: [
                // org-id removed -> breaking!
                { name: 'repo.name', in: 'path', required: true, schema: { type: 'string' } },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-removed')
      expect(result.stdout).toContain('path:org-id')
    })

    it('treats unordered set keys (required arrays) with differing order as equivalent', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'SetKeys', version: '1' },
        components: {
          schemas: {
            Person: {
              type: 'object',
              required: ['firstName', 'lastName', 'email'],
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'SetKeys', version: '1' },
        components: {
          schemas: {
            Person: {
              type: 'object',
              required: ['email', 'firstName', 'lastName'], // permuted required array
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('detects parameter enum narrowing as breaking parameter-schema-changed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'EnumNarrow', version: '1' },
        paths: {
          '/articles': {
            get: {
              summary: 'Get articles',
              parameters: [
                {
                  name: 'status',
                  in: 'query',
                  required: false,
                  schema: { type: 'string', enum: ['draft', 'published', 'archived'] },
                },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'EnumNarrow', version: '1' },
        paths: {
          '/articles': {
            get: {
              summary: 'Get articles',
              parameters: [
                {
                  name: 'status',
                  in: 'query',
                  required: false,
                  schema: { type: 'string', enum: ['draft', 'published'] }, // 'archived' removed
                },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-schema-changed')
      expect(result.stdout).toContain('query:status')
    })

    it('handles multiple response removals and schema changes simultaneously', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'MultiResp', version: '1' },
        paths: {
          '/batch': {
            post: {
              responses: {
                '200': {
                  description: 'Success',
                  content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer' } } } } },
                },
                '202': { description: 'Accepted' },
                '400': { description: 'Bad Request' },
                '500': { description: 'Server Error' },
              },
            },
          },
        },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'MultiResp', version: '1' },
        paths: {
          '/batch': {
            post: {
              responses: {
                '200': {
                  description: 'Success',
                  content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'string' } } } } }, // schema changed!
                },
                // 202 removed!
                // 400 removed!
                '500': { description: 'Server Error' },
              },
            },
          },
        },
      }
      const result = await runDiffWithDocs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('response-removed')
      expect(result.stdout).toContain('response-schema-changed')
      expect(result.stdout).toContain('Response 202 was removed')
      expect(result.stdout).toContain('Response 400 was removed')
      expect(result.stdout).toContain('Response 200 schema changed')
    })

    it('resolves absolute file paths correctly from nested subdirectory', async () => {
      const subDir = path.join(fixture.rootDir, 'nested/sub/workspace')
      await fs.mkdir(subDir, { recursive: true })

      const baseAbs = path.join(fixture.rootDir, 'abs-base.json')
      const headAbs = path.join(fixture.rootDir, 'abs-head.json')
      await fs.writeFile(baseAbs, JSON.stringify({ openapi: '3.1.0', info: { title: 'Abs', version: '1' }, paths: {} }))
      await fs.writeFile(headAbs, JSON.stringify({ openapi: '3.1.0', info: { title: 'Abs', version: '1' }, paths: {} }))

      const result = runOaCli(['diff', '--base', baseAbs, '--head', headAbs], { cwd: subDir })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })

    it('resolves relative paths via monorepo workspace marker (pnpm-workspace.yaml) without oa.config.ts', async () => {
      const wsFixture = await createWorkspaceFixture({ workspaceType: 'pnpm' }, 'pnpm-ws-diff-')
      try {
        const subDir = path.join(wsFixture.rootDir, 'packages/app/src')
        await fs.mkdir(subDir, { recursive: true })

        await wsFixture.writeFile(
          'specs/base.json',
          JSON.stringify({ openapi: '3.1.0', info: { title: 'WS', version: '1' }, paths: {} }),
        )
        await wsFixture.writeFile(
          'specs/head.json',
          JSON.stringify({ openapi: '3.1.0', info: { title: 'WS', version: '1' }, paths: {} }),
        )

        const result = runOaCli(
          ['diff', '--base', 'specs/base.json', '--head', 'specs/head.json'],
          { cwd: subDir },
        )
        expect(result.status).toBe(0)
        expect(result.stdout).toContain('No endpoint or schema changes detected')
      } finally {
        await wsFixture.cleanup()
      }
    })
  })
})
