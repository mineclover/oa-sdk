/**
 * Codegen 통합 테스트
 *
 * zodToSchema 변환 결과가 mock-server의 AJV 검증 엔진과 호환되는지
 * 실제 mock 서버를 기동하여 end-to-end로 검증합니다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { zodToSchema } from '@oa-sdk/codegen'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import type { NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'

// 테스트 대상 Zod 스키마
const UserSchema = z.object({
  id: z.string().uuid().describe('사용자 고유 식별자'),
  name: z.string().min(1).max(100).describe('표시 이름'),
  email: z.string().email().describe('이메일 주소'),
  age: z.number().int().min(0).max(150).optional().describe('나이'),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
  tags: z.array(z.string()).optional(),
  address: z.object({
    city: z.string(),
    country: z.string().length(2),
  }).optional(),
})

const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  role: z.enum(['admin', 'user', 'guest']).default('user'),
})

// Zod 스키마로부터 OpenAPI 스펙을 동적으로 생성
const userOasSchema = zodToSchema(UserSchema)
const createUserOasSchema = zodToSchema(CreateUserSchema)

const spec = {
  openapi: '3.1.0',
  info: { title: 'Codegen Integration Test', version: '1.0.0' },
  components: {
    schemas: {
      User: userOasSchema,
      CreateUserRequest: createUserOasSchema,
    },
  },
  paths: {
    '/users': {
      post: {
        operationId: 'createUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateUserRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
                examples: {
                  default: {
                    value: {
                      id: '123e4567-e89b-12d3-a456-426614174000',
                      name: 'Alice',
                      email: 'alice@example.com',
                      role: 'user',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

let server: NodeMockServer

beforeAll(async () => {
  server = createNodeMockServer(spec as unknown as Parameters<typeof createNodeMockServer>[0], { port: 0 })
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

describe('zodToSchema → OasSchema 변환 검증', () => {
  it('User 스키마가 올바른 OAS 구조를 생성', () => {
    expect(userOasSchema.type).toBe('object')
    expect(userOasSchema.properties?.id).toMatchObject({ type: 'string', format: 'uuid' })
    expect(userOasSchema.properties?.name).toMatchObject({ type: 'string', minLength: 1, maxLength: 100 })
    expect(userOasSchema.properties?.email).toMatchObject({ type: 'string', format: 'email' })
    expect(userOasSchema.properties?.age).toMatchObject({ type: 'integer', minimum: 0, maximum: 150 })
    expect(userOasSchema.properties?.role).toMatchObject({ type: 'string', enum: ['admin', 'user', 'guest'], default: 'user' })
  })

  it('required 필드가 올바르게 추출됨 (optional, default 제외)', () => {
    // age는 optional, role은 default → required에서 제외
    expect(userOasSchema.required).toContain('id')
    expect(userOasSchema.required).toContain('name')
    expect(userOasSchema.required).toContain('email')
    expect(userOasSchema.required).not.toContain('age')
    expect(userOasSchema.required).not.toContain('role')
    expect(userOasSchema.required).not.toContain('tags')
    expect(userOasSchema.required).not.toContain('address')
  })

  it('배열 타입 변환', () => {
    expect(userOasSchema.properties?.tags).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('중첩 객체 변환', () => {
    const address = userOasSchema.properties?.address
    expect(address?.type).toBe('object')
    expect(address?.properties?.country).toMatchObject({ type: 'string', minLength: 2, maxLength: 2 })
  })

  it('description이 전달됨', () => {
    expect(userOasSchema.properties?.id?.description).toBe('사용자 고유 식별자')
  })
})

describe('Codegen → Mock Server end-to-end', () => {
  it('zodToSchema로 생성한 스키마로 유효한 요청 검증', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
    })
    expect(res.status).toBe(201)
  })

  it('email 형식 위반 → AJV가 422 반환', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', email: 'not-an-email' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: { details: Array<{ code: string }> } }
    expect(body.error.details.some(d => d.code === 'FORMAT_MISMATCH')).toBe(true)
  })

  it('name minLength 위반 → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'alice@example.com' }),
    })
    expect(res.status).toBe(422)
  })

  it('required 필드 누락 → 422', async () => {
    const res = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: { details: Array<{ code: string }> } }
    expect(body.error.details.some(d => d.code === 'MISSING_REQUIRED_FIELD')).toBe(true)
  })
})
