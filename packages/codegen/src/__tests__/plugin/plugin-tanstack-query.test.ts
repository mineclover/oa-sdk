import { describe, expect, it } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createPluginContext } from '../../plugin/context.js'
import { pluginTanstackQuery } from '../../plugin/plugins/tanstack-query.js'

function createSampleOasDoc(): OasDocument {
  return {
    openapi: '3.2.0',
    info: { title: 'Test Petstore', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          tags: ['pets'],
          summary: 'List all pets',
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
            {
              name: 'offset',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            '200': {
              description: 'A paged array of pets',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/Pet',
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'createPet',
          tags: ['pets'],
          summary: 'Create a pet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/NewPet',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created pet',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Pet',
                  },
                },
              },
            },
          },
        },
      },
      '/pets/{id}': {
        get: {
          operationId: 'getPetById',
          tags: ['pets'],
          summary: 'Info for a specific pet',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Expected response to a valid request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Pet',
                  },
                },
              },
            },
            '404': {
              description: 'Pet not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            tag: { type: 'string' },
          },
        },
        NewPet: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            tag: { type: 'string' },
          },
        },
        Error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'integer' },
            message: { type: 'string' },
          },
        },
      },
    },
  }
}

describe('pluginTanstackQuery', () => {
  it('declares correct metadata and dependencies', () => {
    const plugin = pluginTanstackQuery()
    expect(plugin.name).toBe('tanstack-query')
    expect(plugin.dependencies).toEqual(['typescript', 'client'])
    expect(typeof plugin.generate).toBe('function')
  })

  it('generates unified single-file queries.ts by default', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await plugin.generate!(context)

    const file = context.getFile('queries.ts')
    expect(file).toBeDefined()
    expect(file?.sourcePlugin).toBe('tanstack-query')
    expect(file?.kind).toBe('queries')

    const content = file!.content
    // Check Tier 1: Key Factories
    expect(content).toContain('petsKeys')
    // Check Tier 2: Options
    expect(content).toContain('listPetsQueryOptions')
    expect(content).toContain('createPetMutationOptions')
    expect(content).toContain('getPetByIdQueryOptions')
    // Check Tier 3: React Hooks
    expect(content).toContain('useListPetsQuery')
    expect(content).toContain('useCreatePetMutation')
    expect(content).toContain('useGetPetByIdQuery')
    expect(content).toContain("'use client'")
  })

  it('generates infiniteQueryOptions for paginated endpoints', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await plugin.generate!(context)

    const file = context.getFile('queries.ts')
    expect(file?.content).toContain('listPetsInfiniteQueryOptions')
  })

  it('supports custom output path and custom clientName', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      output: 'src/custom-queries.ts',
      clientName: 'CustomClient',
    })
    await plugin.generate!(context)

    expect(context.hasFile('src/custom-queries.ts')).toBe(true)
    const file = context.getFile('src/custom-queries.ts')
    expect(file?.content).toContain('client: CustomClient')
  })

  it('supports selective tier filtering: keys only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'keys',
      output: 'keys.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('keys.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('petsKeys')
    expect(file?.content).not.toContain('useListPetsQuery')
    expect(file?.content).not.toContain('listPetsQueryOptions')
  })

  it('supports selective tier filtering: options only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'options',
      output: 'options.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('options.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('listPetsQueryOptions')
    expect(file?.content).not.toContain('useListPetsQuery')
  })

  it('supports selective tier filtering: hooks only', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      tier: 'hooks',
      output: 'hooks.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('hooks.ts')
    expect(file).toBeDefined()
    expect(file?.content).toContain('useListPetsQuery')
    expect(file?.content).toContain("'use client'")
  })

  it('supports split emission (split: true) into keys.ts, queries.ts, hooks.ts', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    // Register dummy upstream files so resolveImport works
    context.addFile({
      path: 'types.ts',
      content: 'export interface Pet { id: string }',
      sourcePlugin: 'typescript',
    })
    context.addFile({
      path: 'client.ts',
      content: 'export class ApiClient {}',
      sourcePlugin: 'client',
    })

    const plugin = pluginTanstackQuery({ split: true })
    await plugin.generate!(context)

    expect(context.hasFile('keys.ts')).toBe(true)
    expect(context.hasFile('queries.ts')).toBe(true)
    expect(context.hasFile('hooks.ts')).toBe(true)

    const keysFile = context.getFile('keys.ts')
    const queriesFile = context.getFile('queries.ts')
    const hooksFile = context.getFile('hooks.ts')

    expect(keysFile?.kind).toBe('keys')
    expect(queriesFile?.kind).toBe('queries')
    expect(hooksFile?.kind).toBe('hooks')

    // Verify inter-file imports
    expect(queriesFile?.content).toContain('./keys.js')
    expect(hooksFile?.content).toContain('./keys.js')
    expect(hooksFile?.content).toContain('./queries.js')
  })

  it('supports custom split output file locations', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      split: true,
      keysOutput: 'api/keys.ts',
      optionsOutput: 'api/options.ts',
      hooksOutput: 'api/hooks.ts',
    })
    await plugin.generate!(context)

    expect(context.hasFile('api/keys.ts')).toBe(true)
    expect(context.hasFile('api/options.ts')).toBe(true)
    expect(context.hasFile('api/hooks.ts')).toBe(true)

    const optionsFile = context.getFile('api/options.ts')
    expect(optionsFile?.content).toContain('./keys.js')
    expect(optionsFile?.content).toContain('GetPetByIdError')
    expect(optionsFile?.content).not.toContain('ClientError')
  })

  it('resolves relative keysImport and queriesImport when hooksOutput is in a separate subdirectory with explicit typesFile and clientFile', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery({
      split: true,
      typesFile: '@app/types',
      clientFile: '@app/client',
      keysOutput: 'api/keys.ts',
      optionsOutput: 'api/options.ts',
      hooksOutput: 'api/react/hooks.ts',
    })
    await plugin.generate!(context)

    const hooksFile = context.getFile('api/react/hooks.ts')
    expect(hooksFile).toBeDefined()
    expect(hooksFile?.content).toContain("from '../keys.js'")
    expect(hooksFile?.content).toContain("from '../options.js'")
    expect(hooksFile?.content).toContain('GetPetByIdError')
    expect(hooksFile?.content).not.toContain('ClientError')
  })

  it('resolves relative imports between custom subdirectories correctly', async () => {
    const doc = createSampleOasDoc()
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: doc,
      config: { input: 'main.tsp' },
    })

    context.addFile({
      path: 'models/types.ts',
      content: 'export interface Pet {}',
      sourcePlugin: 'typescript',
    })

    const plugin = pluginTanstackQuery({
      output: 'features/pets/queries.ts',
    })
    await plugin.generate!(context)

    const file = context.getFile('features/pets/queries.ts')
    expect(file).toBeDefined()
    // Relative import from features/pets/queries.ts to models/types.ts should be ../../models/types.js
    expect(file?.content).toContain('../../models/types.js')
  })

  it('handles empty document gracefully without throwing', async () => {
    const emptyDoc: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Empty API', version: '1.0.0' },
      paths: {},
    }
    const context = createPluginContext({
      entrypoint: '/project/main.tsp',
      outputDir: '/project/dist',
      document: emptyDoc,
      config: { input: 'main.tsp' },
    })

    const plugin = pluginTanstackQuery()
    await expect(plugin.generate!(context)).resolves.not.toThrow()
    expect(context.hasFile('queries.ts')).toBe(true)
  })
})
