import { describe, it, expect } from 'vitest';
import { JsonSchemaTypeAdapter } from '../../src/adapters/json-schema.js';
import { ZodTypeAdapter } from '../../src/adapters/zod.js';
import { syncEntitySpecWithCode } from '../../src/type-sync.js';
import type { EntitySpec } from '../../src/entity-spec.js';

describe('JsonSchemaTypeAdapter (V3 Unified Architecture)', () => {
  const jsonAdapter = new JsonSchemaTypeAdapter();
  const zodAdapter = new ZodTypeAdapter();

  it('reads JSON Schema Draft 2020-12 into EntitySpec', () => {
    const rawSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'UserProfile',
      description: 'Canonical user profile entity in system',
      type: 'object',
      required: ['id', 'username'],
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          description: 'Unique user identifier',
        },
        username: {
          type: 'string',
          minLength: 3,
          maxLength: 30,
        },
        age: {
          type: ['integer', 'null'],
          minimum: 0,
          maximum: 150,
        },
        role: {
          type: 'string',
          enum: ['admin', 'member', 'guest'],
        },
      },
    };

    const spec = jsonAdapter.read(rawSchema);

    expect(spec.name).toBe('UserProfile');
    expect(spec.docComment).toBe('Canonical user profile entity in system');
    expect(spec.properties['id']).toBeDefined();
    expect(spec.properties['id']?.type).toBe('string');
    expect(spec.properties['id']?.optional).toBe(false);
    expect(spec.properties['id']?.constraints?.uuid).toBe(true);

    expect(spec.properties['username']?.optional).toBe(false);
    expect(spec.properties['username']?.constraints?.minLength).toBe(3);
    expect(spec.properties['username']?.constraints?.maxLength).toBe(30);

    expect(spec.properties['age']?.optional).toBe(true);
    expect(spec.properties['age']?.nullable).toBe(true);
    expect(spec.properties['age']?.constraints?.minimum).toBe(0);

    expect(spec.properties['role']?.type).toBe('enum');
    expect(spec.properties['role']?.constraints?.enum).toEqual(['admin', 'member', 'guest']);
  });

  it('emits canonical JSON Schema Draft 2020-12 from EntitySpec', () => {
    const spec: EntitySpec = {
      id: 'organization',
      name: 'Organization',
      kind: 'schema',
      docComment: 'Organization workspace',
      properties: {
        id: {
          name: 'id',
          type: 'string',
          optional: false,
          constraints: { uuid: true },
        },
        name: {
          name: 'name',
          type: 'string',
          optional: false,
          constraints: { minLength: 1 },
        },
        websiteUrl: {
          name: 'websiteUrl',
          type: 'string',
          optional: true,
          nullable: true,
          constraints: { url: true },
        },
        tier: {
          name: 'tier',
          type: 'enum',
          optional: false,
          constraints: { enum: ['free', 'pro', 'enterprise'] },
        },
      },
    };

    const emitted = jsonAdapter.write(spec);
    const parsed = JSON.parse(emitted);

    expect(parsed.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(parsed.title).toBe('Organization');
    expect(parsed.description).toBe('Organization workspace');
    expect(parsed.type).toBe('object');
    expect(parsed.required).toEqual(['id', 'name', 'tier']);
    expect(parsed.properties.websiteUrl.type).toEqual(['string', 'null']);
    expect(parsed.properties.websiteUrl.format).toBe('uri');
    expect(parsed.properties.tier.enum).toEqual(['free', 'pro', 'enterprise']);
  });

  it('performs zero-loss roundtrip between Zod Master Schema and JSON Schema 2020-12', () => {
    const originalZodCode = `export const ProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(2),
  price: z.number().min(0),
  category: z.enum(["electronics", "clothing", "books"]),
  tags: z.array(z.string()).optional(),
});`;

    // 1. Zod -> EntitySpec
    const entitySpec = zodAdapter.read(originalZodCode);
    expect(entitySpec.name).toBe('ProductSchema');
    expect(entitySpec.properties['title']?.constraints?.min).toBe(2);

    // 2. EntitySpec -> JSON Schema 2020-12
    const jsonSchemaStr = jsonAdapter.write(entitySpec);
    const jsonSchemaObj = JSON.parse(jsonSchemaStr);
    expect(jsonSchemaObj.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(jsonSchemaObj.properties.id.format).toBe('uuid');

    // 3. JSON Schema 2020-12 -> EntitySpec
    const roundtripSpec = jsonAdapter.read(jsonSchemaObj);
    expect(roundtripSpec.name).toBe('ProductSchema');
    expect(roundtripSpec.properties['category']?.constraints?.enum).toEqual([
      'electronics',
      'clothing',
      'books',
    ]);

    // 4. EntitySpec -> Zod code
    const reEmittedZod = zodAdapter.write(roundtripSpec);
    expect(reEmittedZod).toContain('export const ProductSchema = z.object({');
    expect(reEmittedZod).toContain('id: z.string().uuid(),');
    expect(reEmittedZod).toContain('category: z.enum(["electronics", "clothing", "books"]),');
  });

  it('patches JSON Schema surgically with updated EntitySpec', () => {
    const originalJson = JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'User',
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          nickname: { type: 'string' },
        },
      },
      null,
      2
    );

    const updatedSpec: EntitySpec = {
      id: 'user',
      name: 'User',
      kind: 'schema',
      properties: {
        id: { name: 'id', type: 'string', optional: false },
        nickname: { name: 'nickname', type: 'string', optional: false, constraints: { minLength: 2 } },
        email: { name: 'email', type: 'string', optional: false, constraints: { email: true } },
      },
    };

    const patched = jsonAdapter.patch(originalJson, updatedSpec);
    const parsed = JSON.parse(patched);

    expect(parsed.properties.email).toBeDefined();
    expect(parsed.properties.email.format).toBe('email');
    expect(parsed.properties.nickname.minLength).toBe(2);
    expect(parsed.required).toContain('id');
    expect(parsed.required).toContain('email');
    expect(parsed.required).toContain('nickname');
  });

  it('syncEntitySpecWithCode auto-detects JSON Schema format', () => {
    const jsonCode = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Article",
  "type": "object",
  "required": ["slug"],
  "properties": {
    "slug": { "type": "string" }
  }
}`;

    const updatedSpec: EntitySpec = {
      id: 'article',
      name: 'Article',
      kind: 'schema',
      properties: {
        slug: { name: 'slug', type: 'string', optional: false },
        published: { name: 'published', type: 'boolean', optional: false },
      },
    };

    const result = syncEntitySpecWithCode(jsonCode, updatedSpec);
    expect(result.modified).toBe(true);
    const parsed = JSON.parse(result.code);
    expect(parsed.properties.published).toBeDefined();
    expect(parsed.properties.published.type).toBe('boolean');
  });

  it('rejects parsed input that is not a JSON Schema object', () => {
    expect(() => jsonAdapter.read('[]')).toThrow(/must be a JSON object/);
    expect(() => jsonAdapter.read('"text"')).toThrow(/must be a JSON object/);
    expect(() => jsonAdapter.read('{')).toThrow(/not valid JSON/);
    expect(() => jsonAdapter.read('{"type": 1}')).toThrow(/"type" must be a string or an array of strings/);
    expect(() => jsonAdapter.read('{"required": [1]}')).toThrow(/"required" must be an array of strings/);
    expect(() => jsonAdapter.read('{"properties": []}')).toThrow(/"properties" must be an object/);
  });

  it('falls back to a fresh document when patching malformed input', () => {
    const target: EntitySpec = {
      id: 'fallback',
      name: 'Fallback',
      kind: 'schema',
      properties: { id: { name: 'id', type: 'string', optional: false } },
    };
    const written = jsonAdapter.patch('{', target);
    expect(JSON.parse(written).properties.id.type).toBe('string');
  });
});
