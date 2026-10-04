import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createJsonSchemaValidator,
  normalizeJsonSchema,
  validateToolInput,
} from '../src/index.js'

describe('@oa-sdk/tools schema contract validation', () => {
  it('keeps JSON Schema constraints during normalization', () => {
    const schema = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['fast', 'safe'], minLength: 4 },
        id: { type: 'string', format: 'uuid', pattern: '^[0-9a-f-]+$' },
        count: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['mode', 'id'],
      oneOf: [{ required: ['count'] }, { required: ['id'] }],
      allOf: [{ additionalProperties: false }],
    }

    const normalized = normalizeJsonSchema(schema)
    expect(normalized.properties?.mode).toMatchObject({ enum: ['fast', 'safe'], minLength: 4 })
    expect(normalized.properties?.id).toMatchObject({ format: 'uuid', pattern: '^[0-9a-f-]+$' })
    expect(normalized.properties?.count).toMatchObject({ minimum: 1, maximum: 5 })
    expect(normalized.oneOf).toEqual(schema.oneOf)
    expect(normalized.allOf).toEqual(schema.allOf)
  })

  it('validates enum, format, pattern, length, ranges, and composition', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'email', 'count', 'token'],
      properties: {
        mode: { type: 'string', enum: ['fast', 'safe'] },
        email: { type: 'string', format: 'email' },
        count: { type: 'integer', minimum: 1, maximum: 5 },
        token: { type: 'string', minLength: 3, maxLength: 8, pattern: '^tok_[a-z]+$' },
      },
      allOf: [{ required: ['mode'] }],
      oneOf: [{ properties: { mode: { const: 'fast' } } }, { properties: { mode: { const: 'safe' } } }],
    }

    expect(validateToolInput(schema, {
      mode: 'fast', email: 'user@example.com', count: 3, token: 'tok_abc',
    }).success).toBe(true)

    expect(validateToolInput(schema, {
      mode: 'slow', email: 'user@example.com', count: 3, token: 'tok_abc',
    }).success).toBe(false)
    expect(validateToolInput(schema, {
      mode: 'fast', email: 'invalid', count: 3, token: 'tok_abc',
    }).success).toBe(false)
    expect(validateToolInput(schema, {
      mode: 'fast', email: 'user@example.com', count: 7, token: 'tok_abc',
    }).success).toBe(false)
    expect(validateToolInput(schema, {
      mode: 'fast', email: 'user@example.com', count: 3, token: 'bad',
    }).success).toBe(false)
  })

  it('resolves local component refs and supports validator compilation caching', () => {
    const schema = {
      type: 'object',
      properties: { user: { $ref: '#/components/schemas/User' } },
      required: ['user'],
    }
    const components = {
      User: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', minLength: 2 } },
        required: ['id'],
      },
    }

    const validator = createJsonSchemaValidator(schema, components)
    expect(createJsonSchemaValidator(schema, components)).toBe(validator)
    expect(validator.validate({ user: { id: 'u1' } }).success).toBe(true)
    expect(validator.validate({ user: { id: '' } }).success).toBe(false)
    expect(validator.validate({ user: { id: 'u1', extra: true } }).success).toBe(false)

    const recursive = {
      type: 'object',
      properties: { node: { $ref: '#/components/schemas/Node' } },
      required: ['node'],
    }
    const recursiveValidator = createJsonSchemaValidator(recursive, {
      Node: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } },
        required: ['name'],
      },
    })
    expect(recursiveValidator.validate({ node: { name: 'root', child: { name: 'leaf' } } }).success).toBe(true)
    expect(recursiveValidator.validate({ node: { name: 'root', child: {} } }).success).toBe(false)
  })

  it('uses custom safeParse and parse contracts without treating them as JSON Schema', () => {
    const safeSchema = {
      safeParse(value: unknown) {
        return typeof value === 'string'
          ? { success: true, data: value.toUpperCase() }
          : { success: false, error: new Error('expected string') }
      },
    }
    expect(validateToolInput(safeSchema, 'ok')).toEqual({ success: true, data: 'OK' })
    expect(validateToolInput(safeSchema, 1)).toEqual({ success: false, error: 'expected string' })

    const parseSchema = {
      parse(value: unknown) {
        if (typeof value !== 'number') throw new Error('expected number')
        return value * 2
      },
    }
    expect(validateToolInput(parseSchema, 2)).toEqual({ success: true, data: 4 })
    expect(validateToolInput(parseSchema, '2')).toEqual({ success: false, error: 'expected number' })
  })

  it('fails explicitly when a Zod-like schema has no lossless JSON Schema conversion', () => {
    const legacy = {
      _def: { shape: {} },
      safeParse: () => ({ success: true, data: {} }),
    }
    expect(() => normalizeJsonSchema(legacy)).toThrow(/without losing constraints/)
    expect(validateToolInput(legacy, { ok: true }).success).toBe(true)
  })

  it('keeps Zod constraints in its generated JSON Schema', () => {
    const schema = z.object({
      state: z.enum(['queued', 'done']),
      label: z.string().min(2).max(6).regex(/^x/),
      ratio: z.number().min(0).max(1),
    })
    const normalized = normalizeJsonSchema(schema)
    expect(normalized.properties?.state?.enum).toEqual(['queued', 'done'])
    expect(normalized.properties?.label).toMatchObject({ minLength: 2, maxLength: 6, pattern: '^x' })
    expect(normalized.properties?.ratio).toMatchObject({ minimum: 0, maximum: 1 })
    expect(validateToolInput(schema, { state: 'queued', label: 'xabc', ratio: 0.5 }).success).toBe(true)
    expect(validateToolInput(schema, { state: 'other', label: 'xabc', ratio: 0.5 }).success).toBe(false)
  })
})
