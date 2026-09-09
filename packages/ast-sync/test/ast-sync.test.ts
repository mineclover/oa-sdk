import { describe, it, expect } from 'vitest';
import {
  syncEntitySpecWithCode,
  computeEntitySpecDiff,
  ZodTypeAdapter,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
  generateStandaloneGuards,
} from '../src/index.js';
import type { EntitySpec } from '../src/index.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

describe('@oa-sdk/ast-sync', () => {
  describe('V3 AST Bidirectional Sync Engine', () => {
    it('syncs Zod schema surgically without destroying comments or surrounding code', () => {
      const source = `// Header comment
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});
`;
      const targetSpec: EntitySpec = {
        id: 'UserSchema',
        name: 'UserSchema',
        kind: 'schema',
        properties: {
          id: { name: 'id', type: 'string' },
          name: { name: 'name', type: 'string' },
          email: { name: 'email', type: 'string', constraints: { email: true } },
        },
      };

      const result = syncEntitySpecWithCode(source, targetSpec, { adapter: new ZodTypeAdapter() });
      expect(result.modified).toBe(true);
      expect(result.code).toContain('// Header comment');
      expect(result.code).toContain('email: z.string().email()');
    });

    it('syncs TypeScript interface with Typia tags', () => {
      const source = `export interface Product {
  id: string;
  price: number;
}
`;
      const targetSpec: EntitySpec = {
        id: 'Product',
        name: 'Product',
        kind: 'interface',
        properties: {
          id: { name: 'id', type: 'string' },
          price: { name: 'price', type: 'number', constraints: { min: 0, max: 100000 } },
        },
      };

      const result = syncEntitySpecWithCode(source, targetSpec, { adapter: new TypiaTypeAdapter() });
      expect(result.modified).toBe(true);
      expect(result.code).toContain('@minimum 0');
      expect(result.code).toContain('@maximum 100000');
    });
  });

  describe('Standalone Guard Generator', () => {
    it('generates zero-runtime standalone type guard files from JSON Schema', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-sync-guards-'));

      const schemaDoc = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'Customer',
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 0 },
        },
        required: ['id', 'email'],
      };

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir: tmpDir,
      });

      expect(artifacts.length).toBeGreaterThan(0);
      const jsArtifact = artifacts.find((a) => a.kind === 'js');
      expect(jsArtifact).toBeDefined();
      expect(jsArtifact?.content).toContain('function isCustomer(');

      const dtsArtifact = artifacts.find((a) => a.kind === 'dts');
      expect(dtsArtifact).toBeDefined();
      expect(dtsArtifact?.content).toContain('function isCustomer(');

      await fs.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
