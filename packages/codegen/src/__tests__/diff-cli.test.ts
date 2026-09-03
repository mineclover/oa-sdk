import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { runOaCli } from './e2e/helpers/cli-runner.js'
import { createWorkspaceFixture, type WorkspaceFixture } from './e2e/helpers/fixture-builder.js'

describe('oa-gen diff CLI Test Suite', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createWorkspaceFixture({}, 'diff-cli-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // Helper to write JSON specs and run diff
  async function runDiffWithSpecs(baseDoc: unknown, headDoc: unknown, extraArgs: string[] = []) {
    const baseFile = path.join(fixture.rootDir, 'base.json')
    const headFile = path.join(fixture.rootDir, 'head.json')
    await fs.writeFile(baseFile, JSON.stringify(baseDoc))
    await fs.writeFile(headFile, JSON.stringify(headDoc))
    return runOaCli(['diff', '--base', baseFile, '--head', headFile, ...extraArgs], {
      cwd: fixture.rootDir,
    })
  }

  // =========================================================================
  // Suite 1: The 11 Endpoint Breaking Change Rules
  // =========================================================================
  describe('Suite 1: The 11 Endpoint Breaking Change Rules', () => {
    const standardEndpoint = {
      summary: 'Get items',
      operationId: 'getItems',
      parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        },
      },
    }

    it('T-DIFF-01: endpoint-removed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('endpoint-removed')
    })

    it('T-DIFF-02: operation-id-changed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { get: { ...standardEndpoint, operationId: 'fetchItems' } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('operation-id-changed')
    })

    it('T-DIFF-03: required-parameter-added', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              ...standardEndpoint,
              parameters: [
                ...standardEndpoint.parameters,
                { name: 'tenantId', in: 'query', required: true, schema: { type: 'string' } },
              ],
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('required-parameter-added')
    })

    it('T-DIFF-04: parameter-removed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { get: { ...standardEndpoint, parameters: [] } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-removed')
    })

    it('T-DIFF-05: parameter-required', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              ...standardEndpoint,
              parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }],
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-required')
    })

    it('T-DIFF-06: parameter-schema-changed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              ...standardEndpoint,
              parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'string' } }],
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('parameter-schema-changed')
    })

    it('T-DIFF-07: request-body-required', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { post: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            post: {
              ...standardEndpoint,
              requestBody: { ...standardEndpoint.requestBody, required: true },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-body-required')
    })

    it('T-DIFF-08: request-required-field-added', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { post: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            post: {
              ...standardEndpoint,
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['token'],
                      properties: { name: { type: 'string' }, token: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-required-field-added')
    })

    it('T-DIFF-09: request-schema-changed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { post: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            post: {
              ...standardEndpoint,
              requestBody: {
                required: false,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { name: { type: 'integer' } },
                    },
                  },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('request-schema-changed')
    })

    it('T-DIFF-10: response-removed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              ...standardEndpoint,
              responses: { '404': { description: 'Not found' } },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('response-removed')
    })

    it('T-DIFF-11: response-schema-changed', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: { '/items': { get: standardEndpoint } } }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              ...standardEndpoint,
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'object', properties: { id: { type: 'integer' } } },
                    },
                  },
                },
              },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('response-schema-changed')
    })
  })

  // =========================================================================
  // Suite 2: Component Schema Breaking Rules (component-bundle)
  // =========================================================================
  describe('Suite 2: Component Schema Breaking Rules', () => {
    it('T-DIFF-12: schema-property-removed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { Foo: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { Foo: { type: 'object', properties: {} } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('property-removed')
    })

    it('T-DIFF-13: schema-type-changed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { X: { type: 'object', properties: { count: { type: 'integer' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { X: { type: 'object', properties: { count: { type: 'string' } } } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('type-changed')
    })

    it('T-DIFF-14: schema-required-field-added', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { Req: { type: 'object', properties: { id: { type: 'string' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: {
          schemas: {
            Req: {
              type: 'object',
              required: ['secret'],
              properties: { id: { type: 'string' }, secret: { type: 'string' } },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('required-field-added')
    })

    it('T-DIFF-15: schema-constraint-narrowed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { Val: { type: 'integer', maximum: 100 } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { Val: { type: 'integer', maximum: 50 } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('constraint-narrowed')
    })

    it('T-DIFF-16: schema-removed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { OldModel: { type: 'string' } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: {} },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('schema-removed')
    })
  })

  // =========================================================================
  // Suite 3: Non-Breaking & Additive Changes
  // =========================================================================
  describe('Suite 3: Non-Breaking & Additive Changes', () => {
    it('T-DIFF-17: endpoint-added', async () => {
      const base = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/health': { get: { responses: { '200': { description: 'OK' } } } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('GET /health')
    })

    it('T-DIFF-18: optional-parameter-added', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { get: { responses: { '200': { description: 'OK' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            get: {
              parameters: [{ name: 'sort', in: 'query', required: false, schema: { type: 'string' } }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
    })

    it('T-DIFF-19: response-added', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { post: { responses: { '200': { description: 'OK' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: {
          '/items': {
            post: {
              responses: {
                '200': { description: 'OK' },
                '201': { description: 'Created' },
              },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
    })

    it('T-DIFF-20: schema-property-added (optional)', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: { schemas: { User: { type: 'object', properties: { name: { type: 'string' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: { name: { type: 'string' }, nickname: { type: 'string' } },
            },
          },
        },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
    })

    it('T-DIFF-21: summary-changed', async () => {
      const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { get: { summary: 'Old summary', responses: { '200': { description: 'OK' } } } } },
      }
      const head = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/items': { get: { summary: 'New summary', responses: { '200': { description: 'OK' } } } } },
      }
      const result = await runDiffWithSpecs(base, head, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
    })

    it('T-DIFF-22: identical specs produce zero diff output', async () => {
      const doc = {
        openapi: '3.1.0',
        info: { title: 'Identical', version: '1.0.0' },
        paths: { '/test': { get: { responses: { '200': { description: 'OK' } } } } },
      }
      const result = await runDiffWithSpecs(doc, doc, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No endpoint or schema changes detected')
    })
  })

  // =========================================================================
  // Suite 4: Exit Code & Flag Semantics
  // =========================================================================
  describe('Suite 4: Exit Code & Flag Semantics', () => {
    const breakingBase = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: { '/del': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const breakingHead = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {},
    }

    it('T-DIFF-23: breaking changes WITHOUT --fail-on-breaking exit 0', async () => {
      const result = await runDiffWithSpecs(breakingBase, breakingHead, [])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('#### Breaking Changes')
    })

    it('T-DIFF-24: breaking changes WITH --fail-on-breaking exit 1', async () => {
      const result = await runDiffWithSpecs(breakingBase, breakingHead, ['--fail-on-breaking'])
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('#### Breaking Changes')
    })

    it('T-DIFF-25: non-breaking changes WITHOUT --fail-on-breaking exit 0', async () => {
      const nonBreakingHead = {
        ...breakingBase,
        paths: {
          ...breakingBase.paths,
          '/added': { get: { responses: { '200': { description: 'OK' } } } },
        },
      }
      const result = await runDiffWithSpecs(breakingBase, nonBreakingHead, [])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('#### Added')
    })

    it('T-DIFF-26: non-breaking changes WITH --fail-on-breaking exit 0', async () => {
      const nonBreakingHead = {
        ...breakingBase,
        paths: {
          ...breakingBase.paths,
          '/added': { get: { responses: { '200': { description: 'OK' } } } },
        },
      }
      const result = await runDiffWithSpecs(breakingBase, nonBreakingHead, ['--fail-on-breaking'])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('#### Added')
    })
  })

  // =========================================================================
  // Suite 5: Root-Aware Path Resolution
  // =========================================================================
  describe('Suite 5: Root-Aware Path Resolution', () => {
    it('T-DIFF-27: resolves relative paths via --root from nested subdirectory', async () => {
      const subDir = path.join(fixture.rootDir, 'deep/nested/pkg')
      await fs.mkdir(subDir, { recursive: true })

      await fixture.writeFile('specs/base.json', JSON.stringify({ openapi: '3.1.0', info: { title: 'B', version: '1' } }))
      await fixture.writeFile('specs/head.json', JSON.stringify({ openapi: '3.1.0', info: { title: 'H', version: '1' } }))

      const result = runOaCli(
        ['diff', '--root', fixture.rootDir, '--base', 'specs/base.json', '--head', 'specs/head.json'],
        { cwd: subDir },
      )
      expect(result.status).toBe(0)
    })

    it('T-DIFF-28: resolves relative paths via --project-root alias', async () => {
      const subDir = path.join(fixture.rootDir, 'deep/sub')
      await fs.mkdir(subDir, { recursive: true })

      await fixture.writeFile('specs/base.json', JSON.stringify({ openapi: '3.1.0', info: { title: 'B', version: '1' } }))
      await fixture.writeFile('specs/head.json', JSON.stringify({ openapi: '3.1.0', info: { title: 'H', version: '1' } }))

      const result = runOaCli(
        ['diff', '--project-root', fixture.rootDir, '--base', 'specs/base.json', '--head', 'specs/head.json'],
        { cwd: subDir },
      )
      expect(result.status).toBe(0)
    })
  })

  // =========================================================================
  // Suite 6: CLI Error Handling & Validation
  // =========================================================================
  describe('Suite 6: CLI Error Handling & Validation', () => {
    it('T-DIFF-30: exits 1 when --base option is missing', () => {
      const result = runOaCli(['diff', '--head', 'head.json'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('base')
    })

    it('T-DIFF-31: exits 1 when --head option is missing', () => {
      const result = runOaCli(['diff', '--base', 'base.json'], { cwd: fixture.rootDir })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('head')
    })

    it('T-DIFF-32: exits 1 when --base file does not exist', () => {
      const result = runOaCli(['diff', '--base', '/nonexistent/base.json', '--head', 'head.json'], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('스펙 파일 읽기 실패')
    })

    it('T-DIFF-33: exits 1 when --head file does not exist', async () => {
      const baseFile = path.join(fixture.rootDir, 'base.json')
      await fs.writeFile(baseFile, '{}')
      const result = runOaCli(['diff', '--base', baseFile, '--head', '/nonexistent/head.json'], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('스펙 파일 읽기 실패')
    })

    it('T-DIFF-34: seamlessly diffs YAML base against JSON head', async () => {
      const yamlBase = path.join(fixture.rootDir, 'base.yaml')
      const jsonHead = path.join(fixture.rootDir, 'head.json')

      await fs.writeFile(yamlBase, 'openapi: 3.1.0\ninfo:\n  title: Y\n  version: 1.0.0\npaths: {}\n')
      await fs.writeFile(jsonHead, JSON.stringify({ openapi: '3.1.0', info: { title: 'Y', version: '1.0.0' }, paths: {} }))

      const result = runOaCli(['diff', '--base', yamlBase, '--head', jsonHead], {
        cwd: fixture.rootDir,
      })
      expect(result.status).toBe(0)
    })
  })
})
