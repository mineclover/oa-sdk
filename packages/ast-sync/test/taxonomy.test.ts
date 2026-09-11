import { describe, it, expect } from 'vitest';
import {
  classifyTypeShape,
  auditTypeShapesInSource,
  getDeclarationShapesInSource,
  ALL_SHAPE_FEATURES,
  UNSUPPORTED_SHAPE_FEATURES,
  POLICY_REQUIRED_SHAPE_FEATURES,
  DIRECT_SHAPE_FEATURES,
  type ContractShapeFeature,
} from '../src/index.js';

describe('Type Shape Taxonomy & Feasibility Diagnostics', () => {
  describe('Taxonomy definitions and classification hierarchy', () => {
    it('contains all 24 TypeScript syntax features partitioned into 3 projection tiers', () => {
      expect(ALL_SHAPE_FEATURES).toHaveLength(24);
      expect(UNSUPPORTED_SHAPE_FEATURES.size).toBe(9);
      expect(POLICY_REQUIRED_SHAPE_FEATURES.size).toBe(5);
      expect(DIRECT_SHAPE_FEATURES.size).toBe(10);

      // Verify disjoint sets
      for (const feat of UNSUPPORTED_SHAPE_FEATURES) {
        expect(POLICY_REQUIRED_SHAPE_FEATURES.has(feat)).toBe(false);
        expect(DIRECT_SHAPE_FEATURES.has(feat)).toBe(false);
      }
      for (const feat of POLICY_REQUIRED_SHAPE_FEATURES) {
        expect(DIRECT_SHAPE_FEATURES.has(feat)).toBe(false);
      }
    });

    it('classifies direct projections when only direct features are present', () => {
      const shape = classifyTypeShape(new Set<ContractShapeFeature>(['object', 'array', 'union', 'literal']));
      expect(shape.typeSpecProjection).toBe('direct');
      expect(shape.features).toEqual(['array', 'literal', 'object', 'union']);
    });

    it('classifies policy-required when policy features are present without unsupported features', () => {
      const shape = classifyTypeShape(
        new Set<ContractShapeFeature>(['object', 'tuple', 'generic-instantiation', 'utility-type'])
      );
      expect(shape.typeSpecProjection).toBe('policy-required');
      expect(shape.features).toEqual(['generic-instantiation', 'object', 'tuple', 'utility-type']);
    });

    it('classifies unsupported when any unsupported feature is present, overriding policy-required', () => {
      const shape = classifyTypeShape(
        new Set<ContractShapeFeature>(['object', 'tuple', 'conditional', 'indexed-access'])
      );
      expect(shape.typeSpecProjection).toBe('unsupported');
      expect(shape.features).toEqual(['conditional', 'indexed-access', 'object', 'tuple']);
    });
  });

  describe('Samchon Reference Parity Tests', () => {
    const samchonContractsSource = [
      "export interface Node { next?: Node | null; metadata: Record<string, 'internal' | 'public'>; }",
      "export type Result = ({ code: 'ok' } & { value: string }) | { code: 'error'; message: string };",
      "export type Page<T> = T[];",
      "export type Derived<T> = { [K in keyof T]?: T[K] extends string ? `${K & string}:${T[K]}` : never };",
      "export type UndefinedValue = string | undefined;",
      "export interface MutualA { b: MutualB; }",
      "export interface MutualB { a: MutualA; }",
    ].join('\n');

    it('extracts shapes matching reference test definitions', () => {
      const shapes = getDeclarationShapesInSource(samchonContractsSource, 'contracts.ts');

      // 1. Node (self-recursive, utility Record, nullable union, optional)
      expect(shapes.get('Node')).toEqual({
        features: [
          'generic-instantiation',
          'literal',
          'nullable',
          'object',
          'optional',
          'recursive-reference',
          'reference',
          'union',
          'utility-type',
        ],
        typeSpecProjection: 'policy-required',
      });

      // 2. Result (intersection of object literals, union)
      expect(shapes.get('Result')).toEqual({
        features: ['intersection', 'literal', 'object', 'union'],
        typeSpecProjection: 'direct',
      });

      // 3. Page<T> (array, generic declaration)
      expect(shapes.get('Page')).toEqual({
        features: ['array', 'generic-declaration', 'reference'],
        typeSpecProjection: 'policy-required',
      });

      // 4. Derived<T> (conditional, mapped, indexed-access, template-literal, type-operator)
      expect(shapes.get('Derived')).toEqual({
        features: [
          'conditional',
          'generic-declaration',
          'indexed-access',
          'intersection',
          'mapped',
          'optional',
          'reference',
          'template-literal',
          'type-operator',
        ],
        typeSpecProjection: 'unsupported',
      });

      // 5. UndefinedValue (union with undefined)
      expect(shapes.get('UndefinedValue')).toEqual({
        features: ['undefined', 'union'],
        typeSpecProjection: 'policy-required',
      });

      // 6. MutualA & MutualB (mutual recursion across declarations)
      expect(shapes.get('MutualA')).toEqual({
        features: ['object', 'recursive-reference', 'reference'],
        typeSpecProjection: 'direct',
      });
      expect(shapes.get('MutualB')).toEqual({
        features: ['object', 'recursive-reference', 'reference'],
        typeSpecProjection: 'direct',
      });
    });
  });

  describe('Complex Types: Utility Types, Indexed Access, Tuples, Conditionals', () => {
    it('analyzes Record<K, V> as policy-required utility-type + generic-instantiation', () => {
      const source = `export type Dictionary = Record<string, number>;`;
      const shapes = getDeclarationShapesInSource(source);
      const shape = shapes.get('Dictionary');
      expect(shape).toBeDefined();
      expect(shape?.features).toContain('utility-type');
      expect(shape?.features).toContain('generic-instantiation');
      expect(shape?.features).toContain('reference');
      expect(shape?.typeSpecProjection).toBe('policy-required');
    });

    it('analyzes indexed access T[K] as unsupported', () => {
      const source = `
        export interface Config { timeout: number; host: string; }
        export type HostProp = Config['host'];
      `;
      const shapes = getDeclarationShapesInSource(source);
      const hostProp = shapes.get('HostProp');
      expect(hostProp).toBeDefined();
      expect(hostProp?.features).toContain('indexed-access');
      expect(hostProp?.typeSpecProjection).toBe('unsupported');
    });

    it('analyzes conditional type T extends U ? A : B as unsupported', () => {
      const source = `export type IsString<T> = T extends string ? true : false;`;
      const shapes = getDeclarationShapesInSource(source);
      const isString = shapes.get('IsString');
      expect(isString).toBeDefined();
      expect(isString?.features).toContain('conditional');
      expect(isString?.features).toContain('generic-declaration');
      expect(isString?.typeSpecProjection).toBe('unsupported');
    });

    it('analyzes tuples as policy-required', () => {
      const source = `export type Coordinate = [number, number, number?];`;
      const shapes = getDeclarationShapesInSource(source);
      const coord = shapes.get('Coordinate');
      expect(coord).toBeDefined();
      expect(coord?.features).toContain('tuple');
      expect(coord?.features).toContain('optional');
      expect(coord?.typeSpecProjection).toBe('policy-required');
    });

    it('analyzes function and constructor types as unsupported', () => {
      const source = `
        export type Handler = (req: Request) => Promise<Response>;
        export type Factory = new () => MyService;
      `;
      const shapes = getDeclarationShapesInSource(source);
      expect(shapes.get('Handler')?.typeSpecProjection).toBe('unsupported');
      expect(shapes.get('Handler')?.features).toContain('function-type');

      expect(shapes.get('Factory')?.typeSpecProjection).toBe('unsupported');
      expect(shapes.get('Factory')?.features).toContain('constructor-type');
    });

    it('analyzes type query and type operator as unsupported', () => {
      const source = `
        export const baseConfig = { debug: true };
        export type AppConfig = typeof baseConfig;
        export type Keys = keyof AppConfig;
      `;
      const shapes = getDeclarationShapesInSource(source);
      expect(shapes.get('AppConfig')?.features).toContain('type-query');
      expect(shapes.get('AppConfig')?.typeSpecProjection).toBe('unsupported');

      expect(shapes.get('Keys')?.features).toContain('type-operator');
      expect(shapes.get('Keys')?.typeSpecProjection).toBe('unsupported');
    });

    it('analyzes template literals and import types as unsupported', () => {
      const source = `
        export type EventName = \`on\${string}\`;
        export type ExternalType = import('./other.js').Exported;
      `;
      const shapes = getDeclarationShapesInSource(source);
      expect(shapes.get('EventName')?.features).toContain('template-literal');
      expect(shapes.get('EventName')?.typeSpecProjection).toBe('unsupported');

      expect(shapes.get('ExternalType')?.features).toContain('import-type');
      expect(shapes.get('ExternalType')?.typeSpecProjection).toBe('unsupported');
    });
  });

  describe('Source Auditing & Diagnostics Reporting', () => {
    it('audits a valid clean source file and returns valid: true with 0 errors', () => {
      const source = `
        export interface UserProfile {
          id: string;
          displayName: string;
          email?: string | null;
          roles: string[];
        }
      `;
      const audit = auditTypeShapesInSource(source, 'src/models/user.ts');
      expect(audit.valid).toBe(true);
      expect(audit.scannedDeclarations).toBe(1);
      expect(audit.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
      expect(audit.summary).toContain('✅ 0 shape issues found');
    });

    it('emits line/column coordinates and code snippets for unsupported shapes', () => {
      const source = [
        'export interface ValidUser { name: string; }',
        'export type ComplexMap = { [K in string]: number };',
        'export type ItemAccess<T> = T["prop"];',
      ].join('\n');

      const audit = auditTypeShapesInSource(source, 'src/types.ts');
      expect(audit.valid).toBe(false);
      expect(audit.scannedDeclarations).toBe(3);

      const errors = audit.diagnostics.filter((d) => d.severity === 'error');
      expect(errors.length).toBeGreaterThanOrEqual(2);

      const mappedDiag = errors.find((d) => d.feature === 'mapped');
      expect(mappedDiag).toBeDefined();
      expect(mappedDiag?.file).toBe('src/types.ts');
      expect(mappedDiag?.line).toBe(2);
      expect(mappedDiag?.column).toBe(26);
      expect(mappedDiag?.snippet).toBe('export type ComplexMap = { [K in string]: number };');
      expect(mappedDiag?.code).toBe('unsupported-shape');

      const indexedDiag = errors.find((d) => d.feature === 'indexed-access');
      expect(indexedDiag).toBeDefined();
      expect(indexedDiag?.line).toBe(3);
      expect(indexedDiag?.snippet).toContain('T["prop"]');
    });

    it('emits warnings for policy-required shapes without failing valid status', () => {
      const source = `
        export type StringTuple = [string, number];
        export type OptionalNull = string | undefined;
      `;
      const audit = auditTypeShapesInSource(source, 'src/tuples.ts');
      expect(audit.valid).toBe(true);
      const warnings = audit.diagnostics.filter((d) => d.severity === 'warning');
      expect(warnings.length).toBeGreaterThanOrEqual(2);
      expect(warnings.some((d) => d.feature === 'tuple')).toBe(true);
      expect(warnings.some((d) => d.feature === 'undefined')).toBe(true);
      expect(audit.summary).toContain('⚠️ 0 unsupported shapes');
    });
  });
});
