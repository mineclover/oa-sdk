# Use Case: Mock 서버로 테스트

> OpenAPI 문서로 띄운 mock 서버를 Vitest·Playwright 테스트에서 쓰는 패턴.

## 시나리오

프론트엔드 또는 통합 테스트에서 실제 백엔드 없이 계약대로 동작하는 API를 사용합니다. 설치, CLI 실행, 상태 유지 CRUD, 응답 선택 규칙, 오류 형식은 [Mock 서버 사용 가이드](../mock-server-usage.md)가 정본이고, 이 문서는 테스트 코드 패턴만 다룹니다. `@oa-sdk/codegen` 0.9.0, `@oa-sdk/mock-server` 0.1.4 기준입니다.

행동 수집/조회 관점의 개념 정의는 [Behavior ECS](../../concepts/behavior-ecs.md)를 따르고, baseline/local verification은 [Behavior ECS Spec](../../internal/behavior-ecs.spec.md)를 단일 소스로 봅니다(저장소 기여자용).

## Node HTTP 어댑터 (Vitest/Playwright)

`createNodeMockServer`와 `createTestClient`는 패키지 루트(`@oa-sdk/mock-server`)에서 export되며 `msw` 없이 동작합니다. `createTestClient(server)`는 `fetch`를 감싸 `{ status, headers, body, json, ok }`를 반환합니다. `json`의 타입은 `unknown`이므로 검사할 형태로 단언합니다. 오류 응답은 패키지가 export하는 `MockErrorResponse` 타입을 씁니다.

```typescript
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createNodeMockServer,
  createTestClient,
  type MockErrorResponse,
  type NodeMockServer,
  type TestClient,
} from '@oa-sdk/mock-server'

const spec = JSON.parse(readFileSync('./openapi.json', 'utf8')) // 프로젝트의 OpenAPI 문서
const auth = { headers: { authorization: 'Bearer test-token' } }

let server: NodeMockServer
let client: TestClient

beforeAll(async () => {
  server = createNodeMockServer(spec, { port: 0 }) // 빈 포트 자동 선택
  await server.start()
  client = createTestClient(server)
})

afterAll(() => server.stop())

describe('users API', () => {
  it('사용자 목록 조회', async () => {
    const res = await client.get('/users', auth)
    expect(res.status).toBe(200)
    expect((res.json as { items: unknown[] }).items).toBeDefined()
  })

  it('인증 정보 없음 → 401', async () => {
    const res = await client.get('/users')
    expect(res.status).toBe(401)
  })

  it('필수 필드 누락 → 422 + 오류 상세', async () => {
    const res = await client.post('/users', {}, auth)
    expect(res.status).toBe(422)
    const { error } = res.json as MockErrorResponse
    expect(error.details[0]?.code).toBe('MISSING_REQUIRED_FIELD')
    expect(error.details[0]?.path).toBe('/body/name')
  })
})
```

`createTestClient`는 `/`로 시작하는 경로를 서버 origin 기준으로 풉니다. 스펙의 `servers[0]` URL에 경로(`/v1`)가 있어도 mock 서버는 그 접두어가 있는 경로와 없는 경로를 모두 받으므로 `client.get('/users')`와 `client.get('/v1/users')`가 같은 라우트로 갑니다. `fetch`로 직접 보낼 때의 주소 규칙은 [Node HTTP 어댑터](../mock-server-usage.md#31-node-http-어댑터-통합-테스트-e2e)를 봅니다. 테스트 사이에 상태를 되돌리려면 `stateful` 서버의 `server.reset()`을 호출합니다([상태 유지 CRUD](../mock-server-usage.md#4-상태-유지-crud와-플러그인)).

Playwright는 설정의 `webServer`로 CLI를 띄우는 방법이 가장 간단합니다(`npx oa-mock --spec ./openapi.yaml --port 4010` 또는 `npx oa-gen mock --spec ./openapi.yaml --port 4010`).

## MSW 어댑터 (브라우저 테스트)

MSW 어댑터는 `@oa-sdk/mock-server/adapters/msw`(Node, Vitest)와 `@oa-sdk/mock-server/browser`(브라우저 번들)에서만 export됩니다. 이 두 entry point만 선택적 peer인 `msw`를 import하므로 `msw`를 함께 설치합니다(`npm install --save-dev msw`).

```typescript
import { setupServer } from 'msw/node'
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'

const mockServer = setupServer(...createMswHandlers(spec))

beforeAll(() => mockServer.listen())
afterAll(() => mockServer.close())
```

## 검증 계층

mock 서버는 요청을 다음 순서로 검증하고, 단계마다 다음 응답을 돌려줍니다. 상태 코드별 조건과 오류 코드 전체 목록은 [요청 검증과 오류 응답](../mock-server-usage.md#6-요청-검증과-오류-응답)을 봅니다.

```
경로 매칭(없으면 404, 메서드 없으면 405) → Security(자격 증명 없으면 401)
  → Content-Type(422 PROTOCOL_MISMATCH) → 파라미터(422) → 본문(422) → 응답 선택
```

→ [검증 API](../../internal/api-index.md#함수-oa-sdkmock-server--고유)
→ [Behavior ECS](../../concepts/behavior-ecs.md)

## 응답 우선순위

```
examples[0].dataValue → value → example → schema.example → schema.default → 스키마로 만든 최소값
```

→ [응답 선택 규칙](../mock-server-usage.md#5-응답-선택-규칙)
→ [OAS 3.2 Examples 커버리지](../../internal/oas32-coverage.md) (저장소 기여자용)
→ [Behavior ECS 기본 테스트 케이스](../../internal/behavior-ecs.spec.md#baseline-test-cases) (저장소 기여자용)
