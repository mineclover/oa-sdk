import { describe, expect, it } from 'vitest'
import {
  normalizeOasForZodRuntime,
  createDynamicZodValidator,
  createRuntimeZodValidators,
} from './runtime-adapter.js'
import type { OasDocument, OasSchema } from '@oa-sdk/parser'

describe('runtime-adapter', () => {
  describe('normalizeOasForZodRuntime', () => {
    it('returns primitives unchanged', () => {
      expect(normalizeOasForZodRuntime('string')).toBe('string')
      expect(normalizeOasForZodRuntime(42)).toBe(42)
      expect(normalizeOasForZodRuntime(true)).toBe(true)
      expect(normalizeOasForZodRuntime(null)).toBe(null)
      expect(normalizeOasForZodRuntime(undefined)).toBe(undefined)
    })

    it('rewrites #/components/schemas/ and #/schemas/ references to #/$defs/', () => {
      const input = {
        $ref: '#/components/schemas/User',
        items: {
          $ref: '#/schemas/Item',
        },
      }
      const normalized = normalizeOasForZodRuntime(input) as any
      expect(normalized.$ref).toBe('#/$defs/User')
      expect(normalized.items.$ref).toBe('#/$defs/Item')
    })

    it('normalizes unevaluatedProperties: false to additionalProperties: false', () => {
      const input = {
        type: 'object',
        properties: { name: { type: 'string' } },
        unevaluatedProperties: false,
      }
      const normalized = normalizeOasForZodRuntime(input) as any
      expect(normalized.unevaluatedProperties).toBeUndefined()
      expect(normalized.additionalProperties).toBe(false)
    })

    it('normalizes unevaluatedProperties: { not: {} } to additionalProperties: false', () => {
      const input = {
        type: 'object',
        properties: { id: { type: 'integer' } },
        unevaluatedProperties: { not: {} },
      }
      const normalized = normalizeOasForZodRuntime(input) as any
      expect(normalized.unevaluatedProperties).toBeUndefined()
      expect(normalized.additionalProperties).toBe(false)
    })

    it('normalizes legacy nullable: true to Draft 2020-12 type union', () => {
      const input = {
        type: 'string',
        nullable: true,
      }
      const normalized = normalizeOasForZodRuntime(input) as any
      expect(normalized.type).toEqual(['string', 'null'])
    })

    it('handles cyclic JavaScript object references safely', () => {
      const cyclicObj: any = {
        type: 'object',
        properties: {},
      }
      cyclicObj.properties.self = cyclicObj
      expect(() => normalizeOasForZodRuntime(cyclicObj)).not.toThrow()
    })
  })

  describe('createDynamicZodValidator', () => {
    it('validates standalone primitive schemas', () => {
      const schema: OasSchema = {
        type: 'number',
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
      }
      const validator = createDynamicZodValidator(schema)
      expect(validator.safeParse(50).success).toBe(true)
      expect(validator.safeParse(0).success).toBe(false)
      expect(validator.safeParse(100).success).toBe(false)
    })

    it('validates sealed objects rejecting undeclared keys', () => {
      const schema: OasSchema = {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string' },
        },
        unevaluatedProperties: false,
      }
      const validator = createDynamicZodValidator(schema)
      expect(validator.safeParse({ title: 'Hello' }).success).toBe(true)
      expect(validator.safeParse({ title: 'Hello', extra: 123 }).success).toBe(false)
    })

    it('resolves intra-spec references when doc is provided', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          schemas: {
            Address: {
              type: 'object',
              required: ['city'],
              properties: {
                city: { type: 'string' },
              },
            },
          },
        },
      }
      const userSchema: OasSchema = {
        type: 'object',
        required: ['address'],
        properties: {
          address: { $ref: '#/components/schemas/Address' },
        },
      }
      const validator = createDynamicZodValidator(userSchema, doc)
      expect(validator.safeParse({ address: { city: 'Seoul' } }).success).toBe(true)
      expect(validator.safeParse({ address: { notCity: 'Seoul' } }).success).toBe(false)
    })

    it('returns structured ZodError on parse failure', () => {
      const schema: OasSchema = {
        type: 'string',
        pattern: '^[a-z]+$',
      }
      const validator = createDynamicZodValidator(schema)
      const res = validator.safeParse('12345')
      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.error.issues.length).toBeGreaterThan(0)
      }
    })
  })

  describe('createRuntimeZodValidators', () => {
    it('creates validator dictionary for all components.schemas', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'API', version: '1.0.0' },
        components: {
          schemas: {
            Tag: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
            Post: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                tag: { $ref: '#/components/schemas/Tag' },
              },
            },
          },
        },
      }
      const validators = createRuntimeZodValidators(doc)
      expect(validators.Tag).toBeDefined()
      expect(validators.Post).toBeDefined()
      expect(validators.Tag!.safeParse({ id: 'tag-1' }).success).toBe(true)
      expect(validators.Post!.safeParse({ title: 'My Post', tag: { id: 't1' } }).success).toBe(true)
    })

    it('resolves self-referential tree schemas', () => {
      const doc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Tree', version: '1.0.0' },
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }
      const validators = createRuntimeZodValidators(doc)
      const TreeNode = validators.TreeNode
      const validTree = {
        name: 'root',
        children: [
          { name: 'child1', children: [] },
          { name: 'child2', children: [{ name: 'leaf' }] },
        ],
      }
      expect(TreeNode!.safeParse(validTree).success).toBe(true)
      expect(TreeNode!.safeParse({ name: 'root', children: [{ name: 123 }] }).success).toBe(false)
    })
  })
})
