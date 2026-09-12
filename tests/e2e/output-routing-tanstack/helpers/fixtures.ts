import type { OasDocument } from '@oa-sdk/parser'

/**
 * Standard Petstore OpenAPI 3.2 fixture.
 */
export const petstoreSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Petstore API',
    version: '1.0.0',
    description: 'Sample Petstore for output routing and tanstack tests',
  },
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
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'A paged array of pets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Pet' },
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
              schema: { $ref: '#/components/schemas/NewPet' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Pet created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPetById',
        tags: ['pets'],
        summary: 'Info for a specific pet',
        parameters: [
          {
            name: 'petId',
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
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
        },
      },
      put: {
        operationId: 'updatePet',
        tags: ['pets'],
        summary: 'Update an existing pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Pet updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet' },
              },
            },
          },
        },
      },
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        summary: 'Delete a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'Pet deleted successfully',
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
          createdAt: { type: 'string', format: 'date-time' },
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
    },
  },
}

/**
 * Multi-Domain Feature-Sliced Design specification (Users, Orders, Products).
 */
export const fsdMultiDomainSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'E-Commerce Enterprise FSD API',
    version: '2.0.0',
  },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        summary: 'List users with pagination and filters',
        parameters: [
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'User list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        tags: ['users'],
        summary: 'Create a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUserInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created user',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
    '/users/{userId}': {
      get: {
        operationId: 'getUser',
        tags: ['users'],
        summary: 'Get user by ID',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'includeOrders', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'User details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
    '/orders': {
      get: {
        operationId: 'listOrders',
        tags: ['orders'],
        summary: 'List orders',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Order list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Order' },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createOrder',
        tags: ['orders'],
        summary: 'Place order',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateOrderInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Order placed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
              },
            },
          },
        },
      },
    },
    '/products': {
      get: {
        operationId: 'listProducts',
        tags: ['products'],
        summary: 'List products',
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'inStock', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'Product list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Product' },
                },
              },
            },
          },
        },
      },
    },
    '/products/{productId}': {
      get: {
        operationId: 'getProduct',
        tags: ['products'],
        summary: 'Get product detail',
        parameters: [
          { name: 'productId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Product details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Product' },
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
        required: ['id', 'email', 'name'],
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string' },
        },
      },
      CreateUserInput: {
        type: 'object',
        required: ['email', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          password: { type: 'string' },
        },
      },
      Order: {
        type: 'object',
        required: ['id', 'userId', 'totalAmount', 'status'],
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          totalAmount: { type: 'number' },
          status: { type: 'string' },
        },
      },
      CreateOrderInput: {
        type: 'object',
        required: ['userId', 'items'],
        properties: {
          userId: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                quantity: { type: 'integer' },
              },
            },
          },
        },
      },
      Product: {
        type: 'object',
        required: ['id', 'title', 'price'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'number' },
          category: { type: 'string' },
        },
      },
    },
  },
}

/**
 * Edge cases specification:
 * - 0 parameters
 * - Path-only
 * - Query-only
 * - Body-only
 * - Headers-only
 * - 204 No Content
 * - Binary stream
 * - Optional requestBody
 * - No tags (falls back to URL first segment or default)
 */
export const edgeCasesSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Edge Cases Spec',
    version: '1.0.0',
  },
  paths: {
    '/healthz': {
      get: {
        operationId: 'checkHealth',
        summary: 'Parameterless health check with no tag',
        responses: {
          '200': {
            description: 'Healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/': {
      get: {
        operationId: 'getRoot',
        summary: 'Root endpoint with no tag and path /',
        responses: {
          '200': {
            description: 'Root ok',
          },
        },
      },
    },
    '/items/{itemId}': {
      get: {
        operationId: 'getItemPathOnly',
        tags: ['items'],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Item',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { id: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
    '/items/search': {
      get: {
        operationId: 'searchItemsQueryOnly',
        tags: ['items'],
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    '/items/bulk-upload': {
      post: {
        operationId: 'bulkUploadBodyOnly',
        tags: ['items'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Uploaded',
          },
        },
      },
    },
    '/items/authorized-op': {
      get: {
        operationId: 'getWithHeadersOnly',
        tags: ['items'],
        parameters: [
          { name: 'X-Tenant-Id', in: 'header', required: true, schema: { type: 'string' } },
          { name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Success',
          },
        },
      },
    },
    '/items/{itemId}/stream': {
      get: {
        operationId: 'downloadItemStream',
        tags: ['items'],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Binary stream',
            content: {
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
        },
      },
    },
    '/items/{itemId}/void-delete': {
      delete: {
        operationId: 'voidDeleteItem',
        tags: ['items'],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
      },
    },
    '/items/{itemId}/optional-body': {
      patch: {
        operationId: 'patchWithOptionalBody',
        tags: ['items'],
        parameters: [
          { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { note: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated',
          },
        },
      },
    },
  },
}

/**
 * Special characters and multi-tag specification.
 */
export const specialCharSpec: OasDocument = {
  openapi: '3.2.0',
  info: {
    title: 'Special Characters & Multi-Tag Spec',
    version: '1.0.0',
  },
  paths: {
    '/user-management/profile_details': {
      get: {
        operationId: 'get_user_profile_details',
        tags: ['User Management', 'Administrative Controls'],
        summary: 'Multi-tag operation with spaces and underscores',
        responses: {
          '200': {
            description: 'Profile',
          },
        },
      },
    },
    '/billing-v2/invoices:export': {
      post: {
        operationId: 'exportInvoicesCustomVerb',
        tags: ['billing-v2'],
        summary: 'Custom URL verb with colon',
        responses: {
          '200': {
            description: 'Exported',
          },
        },
      },
    },
  },
}
