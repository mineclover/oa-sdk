import { describe, it, expect } from 'vitest';
import { TypiaTypeAdapter } from '../../src/ast-sync/adapters/typia.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('TypiaTypeAdapter', () => {
  const adapter = new TypiaTypeAdapter();

  it('reads Typia JSDoc validation tags and preserves non-Typia comments', () => {
    const code = `
export interface Member {
  /**
   * Primary key of the member
   * @format uuid
   * @deprecated will be replaced in v2
   */
  id: string;

  /**
   * Member age in years
   * @minimum 18
   * @maximum 120
   * @default 25
   */
  age?: number;

  /**
   * User contact email
   * @format email
   */
  email: string;
}
`;

    const spec = adapter.read(code);
    expect(spec.name).toBe('Member');

    const idProp = spec.properties.id;
    expect(idProp?.type).toBe('string');
    expect(idProp?.docComment).toBe('Primary key of the member');
    expect(idProp?.constraints?.uuid).toBe(true);
    expect(idProp?.metadata?.nonTypiaTags).toEqual(['@deprecated will be replaced in v2']);

    const ageProp = spec.properties.age;
    expect(ageProp?.type).toBe('number');
    expect(ageProp?.optional).toBe(true);
    expect(ageProp?.constraints?.minimum).toBe(18);
    expect(ageProp?.constraints?.maximum).toBe(120);
    expect(ageProp?.defaultValue).toBe(25);

    const emailProp = spec.properties.email;
    expect(emailProp?.constraints?.format).toBe('email');
    expect(emailProp?.constraints?.email).toBe(true);
  });

  it('emits TypeScript interface with Typia JSDoc tags from EntitySpec', () => {
    const spec: EntitySpec = {
      id: 'sensor',
      name: 'SensorReading',
      kind: 'interface',
      properties: {
        sensorId: {
          name: 'sensorId',
          type: 'string',
          docComment: 'Unique sensor serial',
          constraints: { format: 'uuid' },
          metadata: { nonTypiaTags: ['@see SensorNetwork docs'] },
        },
        temperature: {
          name: 'temperature',
          type: 'number',
          constraints: { minimum: -50, maximum: 150 },
        },
        status: {
          name: 'status',
          type: 'string',
          defaultValue: 'online',
        },
      },
    };

    const code = adapter.write(spec);
    expect(code).toContain('export interface SensorReading {');
    expect(code).toContain('Unique sensor serial');
    expect(code).toContain('@see SensorNetwork docs');
    expect(code).toContain('@format uuid');
    expect(code).toContain('sensorId: string;');
    expect(code).toContain('@minimum -50');
    expect(code).toContain('@maximum 150');
    expect(code).toContain('temperature: number;');
    expect(code).toContain('@default "online"');
  });

  it('surgically patches Typia interface while preserving comments and non-Typia JSDoc tags', () => {
    const originalCode = `export interface Device {
  /**
   * Device hardware identifier
   * @format uuid
   * @deprecated use deviceMac instead
   */
  deviceId: string;

  /**
   * Firmware version string
   * @pattern ^v[0-9]+\\.[0-9]+$
   */
  firmware: string;
}
`;

    const updatedSpec: EntitySpec = {
      id: 'device',
      name: 'Device',
      kind: 'interface',
      properties: {
        deviceId: {
          name: 'deviceId',
          type: 'string',
          docComment: 'Device hardware identifier',
          constraints: { format: 'uuid' },
          metadata: { nonTypiaTags: ['@deprecated use deviceMac instead'] },
        },
        // firmware updated
        firmware: {
          name: 'firmware',
          type: 'string',
          docComment: 'Firmware semantic version',
          constraints: { pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
        },
        // batteryLevel added
        batteryLevel: {
          name: 'batteryLevel',
          type: 'number',
          constraints: { minimum: 0, maximum: 100 },
        },
      },
    };

    const patched = adapter.patch(originalCode, updatedSpec);

    // Preserves non-Typia JSDoc tag
    expect(patched).toContain('@deprecated use deviceMac instead');
    expect(patched).toContain('Device hardware identifier');

    // Applied updates
    expect(patched).toContain('Firmware semantic version');
    expect(patched).toContain('@pattern ^[0-9]+\\.[0-9]+\\.[0-9]+$');
    expect(patched).toContain('@minimum 0');
    expect(patched).toContain('@maximum 100');
    expect(patched).toContain('batteryLevel: number;');
  });
});
