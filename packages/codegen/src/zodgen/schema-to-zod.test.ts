import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'
import { createZod4Algebra, schemaToZod, prepareSchemaForZod } from './schema-to-zod.js'
import { generateZodFromSpec } from './generate-zod.js'

describe('Zod 4 Schema Generator (OpenAPI 3.2)', () => {
  describe('Leaf Types', () => {
    it('generates string with all formats', () => {
      expect(schemaToZod({ type: 'string' })).toBe('z.string()')
      expect(schemaToZod({ type: 'string', format: 'uuid' })).toBe('z.string().guid()')
      expect(schemaToZod({ type: 'string', format: 'guid' })).toBe('z.string().guid()')
      expect(schemaToZod({ type: 'string', format: 'email' })).toBe('z.string().email()')
      expect(schemaToZod({ type: 'string', format: 'uri' })).toBe('z.string().url()')
      expect(schemaToZod({ type: 'string', format: 'url' })).toBe('z.string().url()')
      expect(schemaToZod({ type: 'string', format: 'date-time' })).toBe('z.string().datetime()')
      expect(schemaToZod({ type: 'string', format: 'date' })).toBe('z.string().date()')
      expect(schemaToZod({ type: 'string', format: 'time' })).toBe('z.string().time()')
      expect(schemaToZod({ type: 'string', format: 'duration' })).toBe('z.string().duration()')
      expect(schemaToZod({ type: 'string', format: 'ipv4' })).toBe('z.string().ipv4()')
      expect(schemaToZod({ type: 'string', format: 'ipv6' })).toBe('z.string().ipv6()')
      expect(schemaToZod({ type: 'string', format: 'cuid' })).toBe('z.string().cuid()')
      expect(schemaToZod({ type: 'string', format: 'cuid2' })).toBe('z.string().cuid2()')
      expect(schemaToZod({ type: 'string', format: 'ulid' })).toBe('z.string().ulid()')
      expect(schemaToZod({ type: 'string', format: 'nanoid' })).toBe('z.string().nanoid()')
    })

    it('generates string with length and pattern constraints', () => {
      const code = schemaToZod({
        type: 'string',
        minLength: 3,
        maxLength: 20,
        pattern: '^[a-z]+$',
      })
      expect(code).toBe('z.string().min(3).max(20).regex(new RegExp("^[a-z]+$"))')
    })

    it('generates string enum and const', () => {
      expect(schemaToZod({ type: 'string', enum: ['admin', 'user', 'guest'] })).toBe(
        'z.enum(["admin", "user", "guest"])',
      )
      expect(schemaToZod({ type: 'string', const: 'active' })).toBe('z.literal("active")')
    })

    it('generates integer with multipleOf', () => {
      expect(schemaToZod({ type: 'integer' })).toBe('z.int()')
      expect(schemaToZod({ type: 'integer', multipleOf: 5 })).toBe('z.int().multipleOf(5)')
      expect(schemaToZod({ type: 'integer', const: 42 })).toBe('z.literal(42)')
      expect(schemaToZod({ type: 'integer', enum: [1, 2, 3] })).toBe(
        'z.union([z.literal(1), z.literal(2), z.literal(3)])',
      )
    })

    it('generates number with multipleOf and const', () => {
      expect(schemaToZod({ type: 'number' })).toBe('z.number()')
      expect(schemaToZod({ type: 'number', multipleOf: 0.5 })).toBe('z.number().multipleOf(0.5)')
      expect(schemaToZod({ type: 'number', const: 3.14 })).toBe('z.literal(3.14)')
    })

    it('generates boolean and null', () => {
      expect(schemaToZod({ type: 'boolean' })).toBe('z.boolean()')
      expect(schemaToZod({ type: 'boolean', const: true })).toBe('z.literal(true)')
      expect(schemaToZod({ type: 'null' })).toBe('z.null()')
    })
  })

  describe('Numeric Exclusive Bounds (OAS 3.2 / Draft 2020-12)', () => {
    it('compiles numeric exclusiveMinimum to .gt(n) and exclusiveMaximum to .lt(n)', () => {
      const code = schemaToZod({
        type: 'number',
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
      })
      expect(code).toBe('z.number().gt(0).lt(100)')
    })

    it('compiles inclusive minimum to .gte(n) and maximum to .lte(n)', () => {
      const code = schemaToZod({
        type: 'integer',
        minimum: 1,
        maximum: 10,
      })
      expect(code).toBe('z.int().gte(1).lte(10)')
    })

    it('supports negative and float exclusive boundaries', () => {
      const negativeCode = schemaToZod({
        type: 'integer',
        exclusiveMinimum: -50,
        exclusiveMaximum: 50,
      })
      expect(negativeCode).toBe('z.int().gt(-50).lt(50)')

      const floatCode = schemaToZod({
        type: 'number',
        exclusiveMinimum: 0.001,
        exclusiveMaximum: 99.999,
      })
      expect(floatCode).toBe('z.number().gt(0.001).lt(99.999)')
    })
  })

  describe('Composite Types', () => {
    describe('Object', () => {
      it('generates object with required and optional properties', () => {
        const schema: OasSchema = {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            age: { type: 'integer', minimum: 0 },
          },
        }
        const code = schemaToZod(schema)
        expect(code).toContain('id: z.string().guid()')
        expect(code).toContain('name: z.string().optional()')
        expect(code).toContain('age: z.int().gte(0).optional()')
      })

      it('generates empty object', () => {
        expect(schemaToZod({ type: 'object' })).toBe('z.object({})')
        expect(schemaToZod({ type: 'object', properties: {} })).toBe('z.object({})')
      })

      it('escapes special property keys', () => {
        const schema: OasSchema = {
          type: 'object',
          required: ['user-id'],
          properties: {
            'user-id': { type: 'string' },
            '@context': { type: 'string' },
            '123num': { type: 'number' },
          },
        }
        const code = schemaToZod(schema)
        expect(code).toContain("'user-id': z.string()")
        expect(code).toContain("'@context': z.string().optional()")
        expect(code).toContain("'123num': z.number().optional()")
      })

      it('handles object sealing with additionalProperties: false (.strict())', () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
        }
        expect(schemaToZod(schema)).toBe('z.object({\n  name: z.string().optional(),\n}).strict()')
      })

      it('handles object sealing with unevaluatedProperties: false (.strict())', () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          unevaluatedProperties: false,
        }
        expect(schemaToZod(schema)).toBe('z.object({\n  name: z.string().optional(),\n}).strict()')
      })

      it('handles object sealing with unevaluatedProperties: { not: {} } (.strict())', () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          unevaluatedProperties: { not: {} } as OasSchema,
        }
        expect(schemaToZod(schema)).toBe('z.object({\n  name: z.string().optional(),\n}).strict()')
      })

      it('handles additionalProperties schema (.catchall(...))', () => {
        const schema: OasSchema = {
          type: 'object',
          additionalProperties: { type: 'string' },
        }
        expect(schemaToZod(schema)).toBe('z.object({}).catchall(z.string())')
      })

      it('handles unevaluatedProperties schema (.catchall(...))', () => {
        const schema: OasSchema = {
          type: 'object',
          unevaluatedProperties: { type: 'number' },
        }
        expect(schemaToZod(schema)).toBe('z.object({}).catchall(z.number())')
      })

      it('handles additionalProperties: true (.passthrough())', () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: true,
        }
        expect(schemaToZod(schema)).toBe(
          'z.object({\n  name: z.string().optional(),\n}).passthrough()',
        )
      })

      it('applies strictObjects option when specified', () => {
        const schema: OasSchema = {
          type: 'object',
          properties: { name: { type: 'string' } },
        }
        expect(schemaToZod(schema, { strictObjects: true })).toBe(
          'z.object({\n  name: z.string().optional(),\n}).strict()',
        )
      })
    })

    describe('Array & Tuples', () => {
      it('generates regular homogeneous array', () => {
        expect(schemaToZod({ type: 'array', items: { type: 'string' } })).toBe('z.array(z.string())')
        expect(
          schemaToZod({
            type: 'array',
            items: { type: 'integer' },
            minItems: 1,
            maxItems: 10,
          }),
        ).toBe('z.array(z.int()).min(1).max(10)')
      })

      it('generates array with z.unknown() when items is omitted', () => {
        expect(schemaToZod({ type: 'array' })).toBe('z.array(z.unknown())')
      })

      it('generates tuple from prefixItems (Draft 2020-12)', () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'integer' }],
        }
        expect(schemaToZod(schema)).toBe('z.tuple([z.string(), z.int()])')
      })

      it('generates tuple with rest element when items is schema', () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'integer' }],
          items: { type: 'boolean' },
        }
        expect(schemaToZod(schema)).toBe('z.tuple([z.string(), z.int()]).rest(z.boolean())')
      })

      it('generates tuple with rest(z.unknown()) when items is true', () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: true as unknown as OasSchema,
        }
        expect(schemaToZod(schema)).toBe('z.tuple([z.string()]).rest(z.unknown())')
      })

      it('generates closed tuple when items is false', () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'number' }],
          items: false as unknown as OasSchema,
        }
        expect(schemaToZod(schema)).toBe('z.tuple([z.string(), z.number()])')
      })

      it('applies minItems/maxItems checks on tuples', () => {
        const schema: OasSchema = {
          type: 'array',
          prefixItems: [{ type: 'string' }],
          items: { type: 'number' },
          minItems: 2,
          maxItems: 5,
        }
        expect(schemaToZod(schema)).toBe(
          'z.tuple([z.string()]).rest(z.number()).check(z.minLength(2)).check(z.maxLength(5))',
        )
      })
    })
  })

  describe('Combinator Types', () => {
    it('generates allOf as chained .and()', () => {
      const schema: OasSchema = {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
          { type: 'object', properties: { c: { type: 'boolean' } } },
        ],
      }
      const code = schemaToZod(schema)
      expect(code).toBe(
        'z.object({\n  a: z.string().optional(),\n}).and(z.object({\n  b: z.number().optional(),\n})).and(z.object({\n  c: z.boolean().optional(),\n}))',
      )
    })

    it('generates oneOf without discriminator as z.union', () => {
      const schema: OasSchema = {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      }
      expect(schemaToZod(schema)).toBe('z.union([z.string(), z.number()])')
    })

    it('generates oneOf with discriminator as z.discriminatedUnion', () => {
      const schema: OasSchema = {
        oneOf: [
          { $ref: '#/components/schemas/Cat' },
          { $ref: '#/components/schemas/Dog' },
        ],
        discriminator: {
          propertyName: 'petType',
        },
      }
      expect(schemaToZod(schema)).toBe(
        'z.discriminatedUnion("petType", [z.lazy(() => CatSchema), z.lazy(() => DogSchema)], { unionFallback: true })',
      )
    })

    it('generates oneOf with discriminator and defaultMapping as z.union with fallback', () => {
      const schema: OasSchema = {
        oneOf: [
          { $ref: '#/components/schemas/Cat' },
          { $ref: '#/components/schemas/Dog' },
        ],
        discriminator: {
          propertyName: 'petType',
          defaultMapping: '#/components/schemas/OtherPet',
        },
      }
      expect(schemaToZod(schema)).toBe(
        'z.union([z.discriminatedUnion("petType", [z.lazy(() => CatSchema), z.lazy(() => DogSchema)], { unionFallback: true }), z.lazy(() => \'extend\' in OtherPetSchema ? OtherPetSchema.extend({ petType: z.string().optional() }) : OtherPetSchema)])',
      )
    })

    it('generates anyOf as z.union', () => {
      const schema: OasSchema = {
        anyOf: [{ type: 'string' }, { type: 'integer' }],
      }
      expect(schemaToZod(schema)).toBe('z.union([z.string(), z.int()])')
    })

    it('handles type union with null as .nullable()', () => {
      const schema: OasSchema = {
        type: ['string', 'null'],
      }
      expect(schemaToZod(schema)).toBe('z.string().nullable()')

      const multiSchema: OasSchema = {
        type: ['string', 'integer', 'null'],
      }
      expect(schemaToZod(multiSchema)).toBe('z.union([z.string(), z.int()]).nullable()')
    })

    it('handles multi-type union without null', () => {
      const schema: OasSchema = {
        type: ['string', 'integer'],
      }
      expect(schemaToZod(schema)).toBe('z.union([z.string(), z.int()])')
    })
  })

  describe('References & Circular Graphs', () => {
    it('maps component refs to z.lazy accessors', () => {
      expect(schemaToZod({ $ref: '#/components/schemas/UserProfile' })).toBe(
        'z.lazy(() => UserProfileSchema)',
      )
      expect(schemaToZod({ $ref: '#/components/schemas/user-profile' })).toBe(
        'z.lazy(() => UserProfileSchema)',
      )
    })

    it('respects refNameOverrides option', () => {
      const code = schemaToZod(
        { $ref: '#/components/schemas/CustomUser' },
        { refNameOverrides: { '#/components/schemas/CustomUser': 'CustomSchema' } },
      )
      expect(code).toBe('z.lazy(() => CustomSchema)')
    })

    it('resolves self-referencing circular tree nodes', () => {
      const treeSchema: OasSchema = {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/TreeNode' },
          },
        },
      }
      const code = schemaToZod(treeSchema)
      expect(code).toContain('children: z.array(z.lazy(() => TreeNodeSchema)).optional()')
    })
  })

  describe('Metadata & Default Stripping', () => {
    it('emits .describe() for description', () => {
      expect(schemaToZod({ type: 'string', description: 'User display name' })).toBe(
        'z.string().describe("User display name")',
      )
    })

    it('emits .default() for default values without foldSchema short-circuiting', () => {
      const schema: OasSchema = {
        type: 'string',
        default: 'guest',
      }
      expect(schemaToZod(schema)).toBe('z.string().default("guest")')
    })

    it('chains .default() and .describe() in correct order', () => {
      const schema: OasSchema = {
        type: 'integer',
        minimum: 0,
        default: 10,
        description: 'Page size',
      }
      expect(schemaToZod(schema)).toBe('z.int().gte(0).default(10).describe("Page size")')
    })

    it('handles example non-destructively without short-circuiting', () => {
      const schema: OasSchema = {
        type: 'string',
        format: 'email',
        example: 'test@example.com',
      }
      expect(schemaToZod(schema)).toBe('z.string().email()')
    })

    it('preserves defaults on nested object properties', () => {
      const schema: OasSchema = {
        type: 'object',
        properties: {
          role: { type: 'string', default: 'user' },
          count: { type: 'integer', default: 0 },
        },
      }
      const code = schemaToZod(schema)
      expect(code).toContain('role: z.string().default("user").optional()')
      expect(code).toContain('count: z.int().default(0).optional()')
    })

    it('supports legacy OAS 3.0 nullable: true flag', () => {
      const schema = {
        type: 'string',
        nullable: true,
      } as unknown as OasSchema
      expect(schemaToZod(schema)).toBe('z.string().nullable()')
    })
  })

  describe('generateZodFromSpec', () => {
    it('generates complete TypeScript source file from OpenAPI 3.2 document', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            User: {
              type: 'object',
              required: ['id', 'email'],
              properties: {
                id: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                age: { type: 'integer', minimum: 0 },
              },
            },
            Category: {
              type: 'object',
              required: ['id', 'name'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                subcategories: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Category' },
                },
              },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc)
      expect(tsCode).toContain("import { z } from 'zod'")
      expect(tsCode).toContain('export const UserSchema = z.object({')
      expect(tsCode).toContain('export type User = z.infer<typeof UserSchema>')
      expect(tsCode).toContain('export const CategorySchema = z.object({')
      expect(tsCode).toContain('export type Category = z.infer<typeof CategorySchema>')
      expect(tsCode).toContain('subcategories: z.array(z.lazy(() => CategorySchema)).optional()')
    })

    it('supports style: "schema" to omit type exports', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Status: { type: 'string', enum: ['active', 'inactive'] },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc, { style: 'schema' })
      expect(tsCode).toContain('export const StatusSchema = z.enum(["active", "inactive"])')
      expect(tsCode).not.toContain('export type Status')
    })

    it('supports banner: false to omit header comments', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Simple: { type: 'string' },
          },
        },
      }

      const tsCode = generateZodFromSpec(doc, { banner: false })
      expect(tsCode).not.toContain('// Auto-generated')
      expect(tsCode).toContain("import { z } from 'zod'")
    })
  })

  describe('Runtime Validation Parity Verification', () => {
    it('validates exclusive bounds at runtime with real Zod 4 instance', () => {
      const code = schemaToZod({
        type: 'number',
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
      })
      // Dynamically evaluate generated expression against installed zod
      const schema = new Function('z', `return ${code}`)(z) as z.ZodTypeAny
      expect(schema.safeParse(0).success).toBe(false)
      expect(schema.safeParse(0.0001).success).toBe(true)
      expect(schema.safeParse(50).success).toBe(true)
      expect(schema.safeParse(99.999).success).toBe(true)
      expect(schema.safeParse(100).success).toBe(false)
    })

    it('validates strict object sealing at runtime', () => {
      const code = schemaToZod({
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      })
      const schema = new Function('z', `return ${code}`)(z) as z.ZodTypeAny
      expect(schema.safeParse({ name: 'Alice' }).success).toBe(true)
      expect(schema.safeParse({ name: 'Alice', extra: 123 }).success).toBe(false)
    })

    it('validates tuple with rest at runtime', () => {
      const code = schemaToZod({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'integer' }],
        items: { type: 'boolean' },
      })
      const schema = new Function('z', `return ${code}`)(z) as z.ZodTypeAny
      expect(schema.safeParse(['a', 1]).success).toBe(true)
      expect(schema.safeParse(['a', 1, true, false]).success).toBe(true)
      expect(schema.safeParse(['a', 1, 'bad']).success).toBe(false)
      expect(schema.safeParse([123, 1]).success).toBe(false)
    })

    it('validates recursive tree structure with z.lazy at runtime', () => {
      const code = schemaToZod({
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/TreeNode' },
          },
        },
      })
      const fn = new Function(
        'z',
        `let TreeNodeSchema;\nTreeNodeSchema = ${code};\nreturn TreeNodeSchema;`,
      )
      const TreeNodeSchema = fn(z) as z.ZodTypeAny

      const validTree = {
        id: 'root',
        children: [
          {
            id: 'child-1',
            children: [{ id: 'grandchild-1' }],
          },
          { id: 'child-2' },
        ],
      }
      expect(TreeNodeSchema.safeParse(validTree).success).toBe(true)

      const invalidTree = {
        id: 'root',
        children: [{ id: 123 }],
      }
      expect(TreeNodeSchema.safeParse(invalidTree).success).toBe(false)
    })

    it('validates mutual recursive structures with z.lazy at runtime', () => {
      const userCode = schemaToZod({
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          profile: { $ref: '#/components/schemas/Profile' },
        },
      })
      const profileCode = schemaToZod({
        type: 'object',
        required: ['bio'],
        properties: {
          bio: { type: 'string' },
          user: { $ref: '#/components/schemas/User' },
        },
      })

      const fn = new Function(
        'z',
        `let UserSchema, ProfileSchema;
         UserSchema = ${userCode};
         ProfileSchema = ${profileCode};
         return { UserSchema, ProfileSchema };`,
      )
      const { UserSchema, ProfileSchema } = fn(z) as {
        UserSchema: z.ZodTypeAny
        ProfileSchema: z.ZodTypeAny
      }

      const validMutual = {
        id: 'u-1',
        profile: {
          bio: 'Engineer',
          user: {
            id: 'u-2',
            profile: {
              bio: 'Designer',
            },
          },
        },
      }
      expect(UserSchema.safeParse(validMutual).success).toBe(true)
    })

    it('validates discriminator with mapping at runtime', () => {
      const catSchema = z.object({
        type: z.literal('cat'),
        meow: z.string(),
      })
      const dogSchema = z.object({
        type: z.literal('dog'),
        bark: z.string(),
      })
      const petSchema = z.discriminatedUnion('type', [catSchema, dogSchema], {
        unionFallback: true,
      })

      expect(petSchema.safeParse({ type: 'cat', meow: 'purr' }).success).toBe(true)
      expect(petSchema.safeParse({ type: 'dog', bark: 'woof' }).success).toBe(true)
      expect(petSchema.safeParse({ type: 'bird', chirp: 'tweet' }).success).toBe(false)
    })
  })
})
