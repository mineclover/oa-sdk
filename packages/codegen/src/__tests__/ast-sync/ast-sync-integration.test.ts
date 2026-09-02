import { describe, it, expect } from 'vitest';
import {
  applyTextEdits,
  computeEntitySpecDiff,
  syncEntitySpecWithCode,
  ZodTypeAdapter,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
} from '../../ast-sync/index.js';
import type { EntitySpec } from '../../ast-sync/entity-spec.js';

describe('AST Bidirectional Sync Public API & Integration Tests', () => {
  it('exports all expected canonical classes, functions, and adapters', () => {
    expect(applyTextEdits).toBeDefined();
    expect(computeEntitySpecDiff).toBeDefined();
    expect(syncEntitySpecWithCode).toBeDefined();
    expect(ZodTypeAdapter).toBeDefined();
    expect(TsAstTypeAdapter).toBeDefined();
    expect(TypiaTypeAdapter).toBeDefined();
  });

  it('performs end-to-end Zod round-trip synchronization with full trivia retention', () => {
    const originalZod = `import { z } from 'zod';

// Schema: User profile
export const UserProfileSchema = z.object({
  /* primary id */
  id: z.string().uuid(),
  name: z.string().min(1).describe('User name'),
});
`;

    const adapter = new ZodTypeAdapter();
    const currentSpec = adapter.read(originalZod);
    expect(currentSpec.name).toBe('UserProfileSchema');
    expect(currentSpec.properties.id?.constraints?.uuid).toBe(true);
    expect(currentSpec.properties.name?.constraints?.min).toBe(1);

    const updatedSpec: EntitySpec = {
      ...currentSpec,
      properties: {
        ...currentSpec.properties,
        avatarUrl: {
          name: 'avatarUrl',
          type: 'string',
          optional: true,
          constraints: { url: true },
        },
      },
    };

    const syncResult = syncEntitySpecWithCode(originalZod, updatedSpec);
    expect(syncResult.diffs.length).toBe(1);
    expect(syncResult.code).toContain('// Schema: User profile');
    expect(syncResult.code).toContain('/* primary id */');
    expect(syncResult.code).toContain('avatarUrl: z.string().url().optional(),');

    // Roundtrip verification: re-read synced code
    const reReadSpec = adapter.read(syncResult.code);
    expect(reReadSpec.properties.avatarUrl?.optional).toBe(true);
    expect(reReadSpec.properties.avatarUrl?.constraints?.url).toBe(true);
  });

  it('performs end-to-end TypeScript Interface round-trip synchronization', () => {
    const originalTs = `/**
 * Workspace project configuration
 */
export interface ProjectConfig {
  /** Project identifier */
  projectId: string;
  version: number;
}
`;

    const adapter = new TsAstTypeAdapter();
    const currentSpec = adapter.read(originalTs);
    expect(currentSpec.name).toBe('ProjectConfig');
    expect(currentSpec.docComment).toBe('Workspace project configuration');

    const updatedSpec: EntitySpec = {
      ...currentSpec,
      properties: {
        ...currentSpec.properties,
        description: {
          name: 'description',
          type: 'string',
          optional: true,
          docComment: 'Optional project description',
        },
      },
    };

    const syncResult = syncEntitySpecWithCode(originalTs, updatedSpec);
    expect(syncResult.code).toContain('Workspace project configuration');
    expect(syncResult.code).toContain('/** Project identifier */');
    expect(syncResult.code).toContain('/**\n   * Optional project description\n   */');
    expect(syncResult.code).toContain('description?: string;');
  });

  it('performs end-to-end Typia JSDoc tags synchronization', () => {
    const originalTypia = `export interface HardwareSpec {
  /**
   * Device MAC Address
   * @format mac
   * @deprecated migrate to hardwareId
   */
  mac: string;
}
`;

    const adapter = new TypiaTypeAdapter();
    const currentSpec = adapter.read(originalTypia);
    expect(currentSpec.properties.mac?.metadata?.nonTypiaTags).toContain('@deprecated migrate to hardwareId');

    const updatedSpec: EntitySpec = {
      ...currentSpec,
      properties: {
        ...currentSpec.properties,
        voltage: {
          name: 'voltage',
          type: 'number',
          docComment: 'Operating voltage in Volts',
          constraints: { minimum: 3.3, maximum: 5.0 },
        },
      },
    };

    const syncResult = syncEntitySpecWithCode(originalTypia, updatedSpec);
    expect(syncResult.code).toContain('@deprecated migrate to hardwareId');
    expect(syncResult.code).toContain('@minimum 3.3');
    expect(syncResult.code).toContain('@maximum 5');
    expect(syncResult.code).toContain('voltage: number;');
  });
});
