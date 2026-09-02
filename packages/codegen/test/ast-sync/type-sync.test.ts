import { describe, it, expect } from 'vitest';
import { syncEntitySpecWithCode } from '../../src/ast-sync/type-sync.js';
import { ZodTypeAdapter } from '../../src/ast-sync/adapters/zod.js';
import { TsAstTypeAdapter } from '../../src/ast-sync/adapters/ts-ast.js';
import { TypiaTypeAdapter } from '../../src/ast-sync/adapters/typia.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('syncEntitySpecWithCode High-Level Orchestrator', () => {
  it('auto-detects Zod code and applies sync seamlessly', () => {
    const originalZod = `import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});
`;

    const targetSpec: EntitySpec = {
      id: 'user',
      name: 'UserSchema',
      kind: 'schema',
      properties: {
        id: { name: 'id', type: 'string' },
        name: { name: 'name', type: 'string' },
        email: { name: 'email', type: 'string', constraints: { email: true } },
      },
    };

    const result = syncEntitySpecWithCode(originalZod, targetSpec);
    expect(result.diffs.length).toBe(1);
    expect(result.diffs[0]?.kind).toBe('add-property');
    expect(result.code).toContain('email: z.string().email(),');
  });

  it('auto-detects Typia code and applies sync with JSDoc tags', () => {
    const originalTypia = `export interface Product {
  /**
   * Product SKU
   * @format uuid
   */
  sku: string;
}
`;

    const targetSpec: EntitySpec = {
      id: 'product',
      name: 'Product',
      kind: 'interface',
      properties: {
        sku: {
          name: 'sku',
          type: 'string',
          docComment: 'Product SKU',
          constraints: { format: 'uuid' },
        },
        price: {
          name: 'price',
          type: 'number',
          constraints: { minimum: 0 },
        },
      },
    };

    const result = syncEntitySpecWithCode(originalTypia, targetSpec);
    expect(result.diffs.length).toBe(1);
    expect(result.code).toContain('@minimum 0');
    expect(result.code).toContain('price: number;');
  });

  it('performs no-op and returns exact original source when no diffs exist', () => {
    const code = `export interface User {\n  id: string;\n  name: string;\n}`;
    const adapter = new TsAstTypeAdapter();
    const currentSpec = adapter.read(code);

    const result = syncEntitySpecWithCode(code, currentSpec);
    expect(result.diffs).toEqual([]);
    expect(result.code).toBe(code);
  });

  it('allows explicit adapter override', () => {
    const code = `export interface CustomType {\n  id: string;\n}`;
    const targetSpec: EntitySpec = {
      id: 'customtype',
      name: 'CustomType',
      kind: 'interface',
      properties: {
        id: { name: 'id', type: 'string' },
        active: { name: 'active', type: 'boolean' },
      },
    };

    const result = syncEntitySpecWithCode(code, targetSpec, { adapter: 'ts-ast' });
    expect(result.code).toContain('active: boolean;');
  });

  it('completes multi-step round-trip evolution with zero syntax destruction', () => {
    const initialCode = `import { z } from 'zod';

// Initial master schema
export const SessionSchema = z.object({
  token: z.string().uuid(),
  createdAt: z.string().datetime(),
});
`;

    const zodAdapter = new ZodTypeAdapter();

    // Step 1: Add field 'userId'
    const spec1 = zodAdapter.read(initialCode);
    spec1.properties['userId'] = { name: 'userId', type: 'string', constraints: { uuid: true } };
    const step1Result = syncEntitySpecWithCode(initialCode, spec1);
    expect(step1Result.code).toContain('userId: z.string().uuid(),');
    expect(step1Result.code).toContain('// Initial master schema');

    // Step 2: Update 'token' field to include .min(10)
    const spec2 = zodAdapter.read(step1Result.code);
    spec2.properties['token'] = {
      name: 'token',
      type: 'string',
      constraints: { uuid: true, min: 10 },
    };
    const step2Result = syncEntitySpecWithCode(step1Result.code, spec2);
    expect(step2Result.code).toContain('token: z.string().uuid().min(10)');

    // Step 3: Remove 'createdAt' field
    const spec3 = zodAdapter.read(step2Result.code);
    delete spec3.properties['createdAt'];
    const step3Result = syncEntitySpecWithCode(step2Result.code, spec3);
    expect(step3Result.code).not.toContain('createdAt');
    expect(step3Result.code).toContain('// Initial master schema');
    expect(step3Result.code).toContain('token: z.string().uuid().min(10)');
    expect(step3Result.code).toContain('userId: z.string().uuid()');
  });
});
