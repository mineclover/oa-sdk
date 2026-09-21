#!/usr/bin/env tsx
/**
 * OA SDK 순수 핸들러 계약 및 라우터 마운트 데모 (Hono / Node HTTP)
 *
 * 실행: pnpm --filter @oa-sdk/playground run demo:router
 */

import { Hono } from 'hono'
import { createServer } from 'node:http'

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('🔌 OA SDK 프레임워크 무의존 핸들러 계약 & 라우터 연동 데모')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// =========================================================================
// 1. 프레임워크 무의존 순수 핸들러 계약 타입 정의 (*.contract.ts 패턴)
// =========================================================================
interface HandlerResponse<TStatus extends number, TBody> {
  status: TStatus
  body: TBody
  headers?: Record<string, string>
}

interface UserDto {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
}

interface ProblemDetails {
  type: string
  title: string
  status: number
  detail?: string
}

// 오퍼레이션 계약 정의: 성공(200), 검증실패(422), 미존재(404)
type GetUserResult =
  | HandlerResponse<200, UserDto>
  | HandlerResponse<404, ProblemDetails>

type CreateUserResult =
  | HandlerResponse<201, UserDto>
  | HandlerResponse<422, ProblemDetails>

// 순수 비즈니스 핸들러 계약 인터페이스 (Express, Fastify, Hono, Bun 어디서나 사용 가능)
interface UsersContractHandlers {
  getUser(params: { id: string }): Promise<GetUserResult>
  createUser(payload: { email: string; name: string }): Promise<CreateUserResult>
}

// =========================================================================
// 2. 비즈니스 로직 구현체 (Express/Hono 등 웹 프레임워크 의존성 0%)
// =========================================================================
const inMemoryUsers: Map<string, UserDto> = new Map([
  ['usr_001', { id: 'usr_001', email: 'alice@oa-sdk.dev', name: 'Alice', role: 'admin' }],
])

const usersService: UsersContractHandlers = {
  async getUser({ id }): Promise<GetUserResult> {
    const user = inMemoryUsers.get(id)
    if (!user) {
      return {
        status: 404,
        body: {
          type: 'https://api.oa-sdk.dev/errors/not-found',
          title: 'User Not Found',
          status: 404,
          detail: `User with id ${id} does not exist`,
        },
      }
    }
    return { status: 200, body: user }
  },

  async createUser({ email, name }): Promise<CreateUserResult> {
    if (!email.includes('@')) {
      return {
        status: 422,
        body: {
          type: 'https://api.oa-sdk.dev/errors/validation',
          title: 'Invalid Email',
          status: 422,
          detail: 'Email must contain @ symbol',
        },
      }
    }

    const newUser: UserDto = {
      id: `usr_${Date.now()}`,
      email,
      name,
      role: 'member',
    }
    inMemoryUsers.set(newUser.id, newUser)
    return { status: 201, body: newUser }
  },
}

// =========================================================================
// 3. Hono 라우터에 자동 바인딩 (Framework Adapter Layer)
// =========================================================================
console.log('🚀 1단계: 순수 계약 핸들러를 Hono 라우터에 바인딩 중...')
const app = new Hono()

// 바인딩 어댑터: 순수 핸들러 결과를 Hono 응답으로 변환
app.get('/api/users/:id', async (c) => {
  const result = await usersService.getUser({ id: c.req.param('id') })
  return c.json(result.body, result.status as any)
})

app.post('/api/users', async (c) => {
  const body = await c.req.json()
  const result = await usersService.createUser(body)
  return c.json(result.body, result.status as any)
})

// =========================================================================
// 4. 인메모리 HTTP 서버 구동 및 E2E 테스트 검증
// =========================================================================
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }

  let bodyText = ''
  for await (const chunk of req) {
    bodyText += chunk
  }

  const response = await app.fetch(
    new Request(url.href, {
      method: req.method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(req.method || '') ? bodyText : undefined,
    }),
  )

  res.statusCode = response.status
  response.headers.forEach((val, key) => res.setHeader(key, val))
  res.end(await response.text())
})

await new Promise<void>((resolve) => server.listen(0, resolve))
const port = (server.address() as any).port
const baseUrl = `http://localhost:${port}`

console.log(`   ✓ Hono 서버 기동 완료 (${baseUrl})\n`)

// Client 호출 테스트
console.log('━━━ [Test 1] 기존 사용자 조회 (200 OK) ━━━')
const res1 = await fetch(`${baseUrl}/api/users/usr_001`)
const body1 = await res1.json()
console.log(`Status: ${res1.status}, User Name: ${body1.name}, Role: ${body1.role}`)

console.log('\n━━━ [Test 2] 존재하지 않는 사용자 조회 (404 Not Found) ━━━')
const res2 = await fetch(`${baseUrl}/api/users/usr_unknown`)
const body2 = await res2.json()
console.log(`Status: ${res2.status}, Error Title: ${body2.title}, Detail: ${body2.detail}`)

console.log('\n━━━ [Test 3] 신규 사용자 생성 (201 Created) ━━━')
const res3 = await fetch(`${baseUrl}/api/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'bob@oa-sdk.dev', name: 'Bob' }),
})
const body3 = await res3.json()
console.log(`Status: ${res3.status}, Generated ID: ${body3.id}, Name: ${body3.name}`)

console.log('\n━━━ [Test 4] 유효하지 않은 이메일 생성 시도 (422 Unprocessable) ━━━')
const res4 = await fetch(`${baseUrl}/api/users`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'bad-email-without-at', name: 'Bad' }),
})
const body4 = await res4.json()
console.log(`Status: ${res4.status}, Error Type: ${body4.type}, Detail: ${body4.detail}`)

server.close()
console.log('\n✨ 순수 핸들러 계약 및 라우터 연동 데모가 성공적으로 완료되었습니다.')
