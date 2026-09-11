/**
 * Challenger 1 Adversarial Stress Test Suite: OpenAPI 3.2 to Zod 4 Generator
 *
 * Focus Areas:
 * 1. Deep 3-way and 4-way circular references (A -> B -> C -> D -> A)
 * 2. Extreme numeric boundary values (IEEE 754 precision, negative infinity, zero exclusive bounds, multipleOf)
 * 3. Empty tuples prefixItems: [], single-element tuples, and complex rest schemas
 * 4. Polymorphic discriminators (overlapping mapping, missing discriminator properties, OAS 3.2 defaultMapping fallback)
 * 5. Sibling keywords on combinators (allOf, oneOf, anyOf)
 *
 * Conforms to:
 * - ORIGINAL_REQUEST.md (§R1, §R2, §R3, §R4)
 * - PROJECT.md (Architecture, Interface Contracts, Feature Inventory)
 * - Challenger 1 Dispatch Directive
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import ts from 'typescript'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'
import {
  createZod4Algebra,
  schemaToZod,
  prepareSchemaForZod,
  generateZodFromSpec,
} from '../../src/zodgen/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper to typecheck generated TypeScript code in-memory using the package's tsconfig
function typecheckTsSource(code: string, virtualFileName: string = 'test-generated.ts'): {
  diagnostics: ts.Diagnostic[]
  formattedErrors: string[]
} {
  const filePath = path.resolve(__dirname, virtualFileName)
  const configPath = ts.findConfigFile(__dirname, ts.sys.fileExists, 'tsconfig.json')
    ?? path.resolve(__dirname, '../../tsconfig.json')
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath))

  const host = ts.createCompilerHost(parsedConfig.options)
  const origGetSourceFile = host.getSourceFile
  host.getSourceFile = (name, langVersion, onError, shouldCreateNewSourceFile) => {
    if (path.resolve(name) === filePath) {
      return ts.createSourceFile(name, code, langVersion)
    }
    return origGetSourceFile(name, langVersion, onError, shouldCreateNewSourceFile)
  }

  const program = ts.createProgram([filePath], parsedConfig.options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const relevantDiags = diagnostics.filter(d => path.resolve(d.file?.fileName || '') === filePath)
  const formattedErrors = relevantDiags.map(d => ts.formatDiagnostic(d, host).trim())

  return { diagnostics: relevantDiags, formattedErrors }
}

// Helper to evaluate generated Zod expression string in a safe function context
function evalZod(code: string, context: Record<string, unknown> = {}): z.ZodTypeAny {
  const keys = ['z', ...Object.keys(context)]
  const values = [z, ...Object.values(context)]
  const fn = new Function(...keys, `return ${code};`)
  return fn(...values) as z.ZodTypeAny
}

describe('Challenger 1 Adversarial Suite: OpenAPI 3.2 → Zod 4 Generator', () => {
  // ===========================================================================
  // Target 1: Deep 3-way and 4-way Circular References
  // ===========================================================================
  describe('Target 1: Deep Circular References', () => {
    it('generates 4-way circular reference cycle (A -> B -> C -> D -> A) and validates at runtime', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: '4-Way Circular API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            A: {
              type: 'object',
              properties: { b: { $ref: '#/components/schemas/B' } },
            },
            B: {
              type: 'object',
              properties: { c: { $ref: '#/components/schemas/C' } },
            },
            C: {
              type: 'object',
              properties: { d: { $ref: '#/components/schemas/D' } },
            },
            D: {
              type: 'object',
              properties: { a: { $ref: '#/components/schemas/A' } },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc)
      expect(tsCode).toMatch(/export const ASchema(?:: z\.ZodTypeAny)? = z\.object\(\{/)
      expect(tsCode).toContain('b: z.lazy(() => BSchema).optional()')
      expect(tsCode).toMatch(/export const BSchema(?:: z\.ZodTypeAny)? = z\.object\(\{/)
      expect(tsCode).toContain('c: z.lazy(() => CSchema).optional()')
      expect(tsCode).toMatch(/export const CSchema(?:: z\.ZodTypeAny)? = z\.object\(\{/)
      expect(tsCode).toContain('d: z.lazy(() => DSchema).optional()')
      expect(tsCode).toMatch(/export const DSchema(?:: z\.ZodTypeAny)? = z\.object\(\{/)
      expect(tsCode).toContain('a: z.lazy(() => ASchema).optional()')

      // Evaluate runtime behavior with full 4-cycle recursion
      const sanitized = tsCode
        .replace(/^import\s+.*$/gm, '')
        .replace(/^export\s+type\s+.*$/gm, '')
        .replace(/:\s*z\.ZodTypeAny/g, '')
        .replace(/export\s+/g, '')
      const evalFn = new Function(
        'z',
        `${sanitized}\nreturn { ASchema, BSchema, CSchema, DSchema };`,
      )
      const { ASchema } = evalFn(z) as { ASchema: z.ZodTypeAny }

      // 4-step nested instance
      const validDeepInstance = {
        b: {
          c: {
            d: {
              a: {
                b: {
                  c: {},
                },
              },
            },
          },
        },
      }
      expect(ASchema.safeParse(validDeepInstance).success).toBe(true)

      // Invalid leaf node in cycle
      const invalidInstance = {
        b: {
          c: {
            d: {
              a: 12345, // invalid
            },
          },
        },
      }
      expect(ASchema.safeParse(invalidInstance).success).toBe(false)
    })

    it('generates 3-way circular reference cycle (A -> B -> C -> A) and validates at runtime', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: '3-Way Circular API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            NodeA: {
              type: 'object',
              properties: { toB: { $ref: '#/components/schemas/NodeB' } },
            },
            NodeB: {
              type: 'object',
              properties: { toC: { $ref: '#/components/schemas/NodeC' } },
            },
            NodeC: {
              type: 'object',
              properties: { toA: { $ref: '#/components/schemas/NodeA' } },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc)
      expect(tsCode).toContain('toB: z.lazy(() => NodeBSchema).optional()')
      expect(tsCode).toContain('toC: z.lazy(() => NodeCSchema).optional()')
      expect(tsCode).toContain('toA: z.lazy(() => NodeASchema).optional()')

      const sanitized = tsCode
        .replace(/^import\s+.*$/gm, '')
        .replace(/^export\s+type\s+.*$/gm, '')
        .replace(/:\s*z\.ZodTypeAny/g, '')
        .replace(/export\s+/g, '')
      const evalFn = new Function(
        'z',
        `${sanitized}\nreturn NodeASchema;`,
      )
      const NodeASchema = evalFn(z) as z.ZodTypeAny
      expect(NodeASchema.safeParse({ toB: { toC: { toA: {} } } }).success).toBe(true)
      expect(NodeASchema.safeParse({ toB: { toC: { toA: 'bad' } } }).success).toBe(false)
    })

    it('stress-tests circular references under TypeScript tsc --noEmit compiler', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Circular API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
            B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc)
      const { diagnostics, formattedErrors } = typecheckTsSource(tsCode, 'circular-typecheck.ts')

      // ADVERSARIAL OBSERVATION:
      // TypeScript strict mode triggers TS7022 and TS7024 on circular z.lazy constants
      // because they lack explicit type annotations (e.g. z.ZodType<...> or : z.ZodTypeAny).
      // With selective : z.ZodTypeAny annotations on cycle participants, diagnostics must be 0.
      expect(diagnostics.length, `TypeScript diagnostics: ${formattedErrors.join('\n')}`).toBe(0)
    })
  })

  // ===========================================================================
  // Target 2: Extreme Numeric Boundary Values
  // ===========================================================================
  describe('Target 2: Extreme Numeric Boundary Values', () => {
    it('handles zero exclusive bounds (exclusiveMinimum: 0, exclusiveMaximum: 0)', () => {
      const codeGt0 = schemaToZod({
        type: 'number',
        exclusiveMinimum: 0,
      })
      expect(codeGt0).toBe('z.number().gt(0)')

      const validatorGt0 = evalZod(codeGt0)
      expect(validatorGt0.safeParse(0).success).toBe(false)
      expect(validatorGt0.safeParse(-0).success).toBe(false)
      expect(validatorGt0.safeParse(0.0000000000000001).success).toBe(true)
      expect(validatorGt0.safeParse(-1e-15).success).toBe(false)

      const codeLt0 = schemaToZod({
        type: 'number',
        exclusiveMaximum: 0,
      })
      expect(codeLt0).toBe('z.number().lt(0)')

      const validatorLt0 = evalZod(codeLt0)
      expect(validatorLt0.safeParse(0).success).toBe(false)
      expect(validatorLt0.safeParse(-0.0000000000000001).success).toBe(true)
      expect(validatorLt0.safeParse(1e-15).success).toBe(false)
    })

    it('handles IEEE 754 subnormal and precision boundaries (MIN_VALUE, MAX_VALUE, MAX_SAFE_INTEGER)', () => {
      const codeSubnormal = schemaToZod({
        type: 'number',
        exclusiveMinimum: Number.MIN_VALUE, // 5e-324
        maximum: Number.MAX_SAFE_INTEGER,   // 9007199254740991
      })
      expect(codeSubnormal).toBe(`z.number().gt(${Number.MIN_VALUE}).lte(${Number.MAX_SAFE_INTEGER})`)

      const validator = evalZod(codeSubnormal)
      expect(validator.safeParse(Number.MIN_VALUE).success).toBe(false)
      expect(validator.safeParse(Number.MIN_VALUE * 2).success).toBe(true)
      expect(validator.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true)
      expect(validator.safeParse(Number.MAX_SAFE_INTEGER + 10).success).toBe(false)
    })

    it('handles negative infinity and positive infinity boundaries', () => {
      const code = schemaToZod({
        type: 'number',
        minimum: -Infinity,
        maximum: Infinity,
      })
      expect(code).toBe('z.number().gte(-Infinity).lte(Infinity)')

      const validator = evalZod(code)
      expect(validator.safeParse(0).success).toBe(true)
      expect(validator.safeParse(-1e300).success).toBe(true)
      expect(validator.safeParse(1e300).success).toBe(true)
    })

    it('combines exclusiveMinimum: 0 with multipleOf constraints', () => {
      const code = schemaToZod({
        type: 'number',
        exclusiveMinimum: 0,
        multipleOf: 0.1,
      })
      expect(code).toBe('z.number().gt(0).multipleOf(0.1)')

      const validator = evalZod(code)
      expect(validator.safeParse(0).success).toBe(false)
      expect(validator.safeParse(0.1).success).toBe(true)
      expect(validator.safeParse(0.2).success).toBe(true)
      expect(validator.safeParse(0.3).success).toBe(true) // Floating-point remainder test
      expect(validator.safeParse(0.35).success).toBe(false)
    })

    it('observes multipleOf behavior on integer with multipleOf: 0 and negative step', () => {
      const codeZero = schemaToZod({
        type: 'integer',
        multipleOf: 0,
      })
      expect(codeZero).toBe('z.int().multipleOf(0)')

      const validatorZero = evalZod(codeZero)
      // MultipleOf 0 is mathematically undefined; Zod rejects all values
      expect(validatorZero.safeParse(0).success).toBe(false)

      const codeNeg = schemaToZod({
        type: 'number',
        multipleOf: -5,
      })
      expect(codeNeg).toBe('z.number().multipleOf(-5)')
      const validatorNeg = evalZod(codeNeg)
      expect(validatorNeg.safeParse(10).success).toBe(true)
      expect(validatorNeg.safeParse(12).success).toBe(false)
    })
  })

  // ===========================================================================
  // Target 3: Empty Tuples, Single-Element Tuples & Complex Rest Schemas
  // ===========================================================================
  describe('Target 3: Tuples & Rest Schemas', () => {
    it('handles empty tuple prefixItems: [] with items: false', () => {
      const code = schemaToZod({
        type: 'array',
        prefixItems: [],
        items: false as unknown as OasSchema,
      })
      expect(code).toBe('z.tuple([])')

      const validator = evalZod(code)
      expect(validator.safeParse([]).success).toBe(true)
      expect(validator.safeParse([1]).success).toBe(false)
      expect(validator.safeParse(['a', 'b']).success).toBe(false)
    })

    it('handles empty tuple prefixItems: [] with items: true vs items schema', () => {
      const codeWithRestUnknown = schemaToZod({
        type: 'array',
        prefixItems: [],
        items: true as unknown as OasSchema,
      })
      // When prefixItems is empty and items is true/schema, falls back to array
      expect(codeWithRestUnknown).toBe('z.array(z.unknown())')

      const codeWithRestString = schemaToZod({
        type: 'array',
        prefixItems: [],
        items: { type: 'string' },
      })
      expect(codeWithRestString).toBe('z.array(z.string())')
    })

    it('handles single-element tuple prefixItems: [string] with closed and open rest', () => {
      const closedCode = schemaToZod({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: false as unknown as OasSchema,
      })
      expect(closedCode).toBe('z.tuple([z.string()])')

      const closedValidator = evalZod(closedCode)
      expect(closedValidator.safeParse(['alpha']).success).toBe(true)
      expect(closedValidator.safeParse(['alpha', 123]).success).toBe(false)
      expect(closedValidator.safeParse([]).success).toBe(false)

      const openCode = schemaToZod({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: true as unknown as OasSchema,
      })
      expect(openCode).toBe('z.tuple([z.string()]).rest(z.unknown())')

      const openValidator = evalZod(openCode)
      expect(openValidator.safeParse(['alpha']).success).toBe(true)
      expect(openValidator.safeParse(['alpha', 123, true]).success).toBe(true)
      expect(openValidator.safeParse([]).success).toBe(false)
    })

    it('handles tuples with complex rest schemas (nested object with constraints and union)', () => {
      const code = schemaToZod({
        type: 'array',
        prefixItems: [{ type: 'string', format: 'uuid' }],
        items: {
          type: 'object',
          required: ['id', 'status'],
          properties: {
            id: { type: 'integer', minimum: 1 },
            status: { type: 'string', enum: ['pending', 'active'] },
          },
          additionalProperties: false,
        },
      })
      expect(code).toContain('z.tuple([z.string().guid()]).rest(')
      expect(code).toContain('id: z.int().gte(1)')
      expect(code).toContain('status: z.enum(["pending", "active"])')
      expect(code).toContain('.strict()')

      const validator = evalZod(code)
      const valid = [
        '123e4567-e89b-12d3-a456-426614174000',
        { id: 1, status: 'active' },
        { id: 2, status: 'pending' },
      ]
      expect(validator.safeParse(valid).success).toBe(true)

      const invalidRest = [
        '123e4567-e89b-12d3-a456-426614174000',
        { id: 1, status: 'active', extra: true }, // strict violation
      ]
      expect(validator.safeParse(invalidRest).success).toBe(false)
    })

    it('handles tuples with minItems and maxItems bounds', () => {
      const code = schemaToZod({
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
        minItems: 2,
        maxItems: 4,
      })
      expect(code).toBe(
        'z.tuple([z.string()]).rest(z.number()).check(z.minLength(2)).check(z.maxLength(4))',
      )

      const validator = evalZod(code)
      expect(validator.safeParse(['a']).success).toBe(false) // length 1 < 2
      expect(validator.safeParse(['a', 1]).success).toBe(true) // length 2
      expect(validator.safeParse(['a', 1, 2]).success).toBe(true) // length 3
      expect(validator.safeParse(['a', 1, 2, 3]).success).toBe(true) // length 4
      expect(validator.safeParse(['a', 1, 2, 3, 4]).success).toBe(false) // length 5 > 4
    })
  })

  // ===========================================================================
  // Target 4: Polymorphic Discriminators & Fallback Routing
  // ===========================================================================
  describe('Target 4: Polymorphic Discriminators & Fallback Routing', () => {
    it('compiles discriminator with valid literal variants and verifies runtime routing', () => {
      const code = schemaToZod({
        oneOf: [
          {
            type: 'object',
            required: ['kind', 'meow'],
            properties: {
              kind: { const: 'cat' },
              meow: { type: 'string' },
            },
          },
          {
            type: 'object',
            required: ['kind', 'bark'],
            properties: {
              kind: { const: 'dog' },
              bark: { type: 'string' },
            },
          },
        ],
        discriminator: {
          propertyName: 'kind',
        },
      })
      expect(code).toContain('z.discriminatedUnion("kind", [')
      expect(code).toContain('{ unionFallback: true }')

      const validator = evalZod(code)
      expect(validator.safeParse({ kind: 'cat', meow: 'purr' }).success).toBe(true)
      expect(validator.safeParse({ kind: 'dog', bark: 'woof' }).success).toBe(true)
      expect(validator.safeParse({ kind: 'cat', bark: 'woof' }).success).toBe(false)
      expect(validator.safeParse({ kind: 'unknown' }).success).toBe(false)
    })

    it('compiles discriminator with OAS 3.2 defaultMapping fallback routing', () => {
      const code = schemaToZod(
        {
          oneOf: [
            { $ref: '#/components/schemas/Circle' },
            { $ref: '#/components/schemas/Square' },
          ],
          discriminator: {
            propertyName: 'shapeType',
            defaultMapping: '#/components/schemas/CustomShape',
          },
        },
        {
          refNameOverrides: {
            '#/components/schemas/Circle': 'CircleSchema',
            '#/components/schemas/Square': 'SquareSchema',
            '#/components/schemas/CustomShape': 'CustomShapeSchema',
          },
        },
      )
      expect(code).toContain('z.union([z.discriminatedUnion("shapeType"')
      expect(code).toContain('CustomShapeSchema')

      const CircleSchema = z.object({ shapeType: z.literal('circle'), radius: z.number() })
      const SquareSchema = z.object({ shapeType: z.literal('square'), side: z.number() })
      const CustomShapeSchema = z.object({ rawData: z.string() })

      const validator = evalZod(code, { CircleSchema, SquareSchema, CustomShapeSchema })
      expect(validator.safeParse({ shapeType: 'circle', radius: 10 }).success).toBe(true)
      expect(validator.safeParse({ shapeType: 'square', side: 5 }).success).toBe(true)
      // Fallback routing matches unknown shapeType
      expect(validator.safeParse({ shapeType: 'hexagon', rawData: 'poly-6' }).success).toBe(true)
    })

    it('stress-tests missing discriminator property and non-literal property variants', () => {
      // In OpenAPI 3.2, child schemas might omit const/enum on discriminator property
      const codeNonLiteral = schemaToZod({
        oneOf: [
          {
            type: 'object',
            properties: { kind: { type: 'string' } },
          },
          {
            type: 'object',
            properties: { kind: { type: 'string' } },
          },
        ],
        discriminator: {
          propertyName: 'kind',
        },
      })
      expect(codeNonLiteral).toContain('z.discriminatedUnion("kind"')

      // At runtime, Zod 4's discriminatedUnion throws when an option is not a literal
      expect(() => {
        const validator = evalZod(codeNonLiteral)
        validator.safeParse({ kind: 'any' })
      }).toThrow(/Invalid discriminated union option/)
    })

    it('stress-tests overlapping discriminator values across variants', () => {
      // Two variants with the same discriminator literal value
      const codeOverlap = schemaToZod({
        oneOf: [
          {
            type: 'object',
            properties: { role: { const: 'admin' }, p1: { type: 'string' } },
          },
          {
            type: 'object',
            properties: { role: { const: 'admin' }, p2: { type: 'number' } },
          },
        ],
        discriminator: {
          propertyName: 'role',
        },
      })

      // At runtime, Zod 4 rejects duplicate discriminator values in discriminatedUnion
      expect(() => {
        const validator = evalZod(codeOverlap)
        validator.safeParse({ role: 'admin', p1: 'test' })
      }).toThrow(/Duplicate discriminator value/)
    })
  })

  // ===========================================================================
  // Target 5: Sibling Keywords on Combinators (allOf, oneOf, anyOf)
  // ===========================================================================
  describe('Target 5: Sibling Keywords on Combinators', () => {
    it('merges sibling object properties with allOf branches using chained .and()', () => {
      const code = schemaToZod({
        allOf: [
          { type: 'object', properties: { branch1: { type: 'string' } } },
          { type: 'object', properties: { branch2: { type: 'number' } } },
        ],
        properties: {
          siblingProp: { type: 'boolean' },
        },
      })
      expect(code).toContain('branch1: z.string().optional()')
      expect(code).toContain('branch2: z.number().optional()')
      expect(code).toContain('siblingProp: z.boolean().optional()')

      const validator = evalZod(code)
      expect(validator.safeParse({ branch1: 'a', branch2: 2, siblingProp: true }).success).toBe(true)
      expect(validator.safeParse({ branch1: 'a', branch2: 'bad', siblingProp: true }).success).toBe(false)
    })

    it('merges sibling object properties and discriminator on oneOf', () => {
      const code = schemaToZod({
        properties: {
          commonId: { type: 'string', format: 'uuid' },
        },
        required: ['commonId'],
        discriminator: { propertyName: 'action' },
        oneOf: [
          {
            type: 'object',
            required: ['action', 'createData'],
            properties: { action: { const: 'create' }, createData: { type: 'string' } },
          },
          {
            type: 'object',
            required: ['action', 'deleteId'],
            properties: { action: { const: 'delete' }, deleteId: { type: 'number' } },
          },
        ],
      })
      expect(code).toContain('commonId: z.string().guid()')
      expect(code).toContain('z.discriminatedUnion("action"')

      const validator = evalZod(code)
      expect(
        validator.safeParse({
          commonId: '123e4567-e89b-12d3-a456-426614174000',
          action: 'create',
          createData: 'payload',
        }).success,
      ).toBe(true)

      expect(
        validator.safeParse({
          commonId: '123e4567-e89b-12d3-a456-426614174000',
          action: 'delete',
          deleteId: 42,
        }).success,
      ).toBe(true)

      // Missing sibling required property
      expect(
        validator.safeParse({
          action: 'create',
          createData: 'payload',
        }).success,
      ).toBe(false)
    })

    it('enforces strict object sealing on both sibling properties and combinator branches', () => {
      const code = schemaToZod({
        properties: {
          base: { type: 'string' },
        },
        additionalProperties: false,
        oneOf: [
          {
            type: 'object',
            required: ['kind'],
            properties: { kind: { const: 'v1' } },
            additionalProperties: false,
          },
          {
            type: 'object',
            required: ['kind'],
            properties: { kind: { const: 'v2' } },
            additionalProperties: false,
          },
        ],
        discriminator: { propertyName: 'kind' },
      })
      expect(code).toContain('.strict()')

      const validator = evalZod(code)
      expect(validator.safeParse({ base: 'ok', kind: 'v1' }).success).toBe(true)
      expect(validator.safeParse({ base: 'ok', kind: 'v1', extra: 123 }).success).toBe(false)
    })

    it('handles discriminator property omitted from required list on variants gracefully', () => {
      const code = schemaToZod({
        oneOf: [
          {
            type: 'object',
            properties: { kind: { const: 'v1' } },
          },
          {
            type: 'object',
            properties: { kind: { const: 'v2' } },
          },
        ],
        discriminator: { propertyName: 'kind' },
      })

      const validator = evalZod(code)
      expect(validator.safeParse({ kind: 'v1' }).success).toBe(true)
      expect(validator.safeParse({ kind: 'v2' }).success).toBe(true)
      expect(validator.safeParse({}).success).toBe(false)
    })

    it('preserves metadata (description, default, nullable) on combinators', () => {
      const code = schemaToZod({
        oneOf: [{ type: 'string' }, { type: 'integer' }],
        description: 'String or integer identifier',
        default: 'default-id',
        nullable: true,
      } as unknown as OasSchema)
      expect(code).toContain('.nullable()')
      expect(code).toContain('.default("default-id")')
      expect(code).toContain('.describe("String or integer identifier")')

      const validator = evalZod(code)
      expect(validator.safeParse(null).success).toBe(true)
      expect(validator.safeParse('custom').success).toBe(true)
      expect(validator.safeParse(123).success).toBe(true)
      expect(validator.safeParse(true).success).toBe(false)
    })

    it('typechecks generated combinators with sibling properties under tsc --noEmit', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Combinator Sibling API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            ActionRequest: {
              type: 'object',
              required: ['reqId'],
              properties: { reqId: { type: 'string', format: 'uuid' } },
              discriminator: { propertyName: 'action' },
              oneOf: [
                {
                  type: 'object',
                  required: ['action', 'paramA'],
                  properties: { action: { const: 'A' }, paramA: { type: 'string' } },
                },
                {
                  type: 'object',
                  required: ['action', 'paramB'],
                  properties: { action: { const: 'B' }, paramB: { type: 'number' } },
                },
              ],
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc)
      const { diagnostics, formattedErrors } = typecheckTsSource(tsCode, 'sibling-typecheck.ts')
      expect(diagnostics.length, `TypeScript diagnostics: ${formattedErrors.join('\n')}`).toBe(0)
    })
  })
})
