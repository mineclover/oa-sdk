/**
 * Synthetic Specification & Schema Generators for oa-sdk Benchmarking.
 *
 * Generates valid TypeSpec source code (with models, endpoints, and optional cyclic references)
 * and valid OpenAPI 3.2 documents (with deep object nesting, circular $refs, and CRUD operations).
 */

export interface SyntheticTypeSpecOptions {
  /** Include self-referential and mutual circular references between models (default: false) */
  cyclic?: boolean;
}

/**
 * Generate syntactically valid TypeSpec source code containing N resources and operations.
 * Compatible with `@typespec/compiler`, `@typespec/http`, and `@typespec/openapi`.
 *
 * @param resourceCount Number of resources (models and CRUD service interfaces) to generate.
 * @param options Configuration for circular reference inclusion.
 * @returns Valid TypeSpec source text.
 */
export function generateSyntheticTypeSpec(
  resourceCount: number,
  options?: SyntheticTypeSpecOptions
): string {
  const count = Math.max(1, resourceCount);
  const cyclic = options?.cyclic ?? false;

  const lines: string[] = [
    'import "@typespec/http";',
    'import "@typespec/openapi";',
    'using TypeSpec.Http;',
    'using TypeSpec.OpenAPI;',
    '',
  ];

  for (let i = 0; i < count; i++) {
    lines.push(`model Resource${i} {`);
    lines.push('  id: string;');
    lines.push('  name: string;');
    lines.push('  description?: string;');
    lines.push('  count?: int32;');
    lines.push('  price?: float64;');
    lines.push('  isActive?: boolean;');
    lines.push('  tags?: string[];');
    if (cyclic) {
      lines.push(`  parent?: Resource${i};`);
      lines.push(`  children?: Resource${i}[];`);
      if (count > 1) {
        lines.push(`  sibling?: Resource${(i + 1) % count};`);
      }
    }
    lines.push('}');
    lines.push('');
    lines.push(`@route("/resources-${i}")`);
    lines.push(`@tag("Resource${i}")`);
    lines.push(`interface Resource${i}Service {`);
    lines.push('  @get');
    lines.push(`  @operationId("listResource${i}")`);
    lines.push(`  list(): Resource${i}[];`);
    lines.push('');
    lines.push('  @get');
    lines.push('  @route("/{id}")');
    lines.push(`  @operationId("getResource${i}")`);
    lines.push(`  get(@path id: string): Resource${i};`);
    lines.push('');
    lines.push('  @post');
    lines.push(`  @operationId("createResource${i}")`);
    lines.push(`  create(@body data: Resource${i}): Resource${i};`);
    lines.push('');
    lines.push('  @delete');
    lines.push('  @route("/{id}")');
    lines.push(`  @operationId("deleteResource${i}")`);
    lines.push(`  delete(@path id: string): void;`);
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

export interface SyntheticOpenApiOptions {
  /** Whether to inject self and mutual circular $ref dependencies into component schemas (default: false) */
  cyclic?: boolean;
  /** Depth of nested object hierarchies to construct inside schemas (default: 0) */
  depth?: number;
  /** Whether to generate CRUD path operations referencing the schemas (default: true) */
  includePaths?: boolean;
}

/**
 * Generate a valid OpenAPI 3.2 document object with configurable schema count,
 * recursive cycle clusters, and deep object nesting.
 *
 * @param modelCount Number of distinct component models to generate.
 * @param options Configuration for circularity, object tree depth, and route generation.
 * @returns Fully formed OpenAPI 3.2 document object.
 */
export function generateSyntheticOpenApiSchema(
  modelCount: number,
  options?: SyntheticOpenApiOptions
): Record<string, unknown> {
  const count = Math.max(1, modelCount);
  const cyclic = options?.cyclic ?? false;
  const depth = Math.max(0, options?.depth ?? 0);
  const includePaths = options?.includePaths ?? true;

  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (let i = 0; i < count; i++) {
    const modelName = `Model${i}`;
    const properties: Record<string, unknown> = {
      id: { type: 'string' },
      name: { type: 'string' },
      score: { type: 'number' },
      count: { type: 'integer' },
      isActive: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } },
    };

    if (depth > 0) {
      let currentProps: Record<string, unknown> = properties;
      for (let d = 1; d <= depth; d++) {
        const nextLayer: Record<string, unknown> = {
          type: 'object',
          properties: {},
          required: ['layerKey'],
        };
        currentProps[`nestedLayer${d}`] = nextLayer;
        currentProps = nextLayer.properties as Record<string, unknown>;
        currentProps.layerKey = { type: 'string' };
      }
      currentProps.deepLeaf = { type: 'string' };
    }

    if (cyclic) {
      properties.parent = { $ref: `#/components/schemas/${modelName}` };
      properties.children = {
        type: 'array',
        items: { $ref: `#/components/schemas/${modelName}` },
      };
      if (count > 1) {
        const nextModel = `Model${(i + 1) % count}`;
        properties.sibling = { $ref: `#/components/schemas/${nextModel}` };
      }
    }

    schemas[modelName] = {
      type: 'object',
      properties,
      required: ['id', 'name'],
    };

    if (includePaths) {
      paths[`/api/v1/models-${i}`] = {
        get: {
          operationId: `listModels${i}`,
          summary: `List all Model${i} records`,
          responses: {
            '200': {
              description: `List of Model${i}`,
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: `#/components/schemas/${modelName}` },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: `createModel${i}`,
          summary: `Create Model${i}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${modelName}` },
              },
            },
          },
          responses: {
            '201': {
              description: `Created Model${i}`,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${modelName}` },
                },
              },
            },
          },
        },
      };

      paths[`/api/v1/models-${i}/{id}`] = {
        get: {
          operationId: `getModel${i}`,
          summary: `Get Model${i} by ID`,
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
              description: `Model${i} details`,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${modelName}` },
                },
              },
            },
          },
        },
        delete: {
          operationId: `deleteModel${i}`,
          summary: `Delete Model${i} by ID`,
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
              description: 'Successfully deleted',
            },
          },
        },
      };
    }
  }

  return {
    openapi: '3.2.0',
    info: {
      title: 'Synthetic OAS 3.2 Benchmark Specification',
      version: '1.0.0',
      description: 'Auto-generated synthetic OpenAPI 3.2 specification for performance benchmarking',
    },
    paths,
    components: {
      schemas,
    },
  };
}
