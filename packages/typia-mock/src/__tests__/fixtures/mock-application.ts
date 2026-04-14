/**
 * Mock ILlmApplication 객체 — typia AOT 없이 테스트 가능.
 * typia.llm.application<T>()가 생성하는 것과 동일한 구조를 수동 구성한다.
 */

import type { ILlmApplication, ILlmFunction } from '../../types.js'

// ─── createUser ─────────────────────────────────────────────────────────────
// createUser(input: { email: string (email format), name: string (minLength 1), age?: integer (minimum 0) })

export function createMockUserFunction(): ILlmFunction {
  return {
    name: 'createUser',
    description: 'Create a new user',
    parameters: {
      type: 'object',
      required: ['email', 'name'],
      properties: {
        email: { type: 'string', format: 'email' },
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    output: {
      type: 'object',
      required: ['id', 'email', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
      },
    },

    parse(input: string) {
      try {
        const data = JSON.parse(input) as unknown
        return { success: true as const, data }
      } catch {
        return { success: false as const, errors: [{ message: 'Invalid JSON' }] }
      }
    },

    coerce(input: unknown) {
      if (typeof input !== 'object' || input === null) return input
      const obj = { ...(input as Record<string, unknown>) }
      if (typeof obj['age'] === 'string') {
        const n = Number(obj['age'])
        if (!Number.isNaN(n)) obj['age'] = n
      }
      return obj
    },

    validate(input: unknown) {
      const errors: Array<{ path: string; expected: string; value: unknown }> = []
      if (typeof input !== 'object' || input === null) {
        return { success: false as const, data: input, errors: [{ path: '$input', expected: 'object', value: input }] }
      }
      const obj = input as Record<string, unknown>

      if (typeof obj['email'] !== 'string') {
        errors.push({ path: '$input.email', expected: 'string', value: obj['email'] })
      } else if (!obj['email'].includes('@')) {
        errors.push({ path: '$input.email', expected: 'string & Format<"email">', value: obj['email'] })
      }

      if (typeof obj['name'] !== 'string') {
        errors.push({ path: '$input.name', expected: 'string', value: obj['name'] })
      } else if (obj['name'].length === 0) {
        errors.push({ path: '$input.name', expected: 'string & MinLength<1>', value: obj['name'] })
      }

      if (obj['age'] !== undefined) {
        if (typeof obj['age'] !== 'number') {
          errors.push({ path: '$input.age', expected: 'integer & Minimum<0>', value: obj['age'] })
        } else if (!Number.isInteger(obj['age'])) {
          errors.push({ path: '$input.age', expected: 'integer', value: obj['age'] })
        } else if (obj['age'] < 0) {
          errors.push({ path: '$input.age', expected: 'integer & Minimum<0>', value: obj['age'] })
        }
      }

      if (errors.length > 0) return { success: false as const, data: input, errors }
      return { success: true as const, data: input }
    },
  }
}

// ─── getUsers ───────────────────────────────────────────────────────────────
// getUsers(input: { limit?: integer (1~100), offset?: integer (minimum 0) })

export function createMockGetUsersFunction(): ILlmFunction {
  return {
    name: 'getUsers',
    description: 'List users with pagination',
    parameters: {
      type: 'object',
      required: [],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    output: {
      type: 'object',
      properties: {
        users: { type: 'array', items: { type: 'object' } },
        total: { type: 'integer' },
      },
    },

    parse(input: string) {
      try {
        return { success: true as const, data: JSON.parse(input) as unknown }
      } catch {
        return { success: false as const, errors: [{ message: 'Invalid JSON' }] }
      }
    },

    coerce(input: unknown) {
      if (typeof input !== 'object' || input === null) return input
      const obj = { ...(input as Record<string, unknown>) }
      for (const key of ['limit', 'offset'] as const) {
        if (typeof obj[key] === 'string') {
          const n = Number(obj[key])
          if (!Number.isNaN(n)) obj[key] = n
        }
      }
      return obj
    },

    validate(input: unknown) {
      const errors: Array<{ path: string; expected: string; value: unknown }> = []
      if (typeof input !== 'object' || input === null) {
        return { success: false as const, data: input, errors: [{ path: '$input', expected: 'object', value: input }] }
      }
      const obj = input as Record<string, unknown>

      if (obj['limit'] !== undefined) {
        if (typeof obj['limit'] !== 'number' || !Number.isInteger(obj['limit'])) {
          errors.push({ path: '$input.limit', expected: 'integer & Minimum<1> & Maximum<100>', value: obj['limit'] })
        } else if (obj['limit'] < 1 || obj['limit'] > 100) {
          errors.push({ path: '$input.limit', expected: 'integer & Minimum<1> & Maximum<100>', value: obj['limit'] })
        }
      }

      if (obj['offset'] !== undefined) {
        if (typeof obj['offset'] !== 'number' || !Number.isInteger(obj['offset'])) {
          errors.push({ path: '$input.offset', expected: 'integer & Minimum<0>', value: obj['offset'] })
        } else if (obj['offset'] < 0) {
          errors.push({ path: '$input.offset', expected: 'integer & Minimum<0>', value: obj['offset'] })
        }
      }

      if (errors.length > 0) return { success: false as const, data: input, errors }
      return { success: true as const, data: input }
    },
  }
}

// ─── 함수 없이 — parse/coerce/validate 가 없는 minimal function ────────────

export function createMinimalFunction(): ILlmFunction {
  return {
    name: 'minimal',
    description: 'Minimal function with no pipeline methods',
    parameters: { type: 'object', properties: {} },
  }
}

// ─── Application factory ───────────────────────────────────────────────────

export function createMockApplication(): ILlmApplication {
  return {
    model: 'test',
    functions: [createMockUserFunction(), createMockGetUsersFunction(), createMinimalFunction()],
  }
}
