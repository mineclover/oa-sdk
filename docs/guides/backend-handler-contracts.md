# 백엔드 핸들러 계약 구현 가이드 (Backend Handler Contracts)

API 계약에서 만든 핸들러 계약(handler contract)에 맞춰 비즈니스 로직을 구현하고, Fastify·Hono·Express·Elysia 라우터에 연결하는 방법을 설명합니다. 이 문서는 `@oa-sdk/codegen` 0.9.0과 `@oa-sdk/router` 0.2.2 기준입니다.

- `oa-gen generate`는 서버 쪽에 프레임워크와 무관한 핸들러 계약(`<id>.contract.ts`)만 생성합니다. Fastify·Express·Hono·Elysia 라우터 코드가 필요하면 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`를 호출해 파일로 씁니다. `oa-gen` 명령으로는 라우터 파일을 만들지 않습니다.
- 생성기는 구현 파일을 쓰지 않으므로, 계약과 라우터를 다시 생성해도 구현 코드는 그대로입니다.

---

## 1. 구조

```
┌──────────────────────────────────────┐
│ 1. 핸들러 계약 (api.contract.ts)       │ ◄── generateHandlerContract() 또는 oa-gen generate
│    ApiHandlers, <Op>Context,          │     (생성물, 직접 수정하지 않음)
│    HandlerResponse                     │
└──────────────────┬───────────────────┘
                   │ 구현
┌──────────────────▼───────────────────┐
│ 2. 구현 (handlers.ts)                  │ ◄── 사용자가 작성 (생성기가 건드리지 않음)
└──────────────────┬───────────────────┘
                   │ 연결
┌──────────────────▼───────────────────┐
│ 3. 라우터 (api.hono.ts 등)              │ ◄── generateRouter() 스크립트 (생성물)
│    createRouter(handlers) / apiRouter  │
└──────────────────────────────────────┘
```

---

## 2. 설치

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/router
npm install hono   # 또는 fastify, express, elysia: 생성된 라우터가 import하는 프레임워크
```

`@oa-sdk/router`는 `oa-gen generate`가 핸들러 계약을 만들 때 불러오는 동반 패키지(companion package)이고, 빌드 스크립트에서 직접 import하는 라이브러리입니다([동반 패키지](./cli-setup.md#동반-패키지-companion-packages)). `@oa-sdk/router`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.

---

## 3. 계약과 라우터 생성

### 3.1 빌드 스크립트로 생성 (권장)

타입 있는 계약과 라우터를 함께 만듭니다. 먼저 `oa-gen typegen`으로 타입 파일을 만들고, 스크립트에서 `generateHandlerContract()`와 `generateRouter()`를 호출합니다.

```bash
npx oa-gen typegen --spec ./openapi.yaml -o src/types.ts
node scripts/gen-router.mjs
```

```javascript
// scripts/gen-router.mjs (프로젝트 루트에서 실행)
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'
import { generateHandlerContract, generateRouter } from '@oa-sdk/router'

const spec = parse(readFileSync('openapi.yaml', 'utf8'))

writeFileSync('src/api.contract.ts', generateHandlerContract(spec, { typesImport: './types.js' }))
writeFileSync(
  'src/api.hono.ts', // target: 'fastify' | 'express' | 'elysia'도 같은 방식
  generateRouter(spec, { target: 'hono', contractImport: './api.contract.js', typesImport: './types.js' }),
)
```

- 스크립트는 YAML을 읽으려고 `yaml` 패키지를 씁니다(`npm install --save-dev yaml`). JSON 문서라면 `JSON.parse`로 충분합니다.
- `contractImport`를 주면 라우터가 계약의 `ApiHandlers` 타입에 묶입니다(`mode: 'contract'`). 옵션 전체는 [`@oa-sdk/router` README](../../packages/router/README.md)를 봅니다.

생성되는 계약은 다음과 같습니다(일부). `HandlerResponse`, `StreamingBody`, `StreamingResponse` 타입은 계약 파일 안에 정의되므로 `@oa-sdk/router`를 런타임에 import하지 않습니다.

```typescript
// src/api.contract.ts (생성물)
export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
| TSuccess
| { status: 200; body: TSuccess; headers?: THeaders }
| { status: 206; body: StreamingBody | TSuccess; headers?: THeaders }
| StreamingResponse<THeaders>
| { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]

/** Context for GET /users/{userId} */
export interface GetUserByIdContext<TContext = unknown> {
  params: GetUserByIdPathParams
  context?: TContext
}

/** Handler signature for GET /users/{userId} */
export type GetUserByIdHandler<TContext = unknown> = (
  ctx: GetUserByIdContext<TContext>
) => HandlerResponse<GetUserByIdResponse> | Promise<HandlerResponse<GetUserByIdResponse>>

export interface ApiHandlers<TContext = unknown> {
  listUsers: ListUsersHandler<TContext>
  createUser: CreateUserHandler<TContext>
  getUserById: GetUserByIdHandler<TContext>
  updateUser: UpdateUserHandler<TContext>
  streamAuditEvents: StreamAuditEventsHandler<TContext>
}
```

`<Op>Context`에는 operation에 있는 항목만 들어갑니다(`params`, `query`, `querystring`, `headers`, `body`, 그리고 라우터가 주입하는 `context`).

### 3.2 `oa-gen generate`로 생성

`oa.config.ts`를 쓰는 프로젝트에서는 `oa-gen generate`가 spec target마다 `<id>.contract.ts`를 씁니다. 위치는 `outputRouting`이 있으면 그 패턴(`oa-gen init` 기본값은 `src/api/<id>/<id>.contract.ts`), 없으면 `core.contracts.outDir` 또는 spec target의 `outDir`입니다.

이 경로의 계약은 타입이 없습니다. `oa-gen generate`는 계약에 타입 import를 넘기지 않으므로 `params: Record<string, string>`, `body: unknown`, `HandlerResponse<unknown>`이 됩니다. 요청·응답 타입이 필요하면 3.1절의 스크립트를 씁니다. 같은 프로젝트에서 계약이 두 벌 생기지 않도록, 스크립트를 쓸 때는 `oa.config.ts`의 `core.contracts.pureHandlers`를 `false`로 둡니다.

---

## 4. 핸들러 구현

`ApiHandlers`를 구현하는 객체를 작성합니다. 이 파일은 생성기가 덮어쓰지 않습니다.

```typescript
// src/handlers.ts
import type { ApiHandlers } from './api.contract.js'
import type { User } from './types.js'

const users = new Map<string, User>()

export const handlers: ApiHandlers = {
  async listUsers(ctx) {
    const limit = Number(ctx?.query?.limit ?? 20) // Hono·Express·Elysia에서는 문자열 "5"로 들어옴(5절 끝)
    const items = [...users.values()].slice(0, limit)
    return { status: 200, body: { items }, headers: { 'X-Total-Count': users.size } }
  },
  async createUser({ body }) {
    const user: User = { id: crypto.randomUUID(), name: body.name, status: 'active' }
    users.set(user.id, user)
    return user // 본문만 반환하면 operation의 기본 성공 상태(여기서는 201)로 응답
  },
  async getUserById({ params }) {
    const user = users.get(params.userId)
    if (!user) return { status: 404, body: { code: 'USER_NOT_FOUND', message: `User ${params.userId} not found` } }
    return user
  },
  async updateUser({ params, body }) {
    const user = users.get(params.userId)
    if (!user) return { status: 404, body: { code: 'USER_NOT_FOUND', message: 'not found' } }
    const updated: User = { ...user, ...body }
    users.set(user.id, updated)
    return { status: 200, body: updated }
  },
  async streamAuditEvents() {
    async function* events() {
      yield 'data: {"level":"info","message":"started"}\n\n'
    }
    return { status: 200, body: events(), headers: { 'Content-Type': 'text/event-stream' } }
  },
}
```

타입 검사가 보장하는 범위는 다음과 같습니다.

- 요청: `params`, `query`, `headers`, `body`는 typegen 타입입니다(3.1절 계약). 이 타입은 스펙을 옮긴 것이고, 라우터가 값을 그 타입으로 바꿔 주지는 않습니다. Hono·Express·Elysia에서는 경로·쿼리·헤더 값이 문자열이고, 네 라우터 모두 헤더 이름이 소문자입니다([5절 끝](#생성된-라우터가-하지-않는-일)).
- 성공 응답: 본문을 그대로 반환하거나 `{ status: 200, body }`로 감쌀 때 본문이 응답 타입과 맞아야 합니다.
- 오류 응답: 상태 코드와 본문은 좁혀지지 않습니다. 계약의 오류 맵이 `Record<number, unknown>`이라 `{ status: <숫자>, body: <아무 값> }`이 모두 컴파일됩니다. 스펙에 선언한 오류 응답과 맞추는 것은 구현자의 책임입니다.
- 라우터의 `createRouter(handlers)`와 Fastify `apiRouter`의 `handlers` 옵션은 모든 operation을 구현한 `ApiHandlers`를 요구합니다. 서비스를 나눠 작성했다면 `{ ...userHandlers, ...auditHandlers } satisfies ApiHandlers`처럼 하나의 객체로 합쳐 넘깁니다.

---

## 5. 라우터 연결

생성된 라우터의 export 이름은 프레임워크마다 다릅니다.

### Hono

`createRouter(handlers)`가 `Hono` 인스턴스를 반환하므로 서브 라우트로 마운트하거나 그대로 export합니다.

```typescript
import { Hono } from 'hono'
import { createRouter } from './api.hono.js'
import { handlers } from './handlers.js'

const app = new Hono()
app.route('/v1', createRouter(handlers))

export default app
```

### Fastify

`apiRouter`(`FastifyPluginAsync`, default export도 같음)를 `handlers` 옵션과 함께 등록합니다. Fastify 라우터는 route마다 `schema`(querystring, params, body, response)를 포함하므로 Fastify가 그 스키마로 요청을 검증하고 응답을 직렬화합니다.

```typescript
import Fastify from 'fastify'
import { apiRouter } from './api.fastify.js'
import { handlers } from './handlers.js'

const app = Fastify()
await app.register(apiRouter, { handlers })
await app.listen({ port: 3000 })
```

### Express

`createRouter(handlers)`가 `express.Router`를 반환합니다. 요청 본문을 읽으려면 `express.json()`을 먼저 마운트합니다.

```typescript
import express from 'express'
import { createRouter } from './api.express.js'
import { handlers } from './handlers.js'

const app = express()
app.use(express.json())
app.use('/api', createRouter(handlers))
app.listen(3000)
```

### Elysia

`createRouter(handlers)`가 `Elysia` 인스턴스를 반환하므로 `.use()`로 합성합니다.

```typescript
import { Elysia } from 'elysia'
import { createRouter } from './api.elysia.js'
import { handlers } from './handlers.js'

const app = new Elysia().use(createRouter(handlers)).listen(3000)
```

### 생성된 라우터가 하지 않는 일

- 인증: 보안 요구사항은 route 위의 주석(`// Requires: bearerAuth`)으로만 남습니다. 인증 미들웨어는 프레임워크 쪽에서 직접 붙입니다.
- 요청 검증과 값 변환: Hono·Express·Elysia 라우터는 요청을 스키마로 검증하지 않고, 프레임워크가 준 경로·쿼리·헤더 값을 `as any`로 그대로 핸들러에 넘깁니다. 계약 타입이 `number`·`boolean`이어도 값은 문자열입니다. `?limit=5`는 `"5"`, `?notify=false`는 `"false"`로 들어오고, 문자열 `"false"`는 조건문에서 참입니다. Fastify 라우터는 route `schema`(querystring, params, body, response)로 요청을 검증하고 경로·쿼리 값을 스키마 타입(`5`, `false`)으로 바꿉니다.
- 헤더 이름: 네 라우터 모두 프레임워크의 요청 헤더 객체를 그대로 넘기므로 키가 소문자입니다. 계약은 스펙의 이름(`'X-Audit-Reason'`)으로 타입을 붙이지만 값은 `'x-audit-reason'` 키에 있습니다. Fastify route `schema`에도 헤더는 들어가지 않으므로 헤더 값은 Fastify에서도 문자열 그대로입니다.
- 오류 메시지 숨김: 핸들러가 예외를 던지면 500 `{ "error": { "code": "INTERNAL_ERROR", "message": <예외 메시지>, "details": [] } }`로 답합니다. 내부 메시지를 노출하지 않으려면 핸들러 안에서 오류를 처리해 응답으로 반환합니다.

Hono·Express·Elysia에서는 핸들러가 요청 값을 직접 바꾸고 검증합니다. 아래처럼 쓰면 Fastify가 변환한 값에도 그대로 맞습니다. 헤더는 계약 타입에 소문자 키가 없으므로(`headers['x-audit-reason']`은 TS2551) 넓은 타입으로 바꿔 읽습니다.

```typescript
async updateUser({ params, query, headers, body }) {
  const notify = String(query?.notify) === 'true'
  const reason = (headers as Record<string, string | undefined> | undefined)?.['x-audit-reason']
  // ...
}
```

경로·쿼리 값의 변환과 검증을 프레임워크에 맡기려면 Fastify 라우터를 씁니다. 계약 검증이 필요한 개발·테스트 단계에서는 [mock 서버](./mock-server-usage.md)를 함께 씁니다.

---

## 6. `HandlerResponse` 반환 규칙

1. **본문만 반환**: `return user`는 operation의 기본 성공 상태(가장 낮은 2xx, 예를 들어 생성 operation은 201)로 JSON 응답합니다.
2. **상태·헤더 지정**: `return { status: 200, body: user, headers: { 'Cache-Control': 'max-age=3600' } }`.
3. **오류 응답**: `return { status: 404, body: { code: 'NOT_FOUND', message: '...' } }`.
4. **스트리밍**: `body`에 `ReadableStream`, `AsyncIterable<Uint8Array | string>`, Node 스트림(`pipe()`를 가진 객체), `Uint8Array`를 넣으면 청크 단위로 보냅니다. 상태 코드는 200 또는 206(`StreamingResponse`)입니다.

라우터는 반환값이 `body` 속성을 가진 객체이고, `status`가 없거나 숫자이며, `headers`가 없거나 객체이면 `{ status, body, headers }` 응답 봉투로 해석해 `body`만 보냅니다. 따라서 `body` 필드를 가진 엔티티를 본문으로 돌려줄 때는 `return { status: 200, body: entity }`처럼 반드시 감쌉니다.

---

## 7. `oa-gen init`과의 관계

`oa-gen init --target <framework> --yes`는 `oa.config.ts`와 `package.json`(스크립트, `devDependencies`)만 씁니다. 계약, 라우터, 서버 진입점 파일은 만들지 않습니다.

- `init`이 추가하는 `generate:router` 스크립트(`oa-gen generate --target <framework>`)는 `oa-gen generate`와 같은 일을 하며 라우터 파일을 만들지 않습니다. 결과는 3.2절의 타입 없는 계약, 클라이언트, TanStack Query 코드입니다.
- 프레임워크 대상의 `dev`·`build` 스크립트(`tsx watch src/server.ts`, `tsc`)는 사용자가 `src/server.ts`와 `tsconfig.json`을 만든다고 전제합니다.

라우터가 필요하면 3.1절의 스크립트를 `package.json`에 등록해 씁니다.
