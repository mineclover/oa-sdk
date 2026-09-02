import { describe, expect, it } from 'vitest'
import {
  applyTextEdits,
  computeEntitySpecDiff,
  createDeleteEdit,
  createInsertEdit,
  createReplaceEdit,
  syncEntitySpecWithCode,
  TsAstTypeAdapter,
  TypiaTypeAdapter,
  ZodTypeAdapter,
} from '../../src/index.js'
import type {
  ASTDiff,
  EntityPropertySpec,
  EntitySpec,
  TextEdit,
  TypeAdapter,
} from '../../src/index.js'

describe('E2E TypeScript AST Bidirectional Synchronization (Tiers 1-4)', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('F16: EntitySpec Canonical IR', () => {
      it('F16-1: builds canonical EntitySpec with primitive properties', () => {
        const spec: EntitySpec = {
          id: 'spec-user',
          name: 'User',
          kind: 'interface',
          properties: {
            id: { name: 'id', type: 'string', optional: false },
            age: { name: 'age', type: 'number', optional: true },
            isActive: { name: 'isActive', type: 'boolean', optional: false, defaultValue: true },
          },
        }

        expect(spec.name).toBe('User')
        expect(spec.kind).toBe('interface')
        expect(Object.keys(spec.properties)).toHaveLength(3)
        expect(spec.properties.id.type).toBe('string')
      })

      it('F16-2: builds EntitySpec with discriminator and extends inheritance', () => {
        const spec: EntitySpec = {
          id: 'spec-cat',
          name: 'Cat',
          kind: 'interface',
          extends: ['Animal'],
          discriminator: { propertyName: 'kind', value: 'cat' },
          properties: {
            kind: { name: 'kind', type: 'string', optional: false },
            meowVolume: { name: 'meowVolume', type: 'number', optional: false },
          },
        }

        expect(spec.extends).toEqual(['Animal'])
        expect(spec.discriminator?.propertyName).toBe('kind')
      })

      it('F16-3: represents property constraints (min, max, pattern, format)', () => {
        const prop: EntityPropertySpec = {
          name: 'email',
          type: 'string',
          optional: false,
          constraints: {
            format: 'email',
            minLength: 5,
            maxLength: 100,
          },
        }

        expect(prop.constraints?.format).toBe('email')
        expect(prop.constraints?.minLength).toBe(5)
      })

      it('F16-4: captures docComment at both entity and property levels', () => {
        const spec: EntitySpec = {
          id: 'spec-article',
          name: 'Article',
          kind: 'interface',
          docComment: 'Represents a blog publication',
          properties: {
            title: {
              name: 'title',
              type: 'string',
              docComment: 'Headline title of article',
            },
          },
        }

        expect(spec.docComment).toBe('Represents a blog publication')
        expect(spec.properties.title.docComment).toBe('Headline title of article')
      })

      it('F16-5: supports sourceSpan character coordinate tracking', () => {
        const spec: EntitySpec = {
          id: 'spec-widget',
          name: 'Widget',
          kind: 'interface',
          sourceSpan: { start: 10, end: 150 },
          properties: {
            width: {
              name: 'width',
              type: 'number',
              sourceSpan: { start: 25, end: 40 },
            },
          },
        }

        expect(spec.sourceSpan?.start).toBe(10)
        expect(spec.properties.width.sourceSpan?.end).toBe(40)
      })
    })

    describe('F17: Pluggable TypeAdapter Interface', () => {
      it('F17-1: ZodTypeAdapter implements TypeAdapter interface contract', () => {
        const adapter = new ZodTypeAdapter()
        expect(adapter.name).toBe('zod')
        expect(Array.isArray(adapter.supportedDialects)).toBe(true)
        expect(typeof adapter.read).toBe('function')
        expect(typeof adapter.write).toBe('function')
      })

      it('F17-2: TsAstTypeAdapter implements TypeAdapter interface contract', () => {
        const adapter = new TsAstTypeAdapter()
        expect(adapter.name).toBe('ts-ast')
        expect(typeof adapter.read).toBe('function')
        expect(typeof adapter.write).toBe('function')
      })

      it('F17-3: TypiaTypeAdapter implements TypeAdapter interface contract', () => {
        const adapter = new TypiaTypeAdapter()
        expect(adapter.name).toBe('typia')
        expect(typeof adapter.read).toBe('function')
        expect(typeof adapter.write).toBe('function')
      })

      it('F17-4: adapters handle custom code generation from scratch', () => {
        const spec: EntitySpec = {
          id: 'spec-point',
          name: 'Point',
          kind: 'interface',
          properties: {
            x: { name: 'x', type: 'number' },
            y: { name: 'y', type: 'number' },
          },
        }

        const tsAdapter = new TsAstTypeAdapter()
        const tsCode = tsAdapter.write(spec)
        expect(tsCode).toContain('interface Point')
        expect(tsCode).toContain('x: number;')
        expect(tsCode).toContain('y: number;')
      })

      it('F17-5: adapters parse source code into canonical EntitySpec', () => {
        const code = `
export interface UserProfile {
  id: string;
  name?: string;
}
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.name).toBe('UserProfile')
        expect(spec.properties.id.type).toBe('string')
        expect(spec.properties.name.optional).toBe(true)
      })
    })

    describe('F18: ZodTypeAdapter', () => {
      it('F18-1: parses z.object schema with primitive types', () => {
        const code = `
import { z } from 'zod';
export const UserSchema = z.object({
  id: z.string(),
  age: z.number(),
  isAdmin: z.boolean(),
});
`
        const adapter = new ZodTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.name).toBe('UserSchema')
        expect(spec.properties.id.type).toBe('string')
        expect(spec.properties.age.type).toBe('number')
        expect(spec.properties.isAdmin.type).toBe('boolean')
      })

      it('F18-2: unwraps .optional(), .nullable(), and .default() modifiers', () => {
        const code = `
export const ConfigSchema = z.object({
  debug: z.boolean().optional(),
  timeout: z.number().default(5000),
  tag: z.string().nullable(),
});
`
        const adapter = new ZodTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.debug.optional).toBe(true)
        expect(spec.properties.timeout.defaultValue).toBe(5000)
        expect(spec.properties.tag.nullable).toBe(true)
      })

      it('F18-3: extracts .describe() into docComment', () => {
        const code = `
export const ProductSchema = z.object({
  sku: z.string().describe('Unique stock keeping unit identifier'),
});
`
        const adapter = new ZodTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.sku.docComment).toBe('Unique stock keeping unit identifier')
      })

      it('F18-4: parses constraint methods (.min(), .max(), .regex())', () => {
        const code = `
export const AccountSchema = z.object({
  username: z.string().min(3).max(20),
  score: z.number().min(0).max(100),
});
`
        const adapter = new ZodTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.username.constraints?.min).toBe(3)
        expect(spec.properties.username.constraints?.max).toBe(20)
        expect(spec.properties.score.constraints?.min).toBe(0)
        expect(spec.properties.score.constraints?.max).toBe(100)
      })

      it('F18-5: emits Zod schema code from EntitySpec', () => {
        const spec: EntitySpec = {
          id: 'spec-auth',
          name: 'AuthSchema',
          kind: 'schema',
          properties: {
            token: { name: 'token', type: 'string', optional: false },
            expiresIn: { name: 'expiresIn', type: 'number', optional: true, defaultValue: 3600 },
          },
        }

        const adapter = new ZodTypeAdapter()
        const emitted = adapter.write(spec)
        expect(emitted).toContain('export const AuthSchema = z.object({')
        expect(emitted).toContain('token: z.string()')
        expect(emitted).toContain('expiresIn: z.number()')
      })
    })

    describe('F19: TsAstTypeAdapter', () => {
      it('F19-1: parses TypeScript interface with standard member signatures', () => {
        const code = `
export interface Session {
  id: string;
  userId: number;
  active: boolean;
}
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.name).toBe('Session')
        expect(spec.properties.id.type).toBe('string')
        expect(spec.properties.userId.type).toBe('number')
      })

      it('F19-2: parses TypeScript type alias declaration', () => {
        const code = `
export type Coordinate = {
  latitude: number;
  longitude: number;
};
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.name).toBe('Coordinate')
        expect(spec.properties.latitude.type).toBe('number')
      })

      it('F19-3: preserves interface extends inheritance', () => {
        const code = `
export interface AdminUser extends BaseUser {
  role: string;
}
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.extends).toEqual(['BaseUser'])
      })

      it('F19-4: parses JSDoc block comments on interface and properties', () => {
        const code = `
/**
 * User account representation
 */
export interface Account {
  /** Internal ID */
  id: string;
}
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.docComment).toContain('User account representation')
        expect(spec.properties.id.docComment).toContain('Internal ID')
      })

      it('F19-5: generates clean TypeScript interface code from EntitySpec', () => {
        const spec: EntitySpec = {
          id: 'spec-theme',
          name: 'ThemeConfig',
          kind: 'interface',
          properties: {
            primaryColor: { name: 'primaryColor', type: 'string' },
            darkMode: { name: 'darkMode', type: 'boolean', optional: true },
          },
        }

        const adapter = new TsAstTypeAdapter()
        const code = adapter.write(spec)
        expect(code).toContain('export interface ThemeConfig {')
        expect(code).toContain('primaryColor: string;')
        expect(code).toContain('darkMode?: boolean;')
      })
    })

    describe('F20: TypiaTypeAdapter', () => {
      it('F20-1: parses Typia JSDoc validation tags (@minimum, @maximum, @format)', () => {
        const code = `
export interface NumberRange {
  /**
   * @minimum 10
   * @maximum 100
   * @format int32
   */
  count: number;
}
`
        const adapter = new TypiaTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.count.constraints?.minimum).toBe(10)
        expect(spec.properties.count.constraints?.maximum).toBe(100)
        expect(spec.properties.count.constraints?.format).toBe('int32')
      })

      it('F20-2: parses @default tag into defaultValue', () => {
        const code = `
export interface ServerConfig {
  /**
   * @default "https://api.example.com"
   */
  endpoint: string;
}
`
        const adapter = new TypiaTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.endpoint.defaultValue).toBe('https://api.example.com')
      })

      it('F20-3: retains non-validation JSDoc text alongside Typia tags', () => {
        const code = `
export interface UserPayload {
  /**
   * User display name
   * @minLength 2
   * @maxLength 50
   */
  displayName: string;
}
`
        const adapter = new TypiaTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.displayName.docComment).toContain('User display name')
        expect(spec.properties.displayName.constraints?.minLength).toBe(2)
        expect(spec.properties.displayName.constraints?.maxLength).toBe(50)
      })

      it('F20-4: emits JSDoc tags when writing Typia interface from EntitySpec with constraints', () => {
        const spec: EntitySpec = {
          id: 'spec-metric',
          name: 'Metric',
          kind: 'interface',
          properties: {
            rate: {
              name: 'rate',
              type: 'number',
              docComment: 'Sampling rate in Hz',
              constraints: { minimum: 1, maximum: 120 },
            },
          },
        }

        const adapter = new TypiaTypeAdapter()
        const emitted = adapter.write(spec)
        expect(emitted).toContain('@minimum 1')
        expect(emitted).toContain('@maximum 120')
        expect(emitted).toContain('Sampling rate in Hz')
      })

      it('F20-5: handles string format tags (@format email, @format uuid, @pattern)', () => {
        const code = `
export interface ClientRecord {
  /**
   * @format uuid
   */
  id: string;
}
`
        const adapter = new TypiaTypeAdapter()
        const spec = adapter.read(code)
        expect(spec.properties.id.constraints?.format).toBe('uuid')
      })
    })

    describe('F21: computeEntitySpecDiff Engine', () => {
      it('F21-1: detects added property', () => {
        const specA: EntitySpec = {
          id: 's',
          name: 'Box',
          kind: 'interface',
          properties: { width: { name: 'width', type: 'number' } },
        }
        const specB: EntitySpec = {
          id: 's',
          name: 'Box',
          kind: 'interface',
          properties: {
            width: { name: 'width', type: 'number' },
            height: { name: 'height', type: 'number' },
          },
        }

        const diffs = computeEntitySpecDiff(specA, specB)
        expect(diffs).toHaveLength(1)
        expect(diffs[0].kind).toBe('add-property')
        expect(diffs[0].propertyName).toBe('height')
      })

      it('F21-2: detects removed property', () => {
        const specA: EntitySpec = {
          id: 's',
          name: 'Box',
          kind: 'interface',
          properties: {
            width: { name: 'width', type: 'number' },
            depth: { name: 'depth', type: 'number' },
          },
        }
        const specB: EntitySpec = {
          id: 's',
          name: 'Box',
          kind: 'interface',
          properties: { width: { name: 'width', type: 'number' } },
        }

        const diffs = computeEntitySpecDiff(specA, specB)
        expect(diffs).toHaveLength(1)
        expect(diffs[0].kind).toBe('remove-property')
        expect(diffs[0].propertyName).toBe('depth')
      })

      it('F21-3: detects updated property type', () => {
        const specA: EntitySpec = {
          id: 's',
          name: 'Item',
          kind: 'interface',
          properties: { price: { name: 'price', type: 'string' } },
        }
        const specB: EntitySpec = {
          id: 's',
          name: 'Item',
          kind: 'interface',
          properties: { price: { name: 'price', type: 'number' } },
        }

        const diffs = computeEntitySpecDiff(specA, specB)
        expect(diffs).toHaveLength(1)
        expect(diffs[0].kind).toBe('update-property')
      })

      it('F21-4: detects docComment changes', () => {
        const specA: EntitySpec = {
          id: 's',
          name: 'Item',
          kind: 'interface',
          docComment: 'Old doc',
          properties: {},
        }
        const specB: EntitySpec = {
          id: 's',
          name: 'Item',
          kind: 'interface',
          docComment: 'New doc',
          properties: {},
        }

        const diffs = computeEntitySpecDiff(specA, specB)
        expect(diffs).toHaveLength(1)
        expect(diffs[0].kind).toBe('update-doc-comment')
      })

      it('F21-5: returns empty diffs array when specs are identical', () => {
        const spec: EntitySpec = {
          id: 's',
          name: 'Const',
          kind: 'interface',
          properties: { val: { name: 'val', type: 'boolean' } },
        }

        const diffs = computeEntitySpecDiff(spec, spec)
        expect(diffs).toHaveLength(0)
      })
    })

    describe('F22: Reverse-Offset Bottom-Up applyTextEdits', () => {
      it('F22-1: applies single insertion text edit accurately', () => {
        const source = 'const x = 10;'
        // Insert after '10' before ';' (offset 12)
        const edit = createInsertEdit(12, ' + 5')
        const result = applyTextEdits(source, [edit])
        expect(result).toBe('const x = 10 + 5;')
      })

      it('F22-2: applies single replacement text edit accurately', () => {
        const source = 'const name = "Alice";'
        const edit = createReplaceEdit(13, 20, '"Bob"')
        const result = applyTextEdits(source, [edit])
        expect(result).toBe('const name = "Bob";')
      })

      it('F22-3: applies single deletion text edit accurately', () => {
        const source = 'const str = "hello world";'
        // Delete " world" (start: 18, end: 24)
        const edit = createDeleteEdit(18, 24)
        const result = applyTextEdits(source, [edit])
        expect(result).toBe('const str = "hello";')
      })

      it('F22-4: applies multiple edits bottom-up without offset shifts', () => {
        // Source: "AAA BBB CCC"
        // Target: "AAA_1 BBB_2 CCC_3"
        const source = 'AAA BBB CCC'
        const edits: TextEdit[] = [
          createReplaceEdit(0, 3, 'AAA_1'),
          createReplaceEdit(4, 7, 'BBB_2'),
          createReplaceEdit(8, 11, 'CCC_3'),
        ]

        const result = applyTextEdits(source, edits)
        expect(result).toBe('AAA_1 BBB_2 CCC_3')
      })

      it('F22-5: returns original source when edits array is empty', () => {
        const source = 'let untouched = true;'
        expect(applyTextEdits(source, [])).toBe(source)
      })
    })

    describe('F23: syncEntitySpecWithCode Core Synchronizer', () => {
      it('F23-1: auto-detects Zod code and applies property modifications', () => {
        const originalCode = `
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});
`
        const targetSpec: EntitySpec = {
          id: 'spec-user',
          name: 'UserSchema',
          kind: 'schema',
          properties: {
            id: { name: 'id', type: 'string' },
            name: { name: 'name', type: 'string' },
            email: { name: 'email', type: 'string', optional: true },
          },
        }

        const result = syncEntitySpecWithCode(originalCode, targetSpec)
        expect(result.code).toContain('email: z.string().optional()')
        expect(result.diffs.some(d => d.propertyName === 'email')).toBe(true)
      })

      it('F23-2: auto-detects TypeScript interface and updates property types', () => {
        const originalCode = `
export interface Theme {
  mode: string;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-theme',
          name: 'Theme',
          kind: 'interface',
          properties: {
            mode: { name: 'mode', type: "'light' | 'dark'" },
          },
        }

        const result = syncEntitySpecWithCode(originalCode, targetSpec)
        expect(result.code).toContain("mode: 'light' | 'dark';")
      })

      it('F23-3: auto-detects Typia interface and updates JSDoc constraint tags', () => {
        const originalCode = `
export interface Counter {
  /**
   * @minimum 0
   */
  count: number;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-counter',
          name: 'Counter',
          kind: 'interface',
          properties: {
            count: {
              name: 'count',
              type: 'number',
              constraints: { minimum: 10, min: 10, maximum: 100, max: 100 },
            },
          },
        }

        const result = syncEntitySpecWithCode(originalCode, targetSpec)
        expect(result.code).toContain('@minimum 10')
        expect(result.code).toContain('@maximum 100')
      })

      it('F23-4: returns unmodified code when spec matches existing code exactly', () => {
        const code = `
export interface Clean {
  id: string;
}
`
        const adapter = new TsAstTypeAdapter()
        const spec = adapter.read(code)
        const result = syncEntitySpecWithCode(code, spec)
        expect(result.code).toBe(code)
        expect(result.diffs).toHaveLength(0)
      })

      it('F23-5: respects explicit adapter option override', () => {
        const code = `
export interface Explicit {
  val: number;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-exp',
          name: 'Explicit',
          kind: 'interface',
          properties: {
            val: { name: 'val', type: 'number' },
            extra: { name: 'extra', type: 'string' },
          },
        }

        const result = syncEntitySpecWithCode(code, targetSpec, { adapter: 'ts-ast' })
        expect(result.code).toContain('extra: string;')
      })
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('F22-B: applyTextEdits Boundaries', () => {
      it('F22-B1: throws error on overlapping text edit ranges', () => {
        const source = '0123456789'
        const edits: TextEdit[] = [
          createReplaceEdit(2, 6, 'AAA'),
          createReplaceEdit(4, 8, 'BBB'), // overlaps [2, 6]
        ]

        expect(() => applyTextEdits(source, edits)).toThrow(/overlap/i)
      })

      it('F22-B2: throws error when start offset is negative', () => {
        const source = 'abc'
        expect(() => applyTextEdits(source, [{ start: -1, end: 2, newText: '' }])).toThrow(/invalid.*range/i)
      })

      it('F22-B3: throws error when end offset is less than start offset', () => {
        const source = 'abc'
        expect(() => applyTextEdits(source, [{ start: 5, end: 2, newText: '' }])).toThrow(/invalid.*range/i)
      })

      it('F22-B4: throws error when end offset exceeds source length', () => {
        const source = 'short'
        expect(() => applyTextEdits(source, [{ start: 0, end: 100, newText: '' }])).toThrow(/exceeds/i)
      })

      it('F22-B5: handles adjacent (non-overlapping) zero-width insertions at the same boundary', () => {
        const source = 'abcdef'
        const edits: TextEdit[] = [
          createInsertEdit(3, '[1]'),
        ]
        const result = applyTextEdits(source, edits)
        expect(result).toBe('abc[1]def')
      })
    })

    describe('F23-B: AST Sync Boundaries & Trivia Retention', () => {
      it('F23-B1: preserves inline comments and indentation during property update', () => {
        const source = `
export interface ButtonProps {
  // Primary visual styling
  variant: string; // inline variant comment
  /* Click handler */
  onClick?: () => void;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-btn',
          name: 'ButtonProps',
          kind: 'interface',
          properties: {
            variant: { name: 'variant', type: "'primary' | 'secondary' | 'ghost'" },
            onClick: { name: 'onClick', type: '() => void', optional: true },
          },
        }

        const result = syncEntitySpecWithCode(source, targetSpec)
        expect(result.code).toContain('Primary visual styling')
        expect(result.code).toContain('Click handler')
        expect(result.code).toContain("'primary' | 'secondary' | 'ghost'")
      })

      it('F23-B2: adds property to empty interface', () => {
        const source = `
export interface Empty {}
`
        const targetSpec: EntitySpec = {
          id: 'spec-empty',
          name: 'Empty',
          kind: 'interface',
          properties: {
            firstProp: { name: 'firstProp', type: 'string' },
          },
        }

        const result = syncEntitySpecWithCode(source, targetSpec)
        expect(result.code).toContain('firstProp: string;')
      })

      it('F23-B3: removes property while preserving surrounding property comments', () => {
        const source = `
export interface Config {
  // Keep this
  keep: boolean;
  // Delete this
  removeMe: string;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-cfg',
          name: 'Config',
          kind: 'interface',
          properties: {
            keep: { name: 'keep', type: 'boolean' },
          },
        }

        const result = syncEntitySpecWithCode(source, targetSpec)
        expect(result.code).toContain('keep: boolean;')
        expect(result.code).not.toContain('removeMe')
      })

      it('F23-B4: preserves non-standard 4-space indentation', () => {
        const source = `
export interface Indented {
    a: number;
    b: number;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-ind',
          name: 'Indented',
          kind: 'interface',
          properties: {
            a: { name: 'a', type: 'number' },
            b: { name: 'b', type: 'number' },
            c: { name: 'c', type: 'number' },
          },
        }

        const result = syncEntitySpecWithCode(source, targetSpec)
        expect(result.code).toContain('c: number;')
      })

      it('F23-B5: handles unicode identifiers and special character property names', () => {
        const source = `
export interface UnicodeProps {
  'data-surface-id': string;
}
`
        const targetSpec: EntitySpec = {
          id: 'spec-uni',
          name: 'UnicodeProps',
          kind: 'interface',
          properties: {
            'data-surface-id': { name: 'data-surface-id', type: 'string' },
            'aria-label': { name: 'aria-label', type: 'string', optional: true },
          },
        }

        const result = syncEntitySpecWithCode(source, targetSpec)
        expect(result.code).toContain('aria-label')
      })
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: Bi-directional roundtrip sync across dialects (Zod <-> TS Interface <-> Typia)', () => {
      // 1. Start from Zod schema code
      const zodCode = `
import { z } from 'zod';
export const MasterSchema = z.object({
  id: z.string(),
  count: z.number().min(0).max(100),
  active: z.boolean().default(true),
});
`
      const zodAdapter = new ZodTypeAdapter()
      const tsAdapter = new TsAstTypeAdapter()
      const typiaAdapter = new TypiaTypeAdapter()

      // 2. Zod -> EntitySpec
      const specFromZod = zodAdapter.read(zodCode)
      expect(specFromZod.name).toBe('MasterSchema')
      expect(specFromZod.properties.count.constraints?.min).toBe(0)

      // 3. EntitySpec -> TypeScript Interface Code
      const tsCode = tsAdapter.write(specFromZod)
      expect(tsCode).toContain('interface MasterSchema')

      // 4. TS Interface Code -> EntitySpec
      const specFromTs = tsAdapter.read(tsCode)
      expect(specFromTs.name).toBe('MasterSchema')
      expect(specFromTs.properties.id.name).toBe('id')

      // 5. EntitySpec -> Typia Interface Code (with @minimum JSDoc)
      const typiaCode = typiaAdapter.write(specFromZod)
      expect(typiaCode).toContain('@minimum 0')
      expect(typiaCode).toContain('@maximum 100')

      // 6. Typia Code -> EntitySpec
      const specFromTypia = typiaAdapter.read(typiaCode)
      expect(specFromTypia.properties.count.constraints?.minimum).toBe(0)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4-1: 60fps Visual Design Tool Parameter Slider Live Patching with Zero Trivia Loss', () => {
      const sourceCode = `
// Visual Hero Banner Component Specs
export const HeroBannerConfig = z.object({
  /* Header title */
  title: z.string().default("Welcome to Studio"),
  // Slider controlled width
  width: z.number().min(200).max(1200).default(800), // @surface live-slider
  /* Background color token */
  backgroundColor: z.string().default("#1e293b"),
});
`
      // User scrubs slider from default(800) -> default(1024)
      const targetSpec: EntitySpec = {
        id: 'hero-spec',
        name: 'HeroBannerConfig',
        kind: 'schema',
        properties: {
          title: { name: 'title', type: 'string', defaultValue: 'Welcome to Studio', docComment: 'Header title' },
          width: {
            name: 'width',
            type: 'number',
            defaultValue: 1024,
            constraints: { min: 200, max: 1200 },
            docComment: 'Slider controlled width',
          },
          backgroundColor: { name: 'backgroundColor', type: 'string', defaultValue: '#1e293b', docComment: 'Background color token' },
        },
      }

      const syncResult = syncEntitySpecWithCode(sourceCode, targetSpec)

      // Verified: 1024 value patched
      expect(syncResult.code).toContain('1024')
      // Verified: comments and trivia intact
      expect(syncResult.code).toContain('Visual Hero Banner Component Specs')
      expect(syncResult.code).toContain('Background color token')
    })

    it('T4-2: Typia Validated Interface AST Synchronization with Preserved Comments & Trivia', () => {
      const sourceCode = `
/**
 * Payment Transaction Request Contract
 */
export interface TransactionRequest {
  /**
   * Unique client idempotency key
   * @format uuid
   */
  idempotencyKey: string;

  /**
   * Transaction amount in cents
   * @minimum 100
   * @maximum 1000000
   */
  amountInCents: number;

  /**
   * Currency ISO code
   * @default "USD"
   */
  currency?: string;
}
`
      // Update max transaction amount from 1,000,000 to 5,000,000
      const typiaAdapter = new TypiaTypeAdapter()
      const currentSpec = typiaAdapter.read(sourceCode)

      const updatedSpec: EntitySpec = {
        ...currentSpec,
        properties: {
          ...currentSpec.properties,
          amountInCents: {
            ...currentSpec.properties.amountInCents,
            constraints: {
              minimum: 100,
              min: 100,
              maximum: 5000000,
              max: 5000000,
            },
          },
        },
      }

      const syncResult = syncEntitySpecWithCode(sourceCode, updatedSpec, { adapter: typiaAdapter })

      expect(syncResult.code).toContain('@maximum 5000000')
      expect(syncResult.code).toContain('Payment Transaction Request Contract')
      expect(syncResult.code).toContain('Unique client idempotency key')
      expect(syncResult.code).toContain('Currency ISO code')
    })
  })
})
