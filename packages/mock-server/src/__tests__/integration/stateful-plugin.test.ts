import { describe, expect, it, afterEach } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import { createNodeMockServer } from '../../adapters/node-http.js'
import { inMemoryStorePlugin } from '../../plugins/in-memory-store.js'
import { createMswMockServer } from '../../adapters/msw.js'
import type { MockPlugin } from '../../core/plugin.js'

const testSpec: OasDocument = {
  openapi: '3.1.0',
  info: { title: 'Store Test API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        summary: 'List items',
        responses: {
          '200': {
            description: 'Item list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'title'],
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createItem',
        summary: 'Create item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Item created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/items/{id}': {
      get: {
        operationId: 'getItem',
        summary: 'Get item by ID',
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
            description: 'Item found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
          '404': {
            description: 'Not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      put: {
        operationId: 'replaceItem',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Item updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      patch: {
        operationId: 'updateItem',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Item updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    category: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteItem',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'Item deleted',
          },
          '404': {
            description: 'Not found',
          },
        },
      },
    },
  },
}

describe('Stateful inMemoryStorePlugin & MockPlugin Architecture', () => {
  let activeServer: ReturnType<typeof createNodeMockServer> | null = null

  afterEach(async () => {
    if (activeServer) {
      await activeServer.stop()
      activeServer = null
    }
  })

  it('Node HTTP Mock Server with stateful option executes full CRUD lifecycle and reset', async () => {
    const seedItem = { id: 'seed-1', title: 'Initial Item' }
    activeServer = createNodeMockServer(testSpec, {
      port: 0,
      stateful: {
        seed: {
          '/items': [seedItem],
        },
      },
    })
    await activeServer.start()
    const baseUrl = activeServer.url

    // 1. GET /items -> Seed item present
    const listRes1 = await fetch(`${baseUrl}/items`)
    expect(listRes1.status).toBe(200)
    const listBody1 = await listRes1.json()
    expect(listBody1).toEqual([seedItem])

    // 2. POST /items -> Create second item
    const createRes = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second Item' }),
    })
    expect(createRes.status).toBe(201)
    const createdItem: any = await createRes.json()
    expect(createdItem.title).toBe('Second Item')
    expect(createdItem.id).toBeDefined()

    // 3. GET /items -> Both items present
    const listRes2 = await fetch(`${baseUrl}/items`)
    const listBody2: any = await listRes2.json()
    expect(listBody2).toHaveLength(2)
    expect(listBody2.map((i: any) => i.title)).toContain('Second Item')

    // 4. GET /items/:id -> Read created item
    const getRes = await fetch(`${baseUrl}/items/${createdItem.id}`)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(createdItem)

    // 5. PATCH /items/:id -> Update title
    const patchRes = await fetch(`${baseUrl}/items/${createdItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Second Item Patched' }),
    })
    expect(patchRes.status).toBe(200)
    const patchedItem: any = await patchRes.json()
    expect(patchedItem.title).toBe('Second Item Patched')

    // 6. DELETE /items/:id -> Remove created item
    const deleteRes = await fetch(`${baseUrl}/items/${createdItem.id}`, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)

    // 7. GET /items/:id -> 404
    const get404Res = await fetch(`${baseUrl}/items/${createdItem.id}`)
    expect(get404Res.status).toBe(404)

    // 8. reset() -> Restores to initial seed
    activeServer.reset()
    const listResAfterReset = await fetch(`${baseUrl}/items`)
    const listBodyAfterReset = await listResAfterReset.json()
    expect(listBodyAfterReset).toEqual([seedItem])
  })

  it('Custom MockPlugin onMatch intercepts and short-circuits request', async () => {
    const customPlugin: MockPlugin = {
      name: 'custom-interceptor',
      onMatch(context) {
        if (context.entry.operationId === 'getItem' && context.parts.pathParams.id === 'special') {
          return {
            status: 200,
            contentType: 'application/json',
            body: { id: 'special', title: 'Special Intercepted Item' },
          }
        }
      },
    }

    activeServer = createNodeMockServer(testSpec, {
      port: 0,
      plugins: [customPlugin],
    })
    await activeServer.start()

    const res = await fetch(`${activeServer.url}/items/special`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ id: 'special', title: 'Special Intercepted Item' })
  })

  it('Custom MockPlugin onResponse mutates response headers and body', async () => {
    const transformPlugin: MockPlugin = {
      name: 'header-injector',
      onResponse(res) {
        return {
          ...res,
          headers: {
            ...res.headers,
            'x-custom-mock-header': 'oa-mock-active',
          },
        }
      },
    }

    activeServer = createNodeMockServer(testSpec, {
      port: 0,
      plugins: [transformPlugin],
    })
    await activeServer.start()

    const res = await fetch(`${activeServer.url}/items`)
    expect(res.headers.get('x-custom-mock-header')).toBe('oa-mock-active')
  })

  it('MSW mock server supports stateful option and reset()', () => {
    const mock = createMswMockServer(testSpec, {
      stateful: {
        seed: {
          '/items': [{ id: 'item-msw', title: 'MSW Seed' }],
        },
      },
    })

    expect(mock.handlers.length).toBeGreaterThan(0)
    expect(typeof mock.reset).toBe('function')
    expect(() => mock.reset()).not.toThrow()
  })
})
