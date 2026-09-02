import { describe, it, expect } from 'vitest';
import { TsAstTypeAdapter } from '../../src/ast-sync/adapters/ts-ast.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('TsAstTypeAdapter', () => {
  const adapter = new TsAstTypeAdapter();

  it('reads TypeScript interface AST into normalized EntitySpec', () => {
    const code = `
/**
 * User interface definition
 */
export interface User extends BaseEntity, Timestamped {
  /** User unique identifier */
  id: string;
  name: string;
  age?: number;
  bio: string | null;
  metadata?: Record<string, unknown>;
}
`;

    const spec = adapter.read(code);
    expect(spec.name).toBe('User');
    expect(spec.kind).toBe('interface');
    expect(spec.docComment).toBe('User interface definition');
    expect(spec.extends).toEqual(['BaseEntity', 'Timestamped']);

    const p = spec.properties;
    expect(p.id?.type).toBe('string');
    expect(p.id?.docComment).toBe('User unique identifier');

    expect(p.name?.type).toBe('string');
    expect(p.name?.optional).toBeUndefined();

    expect(p.age?.type).toBe('number');
    expect(p.age?.optional).toBe(true);

    expect(p.bio?.type).toBe('string');
    expect(p.bio?.nullable).toBe(true);
  });

  it('emits TypeScript interface from EntitySpec', () => {
    const spec: EntitySpec = {
      id: 'customer',
      name: 'Customer',
      kind: 'interface',
      docComment: 'Customer record',
      extends: ['BaseCustomer'],
      properties: {
        id: {
          name: 'id',
          type: 'string',
          docComment: 'Primary key',
        },
        displayName: {
          name: 'displayName',
          type: 'string',
        },
        creditLimit: {
          name: 'creditLimit',
          type: 'number',
          optional: true,
        },
        avatarUrl: {
          name: 'avatarUrl',
          type: 'string',
          nullable: true,
        },
      },
    };

    const code = adapter.write(spec);
    expect(code).toContain('Customer record');
    expect(code).toContain('export interface Customer extends BaseCustomer {');
    expect(code).toContain('id: string;');
    expect(code).toContain('displayName: string;');
    expect(code).toContain('creditLimit?: number;');
    expect(code).toContain('avatarUrl: string | null;');
  });

  it('surgically patches TypeScript interface preserving comments and indentation', () => {
    const originalCode = `/**
 * Global User Model
 */
export interface User {
  // Database ID
  id: string;

  /** Legacy username field */
  username: string;

  deprecatedToken?: string;
}
`;

    const updatedSpec: EntitySpec = {
      id: 'user',
      name: 'User',
      kind: 'interface',
      properties: {
        id: {
          name: 'id',
          type: 'string',
        },
        // Updated username type
        username: {
          name: 'username',
          type: 'string | number',
        },
        // deprecatedToken removed
        // email added
        email: {
          name: 'email',
          type: 'string',
          docComment: 'Contact email',
        },
      },
    };

    const patched = adapter.patch(originalCode, updatedSpec);

    // Comments preserved
    expect(patched).toContain('Global User Model');
    expect(patched).toContain('// Database ID');

    // Changes applied
    expect(patched).toContain('username: string | number;');
    expect(patched).toContain('email: string;');
    expect(patched).toContain('Contact email');
    expect(patched).not.toContain('deprecatedToken');
  });
});
