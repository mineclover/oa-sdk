import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { createDefinitionRegistry } from '@oa-sdk/parser'
import {
  adaptDefinitionBuilderFragmentFile,
  adaptJsonSchemaFile,
  adaptRawOpenApiFragmentFile,
} from '../cli/lib/definition-fragments.js'
import { createOpenApiInventory } from '../cli/lib/openapi-inventory.js'
import { createOpenApiSourceContentHash } from '../cli/lib/openapi-source-fragments.js'

const pkgDir = resolve(__dirname, '../..')
const tmpBase = resolve(pkgDir, '.tmp-source-file-adapters-test')

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('file-based source adapters', () => {
  it('adapts Definition Builder YAML and JSON fragments into source fragments and nodes', () => {
    const schemaPath = writeYaml('definition/User.yaml', {
      id: 'schema:public/users/User',
      metadata: { semanticAliasOf: 'schema:shared/users/User' },
      content: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    })
    const responsePath = writeJson('definition/UserResponse.json', {
      id: 'response:public/users/UserResponse',
      refs: [
        {
          ref: 'oa://schema/public/users/User',
          sourcePointer: '#/content/content/application~1json/schema',
        },
      ],
      content: {
        description: 'OK',
        content: {
          'application/json': {
            schema: { $ref: 'oa://schema/public/users/User' },
          },
        },
      },
    })

    const schema = adaptDefinitionBuilderFragmentFile(schemaPath)
    const response = adaptDefinitionBuilderFragmentFile(responsePath)

    expect(schema.diagnostics).toEqual([])
    expect(response.diagnostics).toEqual([])
    expect(schema.fragment?.id).toBe('schema:public/users/User')
    expect(schema.fragment?.sourcePath).toBe(schemaPath)
    expect(schema.fragment?.sourcePointer).toBe('#/content')
    expect(schema.fragment?.contentHash).toBe(createOpenApiSourceContentHash(schema.fragment?.content))
    expect(schema.node).toEqual(expect.objectContaining({
      id: 'schema:public/users/User',
      sourcePath: schemaPath,
      sourcePointer: '#/content',
      contentHash: schema.fragment?.contentHash,
    }))
    expect(response.node?.refs).toEqual([
      expect.objectContaining({
        ref: 'oa://schema/public/users/User',
        sourcePath: responsePath,
        sourcePointer: '#/content/content/application~1json/schema',
      }),
    ])
    expect(schema.sourceLocation.lookup('#/content/properties/id/type')).toEqual(expect.objectContaining({
      filePath: schemaPath,
      pointer: '#/content/properties/id/type',
    }))

    const registry = createDefinitionRegistry([schema.node!, response.node!])
    expect(registry.nodes.map(node => node.id).sort()).toEqual([
      'response:public/users/UserResponse',
      'schema:public/users/User',
    ])
  })

  it('adapts raw OpenAPI YAML and JSON fragments and keeps inventory-compatible documents', () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Adapter fixture', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' },
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
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }
    const yamlPath = writeYaml('openapi/users.yaml', document)
    const jsonPath = writeJson('openapi/users.json', {
      ...document,
      components: {
        schemas: {
          User: {
            properties: {
              id: { type: 'string' },
            },
            type: 'object',
          },
        },
      },
    })

    const yaml = adaptRawOpenApiFragmentFile(yamlPath)
    const json = adaptRawOpenApiFragmentFile(jsonPath)

    expect(yaml.diagnostics).toEqual([])
    expect(json.diagnostics).toEqual([])
    expect(yaml.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['schema', '#/components/schemas/User'],
      ['path', '#/paths/~1users'],
      ['operation', '#/paths/~1users/get'],
    ])
    expect(json.fragments.map(fragment => [fragment.kind, fragment.sourcePointer])).toEqual([
      ['schema', '#/components/schemas/User'],
      ['path', '#/paths/~1users'],
      ['operation', '#/paths/~1users/get'],
    ])

    const yamlSchema = yaml.fragments.find(fragment => fragment.sourcePointer === '#/components/schemas/User')
    const jsonSchema = json.fragments.find(fragment => fragment.sourcePointer === '#/components/schemas/User')
    expect(yamlSchema?.contentHash).toBe(jsonSchema?.contentHash)
    expect(yamlSchema?.id).not.toBe(jsonSchema?.id)

    const inventory = createOpenApiInventory(yaml.document, { documentPath: yaml.sourcePath })
    expect(inventory.totals).toEqual({
      paths: 1,
      operations: 1,
      components: 1,
      unusedComponentCandidates: 0,
    })
    expect(inventory.document.path).toBe(yamlPath)
  })

  it('adapts standalone JSON Schema YAML and JSON files into deterministic fragments', () => {
    const schema = {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
      },
    }
    const yamlPath = writeYaml('schemas/User.yaml', schema)
    const jsonPath = writeJson('schemas/User.json', {
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      type: 'object',
    })

    const yaml = adaptJsonSchemaFile(yamlPath, {
      definitionId: 'schema:public/users/User',
      metadata: { source: 'standalone' },
    })
    const json = adaptJsonSchemaFile(jsonPath)

    expect(yaml.diagnostics).toEqual([])
    expect(json.diagnostics).toEqual([])
    expect(yaml.fragment).toEqual(expect.objectContaining({
      kind: 'json-schema',
      sourcePath: yamlPath,
      sourcePointer: '#',
      contentHash: createOpenApiSourceContentHash(schema),
      metadata: { source: 'standalone' },
    }))
    expect(json.fragment?.contentHash).toBe(yaml.fragment?.contentHash)
    expect(json.fragment?.id).not.toBe(yaml.fragment?.id)
    expect(yaml.node).toEqual(expect.objectContaining({
      id: 'schema:public/users/User',
      sourcePath: yamlPath,
      sourcePointer: '#',
      contentHash: yaml.fragment?.contentHash,
    }))

    const registry = createDefinitionRegistry([yaml.node!])
    expect(registry.nodes[0]?.id).toBe('schema:public/users/User')
  })

  it('reports adapter diagnostics with source paths and JSON pointers', () => {
    const definitionPath = writeYaml('bad/definition.yaml', { content: { type: 'object' } })
    const openApiPath = writeYaml('bad/openapi.yaml', { components: [] })
    const schemaPath = writeJson('bad/schema.json', 'not-a-schema')

    expect(adaptDefinitionBuilderFragmentFile(definitionPath).diagnostics).toEqual([
      expect.objectContaining({
        code: 'definition-fragment/invalid-fragment',
        sourcePath: definitionPath,
        sourcePointer: '#/id',
      }),
    ])
    expect(adaptRawOpenApiFragmentFile(openApiPath).diagnostics).toEqual([
      expect.objectContaining({
        code: 'openapi-fragment/invalid-fragment',
        sourcePath: openApiPath,
        sourcePointer: '#/components',
      }),
    ])
    expect(adaptJsonSchemaFile(schemaPath).diagnostics).toEqual([
      expect.objectContaining({
        code: 'json-schema/invalid-schema',
        sourcePath: schemaPath,
        sourcePointer: '#',
      }),
    ])
  })
})

function writeYaml(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyYaml(value), 'utf8')
  return filePath
}

function writeJson(relativePath: string, value: unknown): string {
  const filePath = join(tmpDir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return filePath
}
