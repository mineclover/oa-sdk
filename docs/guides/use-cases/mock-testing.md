# Use Case: Mock 서버로 테스트

> OAS spec 기반 Mock 서버를 테스트에서 활용하는 패턴.

## 시나리오

프론트엔드 또는 통합 테스트에서 실제 백엔드 없이 API 동작을 시뮬레이션.

행동 수집/조회 관점의 개념 정의는 [Behavior ECS](../../concepts/behavior-ecs.md)를 따르고,
baseline/local verification은
[Behavior ECS Spec](../../internal/behavior-ecs.spec.md)를 단일 소스로 본다.

## Node HTTP 어댑터 (Vitest/Playwright)

`createTestClient`는 패키지 루트(`@oa-sdk/mock-server`)에서, `createNodeMockServer`는 루트와 `@oa-sdk/mock-server/adapters/node-http`에서 export됩니다. 두 entry point 모두 MSW 어댑터를 불러오지 않으므로 이 예제는 mock-server의 선택적 peer인 `msw` 없이 실행됩니다.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient } from '@oa-sdk/mock-server'

const spec = { /* OAS spec 또는 import from @oa-sdk/schemas */ }

let server, client

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 })  // 랜덤 포트
  await server.start()
  client = createTestClient(server)
})

afterAll(() => server.stop())

it('사용자 목록 조회', async () => {
  const res = await client.get('/users', {
    headers: { authorization: 'Bearer test-token' }
  })
  expect(res.status).toBe(200)
  expect(res.json.items).toBeDefined()
})

it('필수 필드 누락 → 422 + 에러 상세', async () => {
  const res = await client.post('/users', { name: 'Alice' }, {
    headers: { authorization: 'Bearer test-token' }
  })
  expect(res.status).toBe(422)
  expect(res.json.error.details[0].code).toBe('MISSING_REQUIRED_FIELD')
})
```

## MSW 어댑터 (브라우저 테스트)

MSW 어댑터는 `@oa-sdk/mock-server/adapters/msw`(Node, Vitest)와 `@oa-sdk/mock-server/browser`(browser bundle)에서만 export됩니다. 이 두 entry point만 선택적 peer인 `msw`를 import하므로 `msw`를 함께 설치합니다(`npm install --save-dev msw`).

```typescript
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'
import { setupServer } from 'msw/node'

const handlers = createMswHandlers(spec)
const mockServer = setupServer(...handlers)

beforeAll(() => mockServer.listen())
afterAll(() => mockServer.close())
```

## 검증 계층

Mock 서버는 요청을 순서대로 검증합니다:

```
Security → Content-Type → Parameters → Body → 응답 선택
```

→ [에러 코드 8종 상세](../../internal/spec.md)
→ [검증 API](../../internal/api-index.md#함수-oa-sdkmock-server--고유)
→ [Behavior ECS](../../concepts/behavior-ecs.md)

## 응답 우선순위

```
examples[0].dataValue → value → example → schema.example → schema.default → generateMinimal()
```

→ [OAS 3.2 Examples 커버리지](../../internal/oas32-coverage.md)
→ [Behavior ECS 기본 테스트 케이스](../../internal/behavior-ecs.spec.md#baseline-test-cases)
