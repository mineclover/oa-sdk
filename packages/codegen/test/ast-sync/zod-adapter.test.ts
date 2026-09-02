import { describe, it, expect } from 'vitest';
import { ZodTypeAdapter } from '../../src/ast-sync/adapters/zod.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('ZodTypeAdapter', () => {
  const adapter = new ZodTypeAdapter();

  it('reads basic Zod schema AST into normalized EntitySpec', () => {
    const code = `
import { z } from 'zod';

/**
 * User account representation
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).describe('User full name'),
  age: z.number().int().min(0).max(150).optional(),
  email: z.string().email(),
  bio: z.string().nullable(),
  role: z.enum(['admin', 'member', 'guest']),
  tags: z.array(z.string()),
});
`;

    const spec = adapter.read(code);
    expect(spec.name).toBe('UserSchema');
    expect(spec.docComment).toBe('User account representation');
    expect(spec.kind).toBe('schema');

    const p = spec.properties;
    expect(p.id?.type).toBe('string');
    expect(p.id?.constraints?.uuid).toBe(true);

    expect(p.name?.type).toBe('string');
    expect(p.name?.constraints?.min).toBe(1);
    expect(p.name?.constraints?.max).toBe(100);
    expect(p.name?.docComment).toBe('User full name');

    expect(p.age?.type).toBe('number');
    expect(p.age?.optional).toBe(true);
    expect(p.age?.constraints?.int).toBe(true);
    expect(p.age?.constraints?.min).toBe(0);
    expect(p.age?.constraints?.max).toBe(150);

    expect(p.email?.constraints?.email).toBe(true);
    expect(p.bio?.nullable).toBe(true);

    expect(p.role?.type).toBe('enum');
    expect(p.role?.constraints?.enum).toEqual(['admin', 'member', 'guest']);

    expect(p.tags?.type).toBe('string[]');
  });

  it('emits clean Zod code from EntitySpec', () => {
    const spec: EntitySpec = {
      id: 'product',
      name: 'ProductSchema',
      kind: 'schema',
      docComment: 'Product catalog item',
      properties: {
        id: {
          name: 'id',
          type: 'string',
          constraints: { uuid: true },
        },
        title: {
          name: 'title',
          type: 'string',
          constraints: { min: 3, max: 200 },
          docComment: 'Title of the product',
        },
        price: {
          name: 'price',
          type: 'number',
          constraints: { min: 0 },
        },
        inStock: {
          name: 'inStock',
          type: 'boolean',
          defaultValue: true,
        },
        category: {
          name: 'category',
          type: 'enum',
          constraints: { enum: ['electronics', 'apparel', 'books'] },
        },
      },
    };

    const code = adapter.write(spec);
    expect(code).toContain('Product catalog item');
    expect(code).toContain('export const ProductSchema = z.object({');
    expect(code).toContain('id: z.string().uuid(),');
    expect(code).toContain('title: z.string().min(3).max(200).describe("Title of the product"),');
    expect(code).toContain('price: z.number().min(0),');
    expect(code).toContain('inStock: z.boolean().default(true),');
    expect(code).toContain('category: z.enum(["electronics", "apparel", "books"]),');
  });

  it('surgically patches existing Zod code without destroying comments', () => {
    const originalCode = `import { z } from 'zod';

// Leading comment for User
export const UserSchema = z.object({
  // primary key
  id: z.string().uuid(),
  /* original name field */
  name: z.string().min(1),
  obsoleteField: z.string(),
});
`;

    const updatedSpec: EntitySpec = {
      id: 'user',
      name: 'UserSchema',
      kind: 'schema',
      properties: {
        id: {
          name: 'id',
          type: 'string',
          constraints: { uuid: true },
        },
        // Updated name
        name: {
          name: 'name',
          type: 'string',
          constraints: { min: 2, max: 50 },
        },
        // obsoleteField removed
        // age added
        age: {
          name: 'age',
          type: 'number',
          optional: true,
        },
      },
    };

    const patched = adapter.patch(originalCode, updatedSpec);

    // Comments preserved
    expect(patched).toContain('// Leading comment for User');
    expect(patched).toContain('// primary key');
    expect(patched).toContain('/* original name field */');

    // Changes applied
    expect(patched).toContain('name: z.string().min(2).max(50)');
    expect(patched).toContain('age: z.number().optional()');
    expect(patched).not.toContain('obsoleteField');
  });
});
