import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDefinitionNode,
  createDefinitionRegistry,
  emitDefinitionOpenApiDocument,
  selectDefinitionTarget,
  type CanonicalDefinitionId,
  type DefinitionNode,
  type DefinitionTargetConfig,
} from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dir, '../../../..')
const schemasDir = join(repoRoot, 'packages/schemas/src')
const fragmentsDir = join(schemasDir, 'fragments')

type HealthFragmentFixture = {
  id: CanonicalDefinitionId
  relativePath: string
  sourcePath?: string
  sourceSchema?: string
}

const HEALTH_FRAGMENTS: readonly HealthFragmentFixture[] = [
  {
    id: 'schema:public/health/HealthStatus',
    relativePath: 'schema/public/health/HealthStatus.yaml',
    sourceSchema: 'HealthStatus',
  },
  {
    id: 'path:public/health/HealthPath',
    relativePath: 'path/public/health/HealthPath.yaml',
    sourcePath: '/health',
  },
  {
    id: 'path:public/health/HealthStreamPath',
    relativePath: 'path/public/health/HealthStreamPath.yaml',
    sourcePath: '/health/stream',
  },
] as const

const HEALTH_CANONICAL_REF_REWRITES: Readonly<Record<string, string>> = {
  '#/components/schemas/HealthStatus': 'oa://schema/public/health/HealthStatus',
  '#/components/responses/ServiceUnavailable': 'oa://response/shared/common/ServiceUnavailable',
}

const HEALTH_OUTPUT_REF_REWRITES: Readonly<Record<string, string>> = {
  '#/components/schemas/HealthStatus': '#/components/schemas/HealthStatus',
  '#/components/responses/ServiceUnavailable': '#/components/responses/ServiceUnavailable',
}

const CANONICAL_TO_OUTPUT_REF_REWRITES: Readonly<Record<string, string>> = {
  'oa://schema/public/health/HealthStatus': '#/components/schemas/HealthStatus',
  'oa://response/shared/common/ServiceUnavailable': '#/components/responses/ServiceUnavailable',
  'oa://schema/shared/common/Error': '#/components/schemas/Error',
  'oa://schema/shared/common/ValidationError': '#/components/schemas/ValidationError',
}

describe('builder health fragments', () => {
  it('matches current health domain paths and schema with canonical refs', () => {
    const healthSpec = readYaml(join(schemasDir, 'domains/health/spec.yaml'))

    for (const fragmentFixture of HEALTH_FRAGMENTS) {
      const fragment = readFragment(fragmentFixture.relativePath)

      expect(fragment.id).toBe(fragmentFixture.id)
      if (fragmentFixture.sourcePath) {
        expect(fragment.metadata).toEqual({ path: fragmentFixture.sourcePath })
        expect(fragment.content).toEqual(rewriteRefs(
          readHealthSourcePath(healthSpec, fragmentFixture.sourcePath),
          HEALTH_CANONICAL_REF_REWRITES,
        ))
      }
      if (fragmentFixture.sourceSchema) {
        expect(fragment.content).toEqual(readHealthSourceSchema(healthSpec, fragmentFixture.sourceSchema))
      }
      expect(JSON.stringify(fragment.content)).not.toContain('#/components/')
    }
  })

  it('emits health paths and selected components equivalent to the current merge sources', () => {
    const healthSpec = readYaml(join(schemasDir, 'domains/health/spec.yaml'))
    const commonSpec = readYaml(join(schemasDir, 'domains/common/spec.yaml'))
    const registry = createDefinitionRegistry([
      ...loadCommonFragmentNodes(),
      ...loadHealthFragmentNodes(),
    ])
    const target = healthTarget()
    const selection = selectDefinitionTarget(registry, target)
    const emitted = emitDefinitionOpenApiDocument(selection, {
      info: {
        title: 'Health parity probe',
        version: '0.0.0',
      },
    })

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(selection.directPathIds).toEqual([
      'path:public/health/HealthPath',
      'path:public/health/HealthStreamPath',
    ])
    expect(emitted.valid).toBe(true)
    expect(JSON.stringify(emitted.document)).not.toContain('oa://')

    expect(emitted.document.paths?.['/health']).toEqual(rewriteRefs(
      readHealthSourcePath(healthSpec, '/health'),
      HEALTH_OUTPUT_REF_REWRITES,
    ))
    expect(emitted.document.paths?.['/health/stream']).toEqual(rewriteRefs(
      readHealthSourcePath(healthSpec, '/health/stream'),
      HEALTH_OUTPUT_REF_REWRITES,
    ))

    expect(Object.keys(emitted.document.components?.schemas ?? {}).sort()).toEqual([
      'Error',
      'HealthStatus',
      'ValidationError',
    ])
    expect(Object.keys(emitted.document.components?.responses ?? {})).toEqual(['ServiceUnavailable'])
    expect(emitted.document.components?.schemas?.['HealthStatus'])
      .toEqual(readHealthSourceSchema(healthSpec, 'HealthStatus'))
    expect(emitted.document.components?.responses?.['ServiceUnavailable']).toEqual(rewriteRefs(
      readCommonSourceComponent(commonSpec, 'responses', 'ServiceUnavailable'),
      CANONICAL_TO_OUTPUT_REF_REWRITES,
    ))
    expect(emitted.document.components?.schemas?.['Error']).toEqual(rewriteRefs(
      readCommonSourceComponent(commonSpec, 'schemas', 'Error'),
      CANONICAL_TO_OUTPUT_REF_REWRITES,
    ))
    expect(emitted.document.components?.schemas?.['ValidationError'])
      .toEqual(readCommonSourceComponent(commonSpec, 'schemas', 'ValidationError'))
  })

  it('preserves a health stream SSE itemSchema when the stream response declares one', () => {
    const streamNode = loadFragmentNode(join(fragmentsDir, 'path/public/health/HealthStreamPath.yaml'))
    const streamContent = cloneRecord(streamNode.content)
    const okResponse = recordAt(recordAt(recordAt(streamContent, 'get'), 'responses'), '200')
    okResponse.content = {
      'text/event-stream': {
        itemSchema: { $ref: 'oa://schema/public/health/HealthStatus' },
      },
    }

    const registry = createDefinitionRegistry([
      ...loadCommonFragmentNodes(),
      loadFragmentNode(join(fragmentsDir, 'schema/public/health/HealthStatus.yaml')),
      createDefinitionNode({
        id: streamNode.id,
        sourcePath: streamNode.sourcePath,
        sourcePointer: streamNode.sourcePointer,
        contentHash: 'sha256:health-stream-with-item-schema',
        content: streamContent,
        ...(streamNode.metadata ? { metadata: streamNode.metadata } : {}),
      }),
    ])
    const selection = selectDefinitionTarget(registry, {
      ...healthTarget(),
      includePaths: ['/health/stream'],
    })
    const emitted = emitDefinitionOpenApiDocument(selection, {
      info: {
        title: 'Health stream item schema probe',
        version: '0.0.0',
      },
    })

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(emitted.valid).toBe(true)
    expect(
      (((emitted.document.paths?.['/health/stream'] as Record<string, unknown>).get as Record<string, unknown>)
        .responses as Record<string, Record<string, unknown>>)['200']?.content,
    ).toEqual({
      'text/event-stream': {
        itemSchema: { $ref: '#/components/schemas/HealthStatus' },
      },
    })
  })
})

function healthTarget(): DefinitionTargetConfig {
  return {
    name: 'health-parity-probe',
    scopes: ['shared', 'public'],
    domains: ['common', 'health'],
    servers: [{ url: 'https://example.invalid' }],
    includePaths: ['/health', '/health/stream'],
  }
}

function loadHealthFragmentNodes(): DefinitionNode[] {
  return HEALTH_FRAGMENTS.map(fragment => loadFragmentNode(join(fragmentsDir, fragment.relativePath)))
}

function loadCommonFragmentNodes(): DefinitionNode[] {
  return listDefinitionFiles(join(fragmentsDir, 'schema/shared/common'))
    .concat(listDefinitionFiles(join(fragmentsDir, 'response/shared/common')))
    .map(loadFragmentNode)
}

function loadFragmentNode(filePath: string): DefinitionNode {
  const fragment = readYaml(filePath)
  if (!isRecord(fragment) || typeof fragment.id !== 'string' || !Object.prototype.hasOwnProperty.call(fragment, 'content')) {
    throw new Error(`Invalid definition fragment: ${filePath}`)
  }

  return createDefinitionNode({
    id: fragment.id,
    sourcePath: filePath,
    sourcePointer: '#/content',
    contentHash: `sha256:${fragment.id}`,
    content: fragment.content,
    ...(isRecord(fragment.metadata) ? { metadata: fragment.metadata } : {}),
  })
}

function listDefinitionFiles(directory: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listDefinitionFiles(entryPath))
      continue
    }
    if (entry.isFile() && /\.(ya?ml|json)$/.test(entry.name)) {
      files.push(entryPath)
    }
  }

  return files.sort((left, right) => left.localeCompare(right))
}

function readFragment(relativePath: string): { id?: unknown; metadata?: unknown; content?: unknown } {
  const fragment = readYaml(join(fragmentsDir, relativePath))
  if (!isRecord(fragment)) throw new Error(`Invalid fragment fixture: ${relativePath}`)
  return fragment
}

function readHealthSourcePath(healthSpec: unknown, path: string): unknown {
  if (!isRecord(healthSpec) || !isRecord(healthSpec.paths) || !Object.prototype.hasOwnProperty.call(healthSpec.paths, path)) {
    throw new Error(`Missing health source path: ${path}`)
  }
  return healthSpec.paths[path]
}

function readHealthSourceSchema(healthSpec: unknown, name: string): unknown {
  if (!isRecord(healthSpec) || !isRecord(healthSpec.components) || !isRecord(healthSpec.components.schemas)) {
    throw new Error('Invalid health source schemas.')
  }
  if (!Object.prototype.hasOwnProperty.call(healthSpec.components.schemas, name)) {
    throw new Error(`Missing health source schema: ${name}`)
  }
  return healthSpec.components.schemas[name]
}

function readCommonSourceComponent(commonSpec: unknown, sectionName: string, componentName: string): unknown {
  if (!isRecord(commonSpec) || !isRecord(commonSpec.components)) {
    throw new Error('Invalid common source spec.')
  }
  const section = commonSpec.components[sectionName]
  if (!isRecord(section) || !Object.prototype.hasOwnProperty.call(section, componentName)) {
    throw new Error(`Missing common source component: ${sectionName}.${componentName}`)
  }
  return section[componentName]
}

function rewriteRefs(value: unknown, rewrites: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map(item => rewriteRefs(item, rewrites))

  if (isRecord(value)) {
    const rewritten: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      rewritten[key] = key === '$ref' && typeof child === 'string'
        ? rewrites[child] ?? child
        : rewriteRefs(child, rewrites)
    }
    return rewritten
  }

  return value
}

function cloneRecord(value: unknown): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(value)) as unknown
  if (!isRecord(cloned)) throw new Error('Expected cloned value to be an object.')
  return cloned
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) throw new Error(`Expected object at key: ${key}`)
  return value
}

function readYaml(filePath: string): unknown {
  return parseYaml(readFileSync(filePath, 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
