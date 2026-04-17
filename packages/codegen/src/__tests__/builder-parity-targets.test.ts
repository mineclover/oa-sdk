import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDefinitionNode,
  createDefinitionRef,
  createDefinitionRegistry,
  selectDefinitionTarget,
  type DefinitionTargetConfig,
  type DefinitionNode,
} from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dir, '../../../..')
const schemasDir = join(repoRoot, 'packages/schemas/src')

const PROFILE_PARITY_TARGETS = [
  ['local', 'local-parity-api'],
  ['staging', 'staging-parity-api'],
  ['production', 'production-parity-api'],
] as const

const SHARED_COMMON_OUTPUT_ALIASES = {
  'securityScheme:shared/common/BearerAuth': 'bearerAuth',
  'securityScheme:shared/common/OAuth2': 'oauth2',
} as const

describe('builder parity target configs', () => {
  it('declares profile-parity targets with current profile servers and merged paths', () => {
    const currentMergedPaths = readCurrentMergedDomainPaths()

    for (const [profileName, targetName] of PROFILE_PARITY_TARGETS) {
      const profilePath = join(schemasDir, 'profiles', `${profileName}.yaml`)
      if (!existsSync(profilePath)) continue

      const target = readTargetConfig(`${targetName}.yaml`)

      expect(target.name).toBe(targetName)
      expect(target.scopes).toEqual(['shared', 'public'])
      expect(target.domains).toEqual(['common', 'health', 'users'])
      expect(target.info).toEqual(readRootInfo())
      expect(target.servers).toEqual(readProfileServers(profileName))
      expect(target.tags).toEqual(readRootTags())
      expect(target.includePaths).toEqual(currentMergedPaths)
      expect(target.includeDefinitions).toEqual(['securityScheme:shared/common/OAuth2'])
      expect(target.namingPolicy).toEqual({ aliases: SHARED_COMMON_OUTPUT_ALIASES })
    }
  })

  it('selects local parity direct paths and shared refs', () => {
    const target = readTargetConfig('local-parity-api.yaml')
    const registry = createDefinitionRegistry(paritySelectionNodes())
    const selection = selectDefinitionTarget(registry, target)

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(selection.directPathIds).toEqual([
      'path:public/health/HealthPath',
      'path:public/health/HealthStreamPath',
      'path:public/users/UsersPath',
      'path:public/users/UserByIdPath',
    ])
    expect(sortedIds(selection.nodes)).toEqual([
      'parameter:shared/common/Limit',
      'parameter:shared/common/Page',
      'path:public/health/HealthPath',
      'path:public/health/HealthStreamPath',
      'path:public/users/UserByIdPath',
      'path:public/users/UsersPath',
      'response:shared/common/BadRequest',
      'response:shared/common/Forbidden',
      'response:shared/common/InternalServerError',
      'response:shared/common/NotFound',
      'response:shared/common/ServiceUnavailable',
      'response:shared/common/Unauthorized',
      'response:shared/common/UnprocessableEntity',
      'schema:public/health/HealthStatus',
      'schema:public/users/CreateUserRequest',
      'schema:public/users/UpdateUserRequest',
      'schema:public/users/User',
      'schema:shared/common/Error',
      'schema:shared/common/ValidationError',
      'securityScheme:shared/common/BearerAuth',
      'securityScheme:shared/common/OAuth2',
    ])
    expect(selection.directDefinitionIds).toEqual(['securityScheme:shared/common/OAuth2'])
    expect(sharedTargetIds(selection.refEdges)).toEqual([
      'parameter:shared/common/Limit',
      'parameter:shared/common/Page',
      'response:shared/common/BadRequest',
      'response:shared/common/Forbidden',
      'response:shared/common/InternalServerError',
      'response:shared/common/NotFound',
      'response:shared/common/ServiceUnavailable',
      'response:shared/common/Unauthorized',
      'response:shared/common/UnprocessableEntity',
      'schema:shared/common/Error',
      'schema:shared/common/ValidationError',
      'securityScheme:shared/common/BearerAuth',
    ])
    expect(selection.outputNameAllocation.outputNames.get('securityScheme:shared/common/BearerAuth')).toBe('bearerAuth')
    expect(selection.outputNameAllocation.outputNames.get('securityScheme:shared/common/OAuth2')).toBe('oauth2')
  })
})

function readTargetConfig(relativePath: string): DefinitionTargetConfig {
  const targetPath = join(schemasDir, 'targets', relativePath)
  const parsed = readYaml(targetPath)

  if (!isTargetConfig(parsed)) {
    throw new Error(`Invalid target config fixture: ${targetPath}`)
  }

  return parsed
}

function readProfileServers(profileName: string): unknown[] {
  const parsed = readYaml(join(schemasDir, 'profiles', `${profileName}.yaml`))
  if (!isRecord(parsed) || !Array.isArray(parsed.servers)) {
    throw new Error(`Invalid profile fixture: ${profileName}`)
  }
  return parsed.servers
}

function readRootInfo(): unknown {
  const parsed = readYaml(join(schemasDir, 'openapi.yaml'))
  if (!isRecord(parsed) || !isRecord(parsed.info)) {
    throw new Error('Invalid root OpenAPI fixture: missing info')
  }
  return parsed.info
}

function readRootTags(): unknown[] {
  const parsed = readYaml(join(schemasDir, 'openapi.yaml'))
  if (!isRecord(parsed) || !Array.isArray(parsed.tags)) {
    throw new Error('Invalid root OpenAPI fixture: missing tags')
  }
  return parsed.tags
}

function readCurrentMergedDomainPaths(): string[] {
  const paths: string[] = []

  for (const domainName of ['common', 'health', 'users']) {
    const parsed = readYaml(join(schemasDir, 'domains', domainName, 'spec.yaml'))
    if (!isRecord(parsed) || !isRecord(parsed.paths)) continue
    paths.push(...Object.keys(parsed.paths))
  }

  return paths
}

function paritySelectionNodes(): DefinitionNode[] {
  return [
    definitionNode('schema:shared/common/ValidationError', { type: 'object' }),
    definitionNode('schema:shared/common/Error', {
      type: 'object',
      properties: {
        details: {
          type: 'array',
          items: { $ref: 'oa://schema/shared/common/ValidationError' },
        },
      },
    }),
    sharedResponse('BadRequest'),
    sharedResponse('Unauthorized'),
    sharedResponse('Forbidden'),
    sharedResponse('NotFound'),
    sharedResponse('UnprocessableEntity'),
    sharedResponse('InternalServerError'),
    sharedResponse('ServiceUnavailable'),
    definitionNode('parameter:shared/common/Page', { name: 'page', in: 'query' }),
    definitionNode('parameter:shared/common/Limit', { name: 'limit', in: 'query' }),
    definitionNode('securityScheme:shared/common/BearerAuth', {
      type: 'http',
      scheme: 'bearer',
    }),
    definitionNode('securityScheme:shared/common/OAuth2', {
      type: 'oauth2',
      flows: {},
    }),
    definitionNode('schema:public/health/HealthStatus', { type: 'object' }),
    definitionNode('schema:public/users/User', { type: 'object' }),
    definitionNode('schema:public/users/CreateUserRequest', { type: 'object' }),
    definitionNode('schema:public/users/UpdateUserRequest', { type: 'object' }),
    definitionNode('path:public/health/HealthPath', {
      get: {
        responses: {
          200: {
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/public/health/HealthStatus' },
              },
            },
          },
          503: { $ref: 'oa://response/shared/common/ServiceUnavailable' },
        },
      },
    }, { path: '/health' }),
    definitionNode('path:public/health/HealthStreamPath', {
      get: {
        responses: {
          200: { description: 'SSE event stream' },
          503: { $ref: 'oa://response/shared/common/ServiceUnavailable' },
        },
      },
    }, { path: '/health/stream' }),
    definitionNode('path:public/users/UsersPath', {
      get: {
        parameters: [
          { $ref: 'oa://parameter/shared/common/Page' },
          { $ref: 'oa://parameter/shared/common/Limit' },
        ],
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: 'oa://schema/public/users/User' },
                    },
                  },
                },
              },
            },
          },
          401: { $ref: 'oa://response/shared/common/Unauthorized' },
        },
      },
      post: {
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: 'oa://schema/public/users/CreateUserRequest' },
            },
          },
        },
        responses: {
          201: {
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/public/users/User' },
              },
            },
          },
          400: { $ref: 'oa://response/shared/common/BadRequest' },
          401: { $ref: 'oa://response/shared/common/Unauthorized' },
          422: { $ref: 'oa://response/shared/common/UnprocessableEntity' },
          500: { $ref: 'oa://response/shared/common/InternalServerError' },
        },
      },
    }, { path: '/users' }, [
      { ref: 'oa://securityScheme/shared/common/BearerAuth', sourcePointer: '#/content/get/security/0/bearerAuth' },
      { ref: 'oa://securityScheme/shared/common/BearerAuth', sourcePointer: '#/content/post/security/0/bearerAuth' },
    ]),
    definitionNode('path:public/users/UserByIdPath', {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      get: {
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/public/users/User' },
              },
            },
          },
          401: { $ref: 'oa://response/shared/common/Unauthorized' },
          404: { $ref: 'oa://response/shared/common/NotFound' },
        },
      },
      patch: {
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: 'oa://schema/public/users/UpdateUserRequest' },
            },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': {
                schema: { $ref: 'oa://schema/public/users/User' },
              },
            },
          },
          400: { $ref: 'oa://response/shared/common/BadRequest' },
          401: { $ref: 'oa://response/shared/common/Unauthorized' },
          403: { $ref: 'oa://response/shared/common/Forbidden' },
          404: { $ref: 'oa://response/shared/common/NotFound' },
          422: { $ref: 'oa://response/shared/common/UnprocessableEntity' },
        },
      },
      delete: {
        security: [{ bearerAuth: [] }],
        responses: {
          204: { description: 'Deleted with no response body' },
          401: { $ref: 'oa://response/shared/common/Unauthorized' },
          404: { $ref: 'oa://response/shared/common/NotFound' },
        },
      },
    }, { path: '/users/{id}' }, [
      { ref: 'oa://securityScheme/shared/common/BearerAuth', sourcePointer: '#/content/get/security/0/bearerAuth' },
      { ref: 'oa://securityScheme/shared/common/BearerAuth', sourcePointer: '#/content/patch/security/0/bearerAuth' },
      { ref: 'oa://securityScheme/shared/common/BearerAuth', sourcePointer: '#/content/delete/security/0/bearerAuth' },
    ]),
  ]
}

function sharedResponse(name: string): DefinitionNode {
  return definitionNode(`response:shared/common/${name}`, {
    description: name,
    content: {
      'application/json': {
        schema: { $ref: 'oa://schema/shared/common/Error' },
      },
    },
  })
}

function definitionNode(
  id: string,
  content: unknown = { type: 'object' },
  metadata?: Record<string, unknown>,
  refs: Array<{ ref: string; sourcePointer: string }> = [],
): DefinitionNode {
  const sourcePath = sourcePathForId(id)

  return createDefinitionNode({
    id,
    sourcePath,
    sourcePointer: '#/content',
    contentHash: `sha256:${id}`,
    content,
    ...(metadata ? { metadata } : {}),
    refs: refs.map(ref => createDefinitionRef({
      ref: ref.ref,
      sourcePath,
      sourcePointer: ref.sourcePointer,
    })),
  })
}

function sourcePathForId(id: string): string {
  const [kind, path] = id.split(':')
  if (!kind || !path) throw new Error(`Invalid fixture id: ${id}`)
  const [scope, domain, name] = path.split('/')
  if (!scope || !domain || !name) throw new Error(`Invalid fixture id: ${id}`)
  return `/workspace/fragments/${kind}/${scope}/${domain}/${name}.yaml`
}

function sharedTargetIds(edges: readonly { targetId?: string }[]): string[] {
  return [...new Set(
    edges
      .map(edge => edge.targetId)
      .filter((targetId): targetId is string => targetId?.includes(':shared/') === true),
  )].sort()
}

function sortedIds(nodes: readonly { id: string }[]): string[] {
  return nodes.map(node => node.id).sort()
}

function readYaml(filePath: string): unknown {
  return parseYaml(readFileSync(filePath, 'utf8'))
}

function isTargetConfig(value: unknown): value is DefinitionTargetConfig {
  return isRecord(value)
    && typeof value.name === 'string'
    && isStringArray(value.scopes)
    && isStringArray(value.domains)
    && Array.isArray(value.servers)
    && isStringArray(value.includePaths)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
