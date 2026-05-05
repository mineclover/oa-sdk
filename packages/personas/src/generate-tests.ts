/**
 * v0.5 — vitest suite generator.
 *
 * Pure function that converts (spec, matrices) → a vitest test file string.
 * Each implemented persona becomes one `it()` block that:
 *   1. switches the mock-server to the persona's overrides
 *   2. invokes the operation via TestClient
 *   3. asserts the response status matches outcome.expects[0]
 *
 * Stable output (sorted by domain then persona id) so diffs are minimal.
 */

import { findOperation } from './resolver.js'
import type { MinimalOpenApiDoc } from './bind.js'
import type { DomainMatrix, Persona } from './types.js'

export interface GenerateTestsOptions {
  spec: MinimalOpenApiDoc
  domains: DomainMatrix[]
  /** Title for the generated `describe` block. */
  describeTitle?: string
  /**
   * Path to the merged spec, *relative to the test output file*. Will be
   * resolved at runtime via `new URL(relPath, import.meta.url)` so the
   * generated suite is portable (no absolute paths in the file).
   */
  specRelativePath: string
}

interface GeneratedItem {
  matrix: DomainMatrix
  persona: Persona
  path: string
  method: string
  status: number
  body: unknown | null
}

// TestClient.delete signature is (path, opts) — no body. Match that here even
// though OpenAPI permits DELETE with bodies; we use overrides anyway.
const HTTP_METHODS_WITH_BODY = new Set(['post', 'put', 'patch'])
const HTTP_METHODS_NO_BODY = new Set(['get', 'head', 'options', 'delete'])

export function generateVitestSuite(opts: GenerateTestsOptions): string {
  const items = collectItems(opts.spec, opts.domains)

  const header = renderHeader(opts.specRelativePath)
  const fixture = renderFixture()
  const tests = items.map(renderTestBlock).join('\n')
  const title = opts.describeTitle ?? 'persona roleplay (generated)'

  return [
    header,
    '',
    fixture,
    '',
    `describe(${JSON.stringify(title)}, () => {`,
    `  beforeAll(setup)`,
    `  afterAll(teardown)`,
    `  beforeEach(() => server.clearOverrides())`,
    '',
    tests,
    '})',
    '',
  ].join('\n')
}

// ─── collection ───────────────────────────────────────────────────────────

function collectItems(spec: MinimalOpenApiDoc, domains: DomainMatrix[]): GeneratedItem[] {
  const items: GeneratedItem[] = []
  for (const matrix of domains) {
    for (const persona of matrix.personas) {
      if (persona.status !== 'implemented') continue
      const expects = persona.outcome?.expects ?? []
      const ids = persona.outcome?.maps_to ?? []
      if (expects.length === 0 || ids.length === 0) continue

      const status = expects[0]!
      for (const opId of ids) {
        const op = findOperation(spec, opId)
        if (!op) continue
        const method = op.method.toLowerCase()
        // Merge path-level + operation-level parameters per OpenAPI semantics.
        const pathItem = (spec.paths?.[op.path] ?? {}) as Record<string, unknown>
        const pathParams = (pathItem['parameters'] as Array<Record<string, unknown>> | undefined) ?? []
        const opParams = (op.operation['parameters'] as Array<Record<string, unknown>> | undefined) ?? []
        const allParams = [...pathParams, ...opParams]
        items.push({
          matrix,
          persona,
          path: substitutePathParams(op.path, allParams),
          method,
          status,
          body: HTTP_METHODS_WITH_BODY.has(method) ? extractRequestBody(op.operation) : null,
        })
      }
    }
  }
  items.sort((a, b) =>
    a.matrix.domain.localeCompare(b.matrix.domain) ||
    a.persona.id.localeCompare(b.persona.id) ||
    a.path.localeCompare(b.path),
  )
  return items
}

// ─── path / body extraction ────────────────────────────────────────────────

const DEFAULT_UUID = '00000000-0000-0000-0000-000000000001'

function substitutePathParams(template: string, params: Array<Record<string, unknown>>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    const param = params.find(p => p['in'] === 'path' && p['name'] === name)
    if (param) {
      const ex = paramExample(param)
      if (ex !== undefined) return String(ex)
      const schema = param['schema'] as Record<string, unknown> | undefined
      if (schema?.['format'] === 'uuid') return DEFAULT_UUID
      if (schema?.['type'] === 'integer' || schema?.['type'] === 'number') return '1'
    }
    return 'example'
  })
}

function paramExample(param: Record<string, unknown>): unknown {
  if ('example' in param) return param['example']
  const examples = param['examples'] as Record<string, Record<string, unknown>> | undefined
  if (examples) {
    const first = examples['default'] ?? Object.values(examples)[0]
    if (first) {
      if ('dataValue' in first) return first['dataValue']
      if ('value' in first) return first['value']
    }
  }
  const schema = param['schema'] as Record<string, unknown> | undefined
  if (schema && 'example' in schema) return schema['example']
  return undefined
}

function extractRequestBody(operation: Record<string, unknown>): unknown | null {
  const requestBody = operation['requestBody'] as Record<string, unknown> | undefined
  if (!requestBody) return null
  const content = requestBody['content'] as Record<string, Record<string, unknown>> | undefined
  if (!content) return null
  const mediaType = content['application/json']
  if (!mediaType) return null

  const examples = mediaType['examples'] as Record<string, Record<string, unknown>> | undefined
  if (examples) {
    const first = examples['default'] ?? Object.values(examples)[0]
    if (first) {
      if ('dataValue' in first) return first['dataValue']
      if ('value' in first) return first['value']
    }
  }
  if ('example' in mediaType) return mediaType['example']
  const schema = mediaType['schema'] as Record<string, unknown> | undefined
  if (schema && 'example' in schema) return schema['example']
  return null
}

// ─── rendering ─────────────────────────────────────────────────────────────

function renderHeader(specRelativePath: string): string {
  return [
    '// AUTO-GENERATED — do not edit by hand.',
    "// Run `pnpm --filter @oa-sdk/personas gen:tests` to regenerate.",
    '',
    "import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'",
    "import { readFileSync } from 'node:fs'",
    "import { fileURLToPath } from 'node:url'",
    "import { parse } from 'yaml'",
    '',
    "import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'",
    "import { createTestClient, type TestClient } from '@oa-sdk/mock-server'",
    "import { createPersonaMockClient, loadAllDomains, type MinimalOpenApiDoc, type PersonaMockClient } from '@oa-sdk/personas'",
    '',
    `const SPEC_PATH = fileURLToPath(new URL(${JSON.stringify(specRelativePath)}, import.meta.url))`,
  ].join('\n')
}

function renderFixture(): string {
  return [
    'let server: NodeMockServer',
    'let client: TestClient',
    'let personas: PersonaMockClient',
    '',
    'async function setup(): Promise<void> {',
    "  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as MinimalOpenApiDoc",
    '  const domains = loadAllDomains()',
    '  server = createNodeMockServer(spec as Parameters<typeof createNodeMockServer>[0], { port: 0 })',
    '  await server.start()',
    '  client = createTestClient(server)',
    '  personas = createPersonaMockClient({ spec, domains })',
    '}',
    '',
    'async function teardown(): Promise<void> {',
    '  if (server) await server.stop()',
    '}',
  ].join('\n')
}

function renderTestBlock(item: GeneratedItem): string {
  const { persona, matrix, path, method, status, body } = item
  const upperMethod = method.toUpperCase()
  const callExpr = renderClientCall(method, path, body)
  return [
    `  // ── ${matrix.domain}/${persona.id} ──`,
    `  it(${JSON.stringify(`${persona.id} → ${upperMethod} ${path} → ${status}`)}, async () => {`,
    `    personas.switchTo(server, ${JSON.stringify(persona.id)})`,
    `    const res = ${callExpr}`,
    `    expect(res.status).toBe(${status})`,
    `  })`,
    '',
  ].join('\n')
}

function renderClientCall(method: string, path: string, body: unknown | null): string {
  const headers = "{ headers: { authorization: 'Bearer t' } }"
  const pathLit = JSON.stringify(path)
  if (HTTP_METHODS_NO_BODY.has(method)) {
    return `await client.${method}(${pathLit}, ${headers})`
  }
  // body methods: post/put/patch/delete
  const bodyLit = body === null ? 'undefined' : JSON.stringify(body)
  return `await client.${method}(${pathLit}, ${bodyLit}, ${headers})`
}
