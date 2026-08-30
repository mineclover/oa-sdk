import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDefinitionNode,
  createDefinitionRef,
  createDefinitionRegistry,
  emitDefinitionOpenApiDocument,
  selectDefinitionTarget,
  type CanonicalDefinitionId,
  type DefinitionNode,
  type DefinitionRef,
  type DefinitionTargetConfig,
} from '@oa-sdk/parser'
import { parse as parseYaml } from 'yaml'

const __dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dir, '../../../..')
const schemasDir = join(repoRoot, 'packages/schemas/src')
const fragmentsDir = join(schemasDir, 'fragments')
const approvedOpenApiPath = join(repoRoot, 'packages/schemas/typespec/approved.openapi.yaml')

type UsersFragmentFixture = {
  id: CanonicalDefinitionId
  relativePath: string
  sourcePath?: string
  sourceSchema?: string
  securitySourcePointers?: readonly string[]
}

const USERS_FRAGMENTS: readonly UsersFragmentFixture[] = [
  {
    id: 'schema:public/users/User',
    relativePath: 'schema/public/users/User.yaml',
    sourceSchema: 'User',
  },
  {
    id: 'schema:public/users/CreateUserRequest',
    relativePath: 'schema/public/users/CreateUserRequest.yaml',
    sourceSchema: 'CreateUserRequest',
  },
  {
    id: 'schema:public/users/UpdateUserRequest',
    relativePath: 'schema/public/users/UpdateUserRequest.yaml',
    sourceSchema: 'UpdateUserRequest',
  },
  {
    id: 'path:public/users/UsersPath',
    relativePath: 'path/public/users/UsersPath.yaml',
    sourcePath: '/users',
    securitySourcePointers: [
      '#/content/get/security/0/bearerAuth',
      '#/content/post/security/0/bearerAuth',
    ],
  },
  {
    id: 'path:public/users/UserByIdPath',
    relativePath: 'path/public/users/UserByIdPath.yaml',
    sourcePath: '/users/{id}',
    securitySourcePointers: [
      '#/content/get/security/0/bearerAuth',
      '#/content/patch/security/0/bearerAuth',
      '#/content/delete/security/0/bearerAuth',
    ],
  },
] as const

const USERS_CANONICAL_REF_REWRITES: Readonly<Record<string, string>> = {
  '#/components/parameters/Page': 'oa://parameter/shared/common/Page',
  '#/components/parameters/Limit': 'oa://parameter/shared/common/Limit',
  '#/components/responses/BadRequest': 'oa://response/shared/common/BadRequest',
  '#/components/responses/Conflict': 'oa://response/shared/common/Conflict',
  '#/components/responses/Unauthorized': 'oa://response/shared/common/Unauthorized',
  '#/components/responses/Forbidden': 'oa://response/shared/common/Forbidden',
  '#/components/responses/NotFound': 'oa://response/shared/common/NotFound',
  '#/components/responses/UnprocessableEntity': 'oa://response/shared/common/UnprocessableEntity',
  '#/components/responses/InternalServerError': 'oa://response/shared/common/InternalServerError',
  '#/components/schemas/User': 'oa://schema/public/users/User',
  '#/components/schemas/CreateUserRequest': 'oa://schema/public/users/CreateUserRequest',
  '#/components/schemas/UpdateUserRequest': 'oa://schema/public/users/UpdateUserRequest',
}

const SHARED_COMMON_OUTPUT_ALIASES = {
  'securityScheme:shared/common/BearerAuth': 'bearerAuth',
  'securityScheme:shared/common/OAuth2': 'oauth2',
} as const

describe('builder users fragments', () => {
  it('matches current TypeSpec-approved users paths and schemas with canonical refs', () => {
    const approvedOpenApi = readYaml(approvedOpenApiPath)

    for (const fragmentFixture of USERS_FRAGMENTS) {
      const fragment = readFragment(fragmentFixture.relativePath)

      expect(fragment.id).toBe(fragmentFixture.id)
      if (fragmentFixture.sourcePath) {
        expect(fragment.metadata).toEqual({ path: fragmentFixture.sourcePath })
        expect(fragment.content).toEqual(rewriteRefs(
          readApprovedPath(approvedOpenApi, fragmentFixture.sourcePath),
          USERS_CANONICAL_REF_REWRITES,
        ))
      }
      if (fragmentFixture.sourceSchema) {
        expect(fragment.content).toEqual(readApprovedSchema(approvedOpenApi, fragmentFixture.sourceSchema))
      }
      if (fragmentFixture.securitySourcePointers) {
        expect(fragment.refs).toEqual(fragmentFixture.securitySourcePointers.map(sourcePointer => ({
          ref: 'oa://securityScheme/shared/common/BearerAuth',
          sourcePointer,
        })))
      }
      expect(JSON.stringify(fragment.content)).not.toContain('#/components/')
    }
  })

  it('emits users paths and selected components equivalent to builder fragments', () => {
    const approvedOpenApi = readYaml(approvedOpenApiPath)
    const registry = createDefinitionRegistry([
      ...loadCommonFragmentNodes(),
      ...loadUsersFragmentNodes(),
    ])
    const target = usersTarget()
    const selection = selectDefinitionTarget(registry, target)
    const emitted = emitDefinitionOpenApiDocument(selection, {
      info: {
        title: 'Users parity probe',
        version: '0.0.0',
      },
    })

    expect(registry.valid).toBe(true)
    expect(selection.valid).toBe(true)
    expect(selection.directPathIds).toEqual([
      'path:public/users/UsersPath',
      'path:public/users/UserByIdPath',
    ])
    expect(emitted.valid).toBe(true)
    expect(JSON.stringify(emitted.document)).not.toContain('oa://')

    expect(emitted.document.paths?.['/users']).toEqual(readApprovedPath(approvedOpenApi, '/users'))
    expect(emitted.document.paths?.['/users/{id}']).toEqual(readApprovedPath(approvedOpenApi, '/users/{id}'))

    expect(sortedKeys(emitted.document.components?.schemas)).toEqual([
      'CreateUserRequest',
      'Error',
      'UpdateUserRequest',
      'User',
      'ValidationError',
      'ValidationReceivedArraySummary',
      'ValidationReceivedObjectSummary',
      'ValidationReceivedScalarSummary',
      'ValidationReceivedStringSummary',
    ])
    expect(sortedKeys(emitted.document.components?.responses)).toEqual([
      'BadRequest',
      'Conflict',
      'Forbidden',
      'InternalServerError',
      'NotFound',
      'Unauthorized',
      'UnprocessableEntity',
    ])
    expect(sortedKeys(emitted.document.components?.parameters)).toEqual(['Limit', 'Page'])
    expect(sortedKeys(emitted.document.components?.securitySchemes)).toEqual(['bearerAuth'])

    for (const schemaName of ['User', 'CreateUserRequest', 'UpdateUserRequest'] as const) {
      expect(emitted.document.components?.schemas?.[schemaName])
        .toEqual(readApprovedSchema(approvedOpenApi, schemaName))
    }
    for (const schemaName of [
      'Error',
      'ValidationError',
      'ValidationReceivedArraySummary',
      'ValidationReceivedObjectSummary',
      'ValidationReceivedScalarSummary',
      'ValidationReceivedStringSummary',
    ] as const) {
      expect(emitted.document.components?.schemas?.[schemaName])
        .toEqual(readApprovedComponent(approvedOpenApi, 'schemas', schemaName))
    }
    for (const responseName of [
      'BadRequest',
      'Conflict',
      'Forbidden',
      'InternalServerError',
      'NotFound',
      'Unauthorized',
      'UnprocessableEntity',
    ] as const) {
      expect(emitted.document.components?.responses?.[responseName])
        .toEqual(readApprovedComponent(approvedOpenApi, 'responses', responseName))
    }
    for (const parameterName of ['Page', 'Limit'] as const) {
      expect(emitted.document.components?.parameters?.[parameterName])
        .toEqual(readApprovedComponent(approvedOpenApi, 'parameters', parameterName))
    }
    expect(emitted.document.components?.securitySchemes?.['bearerAuth'])
      .toEqual(readApprovedComponent(approvedOpenApi, 'securitySchemes', 'bearerAuth'))
  })
})

function usersTarget(): DefinitionTargetConfig {
  return {
    name: 'users-parity-probe',
    scopes: ['shared', 'public'],
    domains: ['common', 'users'],
    servers: [{ url: 'https://example.invalid' }],
    includePaths: ['/users', '/users/{id}'],
    namingPolicy: {
      aliases: SHARED_COMMON_OUTPUT_ALIASES,
    },
  }
}

function loadUsersFragmentNodes(): DefinitionNode[] {
  return USERS_FRAGMENTS.map(fragment => loadFragmentNode(join(fragmentsDir, fragment.relativePath)))
}

function loadCommonFragmentNodes(): DefinitionNode[] {
  return listDefinitionFiles(join(fragmentsDir, 'schema/shared/common'))
    .concat(listDefinitionFiles(join(fragmentsDir, 'response/shared/common')))
    .concat(listDefinitionFiles(join(fragmentsDir, 'parameter/shared/common')))
    .concat(listDefinitionFiles(join(fragmentsDir, 'securityScheme/shared/common')))
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
    refs: readFragmentRefs(fragment.refs, filePath),
    ...(isRecord(fragment.metadata) ? { metadata: fragment.metadata } : {}),
  })
}

function readFragmentRefs(refs: unknown, filePath: string): DefinitionRef[] {
  if (refs === undefined) return []
  if (!Array.isArray(refs)) throw new Error(`Invalid fragment refs: ${filePath}`)

  return refs.map((refEntry, index) => {
    if (!isRecord(refEntry) || typeof refEntry.ref !== 'string' || typeof refEntry.sourcePointer !== 'string') {
      throw new Error(`Invalid fragment ref at ${filePath}#/refs/${index}`)
    }

    return createDefinitionRef({
      ref: refEntry.ref,
      sourcePath: filePath,
      sourcePointer: refEntry.sourcePointer,
    })
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

function readFragment(relativePath: string): { id?: unknown; metadata?: unknown; content?: unknown; refs?: unknown } {
  const fragment = readYaml(join(fragmentsDir, relativePath))
  if (!isRecord(fragment)) throw new Error(`Invalid fragment fixture: ${relativePath}`)
  return fragment
}

function readApprovedPath(approvedOpenApi: unknown, path: string): unknown {
  if (!isRecord(approvedOpenApi) || !isRecord(approvedOpenApi.paths) || !Object.prototype.hasOwnProperty.call(approvedOpenApi.paths, path)) {
    throw new Error(`Missing approved OpenAPI path: ${path}`)
  }
  return approvedOpenApi.paths[path]
}

function readApprovedSchema(approvedOpenApi: unknown, name: string): unknown {
  if (!isRecord(approvedOpenApi) || !isRecord(approvedOpenApi.components) || !isRecord(approvedOpenApi.components.schemas)) {
    throw new Error('Invalid approved OpenAPI schemas.')
  }
  if (!Object.prototype.hasOwnProperty.call(approvedOpenApi.components.schemas, name)) {
    throw new Error(`Missing approved OpenAPI schema: ${name}`)
  }
  return approvedOpenApi.components.schemas[name]
}

function readApprovedComponent(approvedOpenApi: unknown, sectionName: string, componentName: string): unknown {
  if (!isRecord(approvedOpenApi) || !isRecord(approvedOpenApi.components)) {
    throw new Error('Invalid approved OpenAPI components.')
  }
  const section = approvedOpenApi.components[sectionName]
  if (!isRecord(section) || !Object.prototype.hasOwnProperty.call(section, componentName)) {
    throw new Error(`Missing approved OpenAPI component: ${sectionName}.${componentName}`)
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

function sortedKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}

function readYaml(filePath: string): unknown {
  return parseYaml(readFileSync(filePath, 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
