import { describe, it, expect } from 'vitest';
import { TypiaTypeAdapter } from '../../src/ast-sync/adapters/typia.js';
import { syncEntitySpecWithCode } from '../../src/ast-sync/type-sync.js';
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
    const jsdocAdapter = new TypiaTypeAdapter({ tagStyle: 'jsdoc' });
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

    const code = jsdocAdapter.write(spec);
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

  describe('TypeScript 5.x Type-Level Tags', () => {
    it('reads primitive type-level tags (Type, Minimum, Maximum, ExclusiveMinimum, ExclusiveMaximum)', () => {
      const code = `
export interface NumericEntity {
  id: number & tags.Type<'int32'> & tags.Minimum<10> & tags.Maximum<100>;
  score: number & tags.ExclusiveMinimum<0> & tags.ExclusiveMaximum<5>;
  step: number & tags.MultipleOf<5>;
}
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('NumericEntity');
      expect(spec.metadata?.typiaTagStyle).toBe('type-level');

      const idProp = spec.properties.id;
      expect(idProp?.type).toBe('number');
      expect(idProp?.constraints?.type).toBe('int32');
      expect(idProp?.constraints?.int).toBe(true);
      expect(idProp?.constraints?.minimum).toBe(10);
      expect(idProp?.constraints?.min).toBe(10);
      expect(idProp?.constraints?.maximum).toBe(100);
      expect(idProp?.constraints?.max).toBe(100);
      expect(idProp?.metadata?.typiaTagStyle).toBe('type-level');

      const scoreProp = spec.properties.score;
      expect(scoreProp?.type).toBe('number');
      expect(scoreProp?.constraints?.exclusiveMinimum).toBe(0);
      expect(scoreProp?.constraints?.exclusiveMaximum).toBe(5);

      const stepProp = spec.properties.step;
      expect(stepProp?.type).toBe('number');
      expect(stepProp?.constraints?.multipleOf).toBe(5);
    });

    it('reads string type-level tags (Format, Pattern, MinLength, MaxLength)', () => {
      const code = `
export interface StringEntity {
  uuid: string & tags.Format<'uuid'>;
  email: string & tags.Format<'email'>;
  code: string & tags.Pattern<'^[A-Z]{3}-[0-9]{3}$'> & tags.MinLength<7> & tags.MaxLength<7>;
}
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('StringEntity');

      const uuidProp = spec.properties.uuid;
      expect(uuidProp?.type).toBe('string');
      expect(uuidProp?.constraints?.format).toBe('uuid');
      expect(uuidProp?.constraints?.uuid).toBe(true);

      const emailProp = spec.properties.email;
      expect(emailProp?.type).toBe('string');
      expect(emailProp?.constraints?.format).toBe('email');
      expect(emailProp?.constraints?.email).toBe(true);

      const codeProp = spec.properties.code;
      expect(codeProp?.type).toBe('string');
      expect(codeProp?.constraints?.pattern).toBe('^[A-Z]{3}-[0-9]{3}$');
      expect(codeProp?.constraints?.minLength).toBe(7);
      expect(codeProp?.constraints?.maxLength).toBe(7);
    });

    it('reads negative numeric bounds from prefix unary expressions', () => {
      const code = `
export interface ClimateSensor {
  temperature: number & tags.Minimum<-50> & tags.Maximum<150>;
  elevation: number & tags.ExclusiveMinimum<-418.5> & tags.ExclusiveMaximum<8848>;
}
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('ClimateSensor');

      const tempProp = spec.properties.temperature;
      expect(tempProp?.type).toBe('number');
      expect(tempProp?.constraints?.minimum).toBe(-50);
      expect(tempProp?.constraints?.min).toBe(-50);
      expect(tempProp?.constraints?.maximum).toBe(150);
      expect(tempProp?.constraints?.max).toBe(150);

      const elevationProp = spec.properties.elevation;
      expect(elevationProp?.type).toBe('number');
      expect(elevationProp?.constraints?.exclusiveMinimum).toBe(-418.5);
      expect(elevationProp?.constraints?.exclusiveMaximum).toBe(8848);
    });

    it('reads parenthesized nullable unions with type-level tags', () => {
      const code = `
export interface NullableEntity {
  nullableUuid: (string & tags.Format<'uuid'>) | null;
  nullableCount?: (number & tags.Minimum<0>) | null;
}
`;
      const spec = adapter.read(code);
      expect(spec.name).toBe('NullableEntity');

      const idProp = spec.properties.nullableUuid;
      expect(idProp?.type).toBe('string');
      expect(idProp?.nullable).toBe(true);
      expect(idProp?.constraints?.format).toBe('uuid');
      expect(idProp?.constraints?.uuid).toBe(true);

      const countProp = spec.properties.nullableCount;
      expect(countProp?.type).toBe('number');
      expect(countProp?.nullable).toBe(true);
      expect(countProp?.optional).toBe(true);
      expect(countProp?.constraints?.minimum).toBe(0);
    });

    it('preserves non-Typia JSDoc tags and doc comments alongside type-level tags', () => {
      const code = `
export interface UserProfile {
  /**
   * User's unique identifier
   * @deprecated Use accountId instead
   * @see https://docs.example.com/user
   */
  userId: string & tags.Format<'uuid'>;
}
`;
      const spec = adapter.read(code);
      const userProp = spec.properties.userId;
      expect(userProp?.type).toBe('string');
      expect(userProp?.docComment).toBe("User's unique identifier");
      expect(userProp?.metadata?.nonTypiaTags).toEqual([
        '@deprecated Use accountId instead',
        '@see https://docs.example.com/user',
      ]);
      expect(userProp?.constraints?.uuid).toBe(true);

      const emitted = adapter.write(spec);
      expect(emitted).toContain("User's unique identifier");
      expect(emitted).toContain('@deprecated Use accountId instead');
      expect(emitted).toContain('@see https://docs.example.com/user');
      expect(emitted).toContain("userId: string & tags.Format<'uuid'>;");
      expect(emitted).not.toContain('@format');
    });

    it('emits TypeScript interface with type-level tags when typiaTagStyle is type-level', () => {
      const spec: EntitySpec = {
        id: 'telemetry',
        name: 'TelemetryRecord',
        kind: 'interface',
        metadata: { typiaTagStyle: 'type-level' },
        properties: {
          sensorId: {
            name: 'sensorId',
            type: 'string',
            constraints: { format: 'uuid' },
          },
          count: {
            name: 'count',
            type: 'number',
            constraints: { type: 'int32', minimum: 0, maximum: 100 },
          },
          temperature: {
            name: 'temperature',
            type: 'number',
            constraints: { minimum: -50 },
          },
          alias: {
            name: 'alias',
            type: 'string',
            nullable: true,
            constraints: { minLength: 3, maxLength: 50 },
          },
        },
      };

      const emitted = adapter.write(spec);
      expect(emitted).toContain('export interface TelemetryRecord {');
      expect(emitted).toContain("sensorId: string & tags.Format<'uuid'>;");
      expect(emitted).toContain("count: number & tags.Type<'int32'> & tags.Minimum<0> & tags.Maximum<100>;");
      expect(emitted).toContain('temperature: number & tags.Minimum<-50>;');
      expect(emitted).toContain('(string & tags.MinLength<3> & tags.MaxLength<50>) | null;');
    });

    it('surgically patches type-level tags with 100% bitwise invariance across unedited regions', () => {
      const originalCode = `import type { tags } from 'typia';

// System configuration header
export interface ServiceMetrics {
  /** Service uuid */
  serviceId: string & tags.Format<'uuid'>;

  /** Request timeout in ms */
  timeoutMs: number & tags.Minimum<100> & tags.Maximum<5000>;

  /** Service environment */
  environment: string;
}
// End of config
`;

      const targetSpec: EntitySpec = {
        id: 'servicemetrics',
        name: 'ServiceMetrics',
        kind: 'interface',
        properties: {
          serviceId: {
            name: 'serviceId',
            type: 'string',
            docComment: 'Service uuid',
            constraints: { format: 'uuid' },
            metadata: { typiaTagStyle: 'type-level' },
          },
          timeoutMs: {
            name: 'timeoutMs',
            type: 'number',
            docComment: 'Request timeout in ms',
            constraints: { minimum: 500, maximum: 10000 },
            metadata: { typiaTagStyle: 'type-level' },
          },
          environment: {
            name: 'environment',
            type: 'string',
            docComment: 'Service environment',
          },
        },
      };

      const patched = adapter.patch(originalCode, targetSpec);

      // Verify unedited regions match verbatim
      expect(patched).toContain("import type { tags } from 'typia';");
      expect(patched).toContain('// System configuration header');
      expect(patched).toContain("serviceId: string & tags.Format<'uuid'>;");
      expect(patched).toContain('/** Service environment */');
      expect(patched).toContain('environment: string;');
      expect(patched).toContain('// End of config');

      // Verify target edit applied
      expect(patched).toContain('timeoutMs: number & tags.Minimum<500> & tags.Maximum<10000>;');

      // Check strict bitwise invariance across unedited regions before and after timeoutMs
      const serviceIdEnd = originalCode.indexOf("serviceId: string & tags.Format<'uuid'>;") + "serviceId: string & tags.Format<'uuid'>;".length;
      expect(patched.slice(0, serviceIdEnd)).toBe(originalCode.slice(0, serviceIdEnd));

      const envCommentOriginal = originalCode.indexOf('/** Service environment */');
      const envCommentPatched = patched.indexOf('/** Service environment */');
      expect(patched.slice(envCommentPatched)).toBe(originalCode.slice(envCommentOriginal));
    });

    it('supports namespaced tag variants including typia.tags.<Tag>', () => {
      const code = `
export interface Metrics {
  score: typia.tags.Minimum<10>;
  limit: tags.Maximum<100>;
}
`;
      const spec = adapter.read(code);
      const scoreProp = spec.properties.score;
      expect(scoreProp?.constraints?.minimum).toBe(10);
      expect(scoreProp?.metadata?.tagNamespace).toBe('typia.tags');

      const limitProp = spec.properties.limit;
      expect(limitProp?.constraints?.maximum).toBe(100);
      expect(limitProp?.metadata?.tagNamespace).toBe('tags');
    });

    it('isolates non-Typia intersection types and prevents false-positive tag parsing', () => {
      const code = `
export interface AuditedUser {
  entity: User & Timestamped;
  custom: (Entity & Record<string, unknown>) & tags.Format<'uuid'>;
}
`;
      const spec = adapter.read(code);
      const entityProp = spec.properties.entity;
      expect(entityProp?.type).toBe('User & Timestamped');
      expect(entityProp?.constraints).toBeUndefined();

      const customProp = spec.properties.custom;
      expect(customProp?.type).toBe('Entity & Record<string, unknown>');
      expect(customProp?.constraints?.format).toBe('uuid');
      expect(customProp?.constraints?.uuid).toBe(true);
    });

    it('auto-detects type-level Typia tags in syncEntitySpecWithCode orchestrator', () => {
      const originalCode = `import type { tags } from 'typia';

export interface WorkerJob {
  jobId: string & tags.Format<'uuid'>;
}
`;

      const targetSpec: EntitySpec = {
        id: 'workerjob',
        name: 'WorkerJob',
        kind: 'interface',
        properties: {
          jobId: {
            name: 'jobId',
            type: 'string',
            constraints: { format: 'uuid' },
          },
          retryCount: {
            name: 'retryCount',
            type: 'number',
            constraints: { minimum: 0 },
          },
        },
      };

      const result = syncEntitySpecWithCode(originalCode, targetSpec);
      expect(result.diffs.length).toBe(1);
      expect(result.diffs[0]?.kind).toBe('add-property');
      expect(result.code).toContain("import type { tags } from 'typia';");
      expect(result.code).toContain("jobId: string & tags.Format<'uuid'>;");
      expect(result.code).toContain('retryCount: number & tags.Minimum<0>;');
    });
  });
});

