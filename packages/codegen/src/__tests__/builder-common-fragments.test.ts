import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  allocateDefinitionOutputNames,
  createDefinitionNode,
  createDefinitionRef,
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
const approvedOpenApiPath = join(repoRoot, 'packages/schemas/typespec/approved.openapi.yaml')

type CommonComponentSection = 'schemas' | 'responses' | 'parameters' | 'securitySchemes'

type CommonComponentFixture = {
  id: CanonicalDefinitionId
  sourceSection: CommonComponentSection
  sourceName: string
  relativePath: string
  outputName: string
}

const COMMON_COMPONENTS = [
  {
    id: 'schema:shared/common/Error',
    sourceSection: 'schemas',
    sourceName: 'Error',
    relativePath: 'schema/shared/common/Error.yaml',
    outputName: 'Error',
  },
  {
    id: 'schema:shared/common/ValidationError',
    sourceSection: 'schemas',
    sourceName: 'ValidationError',
    relativePath: 'schema/shared/common/ValidationError.yaml',
    outputName: 'ValidationError',
  },
  {
    id: 'schema:shared/common/ValidationReceivedStringSummary',
    sourceSection: 'schemas',
    sourceName: 'ValidationReceivedStringSummary',
    relativePath: 'schema/shared/common/ValidationReceivedStringSummary.yaml',
    outputName: 'ValidationReceivedStringSummary',
  },
  {
    id: 'schema:shared/common/ValidationReceivedArraySummary',
    sourceSection: 'schemas',
    sourceName: 'ValidationReceivedArraySummary',
    relativePath: 'schema/shared/common/ValidationReceivedArraySummary.yaml',
    outputName: 'ValidationReceivedArraySummary',
  },
  {
    id: 'schema:shared/common/ValidationReceivedObjectSummary',
    sourceSection: 'schemas',
    sourceName: 'ValidationReceivedObjectSummary',
    relativePath: 'schema/shared/common/ValidationReceivedObjectSummary.yaml',
    outputName: 'ValidationReceivedObjectSummary',
  },
  {
    id: 'schema:shared/common/ValidationReceivedScalarSummary',
    sourceSection: 'schemas',
    sourceName: 'ValidationReceivedScalarSummary',
    relativePath: 'schema/shared/common/ValidationReceivedScalarSummary.yaml',
    outputName: 'ValidationReceivedScalarSummary',
  },
  {
    id: 'response:shared/common/BadRequest',
    sourceSection: 'responses',
    sourceName: 'BadRequest',
    relativePath: 'response/shared/common/BadRequest.yaml',
    outputName: 'BadRequest',
  },
  {
    id: 'response:shared/common/Unauthorized',
    sourceSection: 'responses',
    sourceName: 'Unauthorized',
    relativePath: 'response/shared/common/Unauthorized.yaml',
    outputName: 'Unauthorized',
  },
  {
    id: 'response:shared/common/Forbidden',
    sourceSection: 'responses',
    sourceName: 'Forbidden',
    relativePath: 'response/shared/common/Forbidden.yaml',
    outputName: 'Forbidden',
  },
  {
    id: 'response:shared/common/NotFound',
    sourceSection: 'responses',
    sourceName: 'NotFound',
    relativePath: 'response/shared/common/NotFound.yaml',
    outputName: 'NotFound',
  },
  {
    id: 'response:shared/common/Conflict',
    sourceSection: 'responses',
    sourceName: 'Conflict',
    relativePath: 'response/shared/common/Conflict.yaml',
    outputName: 'Conflict',
  },
  {
    id: 'response:shared/common/UnprocessableEntity',
    sourceSection: 'responses',
    sourceName: 'UnprocessableEntity',
    relativePath: 'response/shared/common/UnprocessableEntity.yaml',
    outputName: 'UnprocessableEntity',
  },
  {
    id: 'response:shared/common/TooManyRequests',
    sourceSection: 'responses',
    sourceName: 'TooManyRequests',
    relativePath: 'response/shared/common/TooManyRequests.yaml',
    outputName: 'TooManyRequests',
  },
  {
    id: 'response:shared/common/InternalServerError',
    sourceSection: 'responses',
    sourceName: 'InternalServerError',
    relativePath: 'response/shared/common/InternalServerError.yaml',
    outputName: 'InternalServerError',
  },
  {
    id: 'response:shared/common/ServiceUnavailable',
    sourceSection: 'responses',
    sourceName: 'ServiceUnavailable',
    relativePath: 'response/shared/common/ServiceUnavailable.yaml',
    outputName: 'ServiceUnavailable',
  },
  {
    id: 'parameter:shared/common/Page',
    sourceSection: 'parameters',
    sourceName: 'Page',
    relativePath: 'parameter/shared/common/Page.yaml',
    outputName: 'Page',
  },
  {
    id: 'parameter:shared/common/Limit',
    sourceSection: 'parameters',
    sourceName: 'Limit',
    relativePath: 'parameter/shared/common/Limit.yaml',
    outputName: 'Limit',
  },
  {
    id: 'securityScheme:shared/common/BearerAuth',
    sourceSection: 'securitySchemes',
    sourceName: 'bearerAuth',
    relativePath: 'securityScheme/shared/common/BearerAuth.yaml',
    outputName: 'bearerAuth',
  },
  {
    id: 'securityScheme:shared/common/OAuth2',
    sourceSection: 'securitySchemes',
    sourceName: 'oauth2',
    relativePath: 'securityScheme/shared/common/OAuth2.yaml',
    outputName: 'oauth2',
  },
] as const satisfies readonly CommonComponentFixture[]

const COMMON_REF_REWRITES: Readonly<Record<string, string>> = {
  '#/components/schemas/Error': 'oa://schema/shared/common/Error',
  '#/components/schemas/ValidationError': 'oa://schema/shared/common/ValidationError',
  '#/components/schemas/ValidationReceivedStringSummary': 'oa://schema/shared/common/ValidationReceivedStringSummary',
  '#/components/schemas/ValidationReceivedArraySummary': 'oa://schema/shared/common/ValidationReceivedArraySummary',
  '#/components/schemas/ValidationReceivedObjectSummary': 'oa://schema/shared/common/ValidationReceivedObjectSummary',
  '#/components/schemas/ValidationReceivedScalarSummary': 'oa://schema/shared/common/ValidationReceivedScalarSummary',
}

const COMMON_OUTPUT_ALIASES = {
  'securityScheme:shared/common/BearerAuth': 'bearerAuth',
  'securityScheme:shared/common/OAuth2': 'oauth2',
} as const

describe('builder shared common fragments', () => {
  it('matches current TypeSpec-approved common components with canonical refs', () => {
    const approvedOpenApi = readYaml(approvedOpenApiPath)

    for (const component of COMMON_COMPONENTS) {
      const sourceContent = readApprovedComponent(approvedOpenApi, component)
      const fragment = readFragment(component.relativePath)

      expect(fragment.id).toBe(component.id)
      expect(fragment.content).toEqual(rewriteCommonSourceRefs(sourceContent))
      expect(JSON.stringify(fragment.content)).not.toContain('#/components/')
    }
  })

  it('registers common fragments without duplicate canonical ids', () => {
    const registry = createDefinitionRegistry(loadAllFragmentNodes())
    const duplicateDiagnostics = registry.diagnostics.filter(diagnostic => {
      return diagnostic.code === 'definition-registry/duplicate-id'
    })

    expect(registry.valid).toBe(true)
    expect(duplicateDiagnostics).toEqual([])
    expect(sortedIds(registry.nodes.filter(node => node.scope === 'shared' && node.domain === 'common'))).toEqual(
      COMMON_COMPONENTS.map(component => component.id).sort(),
    )
  })

  it('emits shared component names, using explicit security aliases', () => {
    const registry = createDefinitionRegistry([
      ...loadCommonFragmentNodes(),
      commonProbePathNode(),
    ])
    const target: DefinitionTargetConfig = {
      name: 'common-parity-probe',
      scopes: ['shared', 'public'],
      domains: ['common'],
      servers: [{ url: 'https://example.invalid' }],
      includePaths: ['/__common-probe'],
      namingPolicy: {
        aliases: COMMON_OUTPUT_ALIASES,
      },
    }
    const selection = selectDefinitionTarget(registry, target)
    const allocation = allocateDefinitionOutputNames(selection.nodes, {
      targetName: target.name,
      aliases: COMMON_OUTPUT_ALIASES,
    })
    const emitted = emitDefinitionOpenApiDocument(selection, {
      info: {
        title: 'Common parity probe',
        version: '0.0.0',
      },
    })

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(allocation.valid).toBe(true)
    expect(emitted.valid).toBe(true)
    expect(commonOutputNames(allocation.outputNames)).toEqual(expectedCommonOutputNames())
    expect(componentKeys(emitted.document.components?.schemas)).toEqual(sourceNamesFor('schemas'))
    expect(componentKeys(emitted.document.components?.responses)).toEqual(sourceNamesFor('responses'))
    expect(componentKeys(emitted.document.components?.parameters)).toEqual(sourceNamesFor('parameters'))
    expect(componentKeys(emitted.document.components?.securitySchemes)).toEqual(sourceNamesFor('securitySchemes'))
  })
})

function commonProbePathNode(): DefinitionNode {
  const id = 'path:public/common/CommonProbePath'
  const sourcePath = '/workspace/fragments/path/public/common/CommonProbePath.yaml'

  return createDefinitionNode({
    id,
    sourcePath,
    sourcePointer: '#/content',
    contentHash: 'sha256:common-probe',
    metadata: {
      path: '/__common-probe',
    },
    content: {
      get: {
        operationId: 'probeCommonFragments',
        security: [
          { bearerAuth: [] },
          { oauth2: ['read'] },
        ],
        parameters: [
          { $ref: 'oa://parameter/shared/common/Page' },
          { $ref: 'oa://parameter/shared/common/Limit' },
        ],
        responses: {
          '200': { description: 'OK' },
          '400': { $ref: 'oa://response/shared/common/BadRequest' },
          '401': { $ref: 'oa://response/shared/common/Unauthorized' },
          '403': { $ref: 'oa://response/shared/common/Forbidden' },
          '404': { $ref: 'oa://response/shared/common/NotFound' },
          '409': { $ref: 'oa://response/shared/common/Conflict' },
          '422': { $ref: 'oa://response/shared/common/UnprocessableEntity' },
          '429': { $ref: 'oa://response/shared/common/TooManyRequests' },
          '500': { $ref: 'oa://response/shared/common/InternalServerError' },
          '503': { $ref: 'oa://response/shared/common/ServiceUnavailable' },
        },
      },
    },
    refs: [
      createDefinitionRef({
        ref: 'oa://securityScheme/shared/common/BearerAuth',
        sourcePath,
        sourcePointer: '#/content/get/security/0/bearerAuth',
      }),
      createDefinitionRef({
        ref: 'oa://securityScheme/shared/common/OAuth2',
        sourcePath,
        sourcePointer: '#/content/get/security/1/oauth2',
      }),
    ],
  })
}

function loadCommonFragmentNodes(): DefinitionNode[] {
  return COMMON_COMPONENTS.map(component => loadFragmentNode(join(fragmentsDir, component.relativePath)))
}

function loadAllFragmentNodes(): DefinitionNode[] {
  return listDefinitionFiles(fragmentsDir).map(loadFragmentNode)
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

function readFragment(relativePath: string): { id?: unknown; content?: unknown } {
  const fragment = readYaml(join(fragmentsDir, relativePath))
  if (!isRecord(fragment)) throw new Error(`Invalid fragment fixture: ${relativePath}`)
  return fragment
}

function readApprovedComponent(approvedOpenApi: unknown, component: CommonComponentFixture): unknown {
  if (!isRecord(approvedOpenApi) || !isRecord(approvedOpenApi.components)) {
    throw new Error('Invalid approved OpenAPI components.')
  }
  const section = approvedOpenApi.components[component.sourceSection]
  if (!isRecord(section) || !Object.prototype.hasOwnProperty.call(section, component.sourceName)) {
    throw new Error(`Missing approved OpenAPI component: ${component.sourceSection}.${component.sourceName}`)
  }
  return section[component.sourceName]
}

function rewriteCommonSourceRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => rewriteCommonSourceRefs(item))

  if (isRecord(value)) {
    const rewritten: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      rewritten[key] = key === '$ref' && typeof child === 'string'
        ? COMMON_REF_REWRITES[child] ?? child
        : rewriteCommonSourceRefs(child)
    }
    return rewritten
  }

  return value
}

function commonOutputNames(outputNames: ReadonlyMap<CanonicalDefinitionId, string>): Array<[CanonicalDefinitionId, string]> {
  const commonIds = new Set<CanonicalDefinitionId>(COMMON_COMPONENTS.map(component => component.id))
  return [...outputNames.entries()]
    .filter(([id]) => commonIds.has(id))
    .sort(([left], [right]) => left.localeCompare(right))
}

function expectedCommonOutputNames(): Array<[CanonicalDefinitionId, string]> {
  return COMMON_COMPONENTS
    .map(component => [component.id, component.outputName] as [CanonicalDefinitionId, string])
    .sort(([left], [right]) => left.localeCompare(right))
}

function sourceNamesFor(section: CommonComponentSection): string[] {
  return COMMON_COMPONENTS
    .filter(component => component.sourceSection === section)
    .map(component => component.sourceName)
    .sort()
}

function componentKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}

function sortedIds(nodes: readonly DefinitionNode[]): CanonicalDefinitionId[] {
  return nodes.map(node => node.id).sort()
}

function readYaml(filePath: string): unknown {
  return parseYaml(readFileSync(filePath, 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
