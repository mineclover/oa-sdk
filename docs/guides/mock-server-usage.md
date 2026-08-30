# Mock 서버 사용 가이드

이 가이드는 현재 oa-sdk source workspace에서만 적용된다. `@oa-sdk/mock-server`와
`@oa-sdk/schemas`는 아직 public npm distribution candidate가 아니다. 먼저 repository root에서
`pnpm install && pnpm build:core && pnpm build:downstream`을 실행해 private package와
`@oa-sdk/schemas/openapi.json` artifact를 준비한다. 외부 consumer는 공개 `@oa-sdk/codegen`의
`npx oa-gen validate`/`typegen` 경로를 사용하며 mock-server package를 설치 대상으로 가정하지 않는다.

## MSW 어댑터 (브라우저 / Vitest)

```ts
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'
import spec from '@oa-sdk/schemas/openapi.json'
import { setupServer } from 'msw/node'

const handlers = createMswHandlers(spec)
const server = setupServer(...handlers)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## Node HTTP 어댑터 (통합 테스트)

```ts
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import spec from '@oa-sdk/schemas/openapi.json'

let mockServer: Awaited<ReturnType<typeof createNodeMockServer>>

beforeAll(async () => {
  mockServer = createNodeMockServer(spec, { port: 0 })  // port: 0 = 랜덤 포트
  await mockServer.start()
})

afterAll(async () => {
  await mockServer.stop()
})

test('GET /health', async () => {
  const res = await fetch(`${mockServer.url}/health`)
  expect(res.ok).toBe(true)
})
```

## 검증 실패 응답 형식

요청이 스키마 검증에 실패하면 `422 Unprocessable Entity` 반환:

```json
{
  "error": {
    "code": "CONSTRAINT_VIOLATION",
    "message": "요청 검증 실패",
    "details": [
      {
        "path": "/body/email",
        "code": "FORMAT_MISMATCH",
        "message": "must match format 'email'",
        "received": { "type": "string", "length": 12 },
        "expected": "string with format 'email'"
      },
      {
        "path": "/body/password",
        "code": "CONSTRAINT_VIOLATION",
        "message": "must NOT have fewer than 8 characters",
        "received": { "type": "string", "length": 3 },
        "constraint": { "limit": 8 }
      }
    ]
  }
}
```

`received` (and the legacy `value` alias when present) is a content-free
type/length/count summary. The mock server never reflects submitted strings,
objects, arrays, XML, passwords, or tokens in validation error details.

## 에러 코드 목록

| 코드 | 트리거 AJV keyword |
|---|---|
| `TYPE_ERROR` | `type` |
| `CONSTRAINT_VIOLATION` | `minLength`, `maxLength`, `minimum`, `maximum`, `minItems` 등 |
| `MISSING_REQUIRED_FIELD` | `required` |
| `INVALID_ENUM_VALUE` | `enum` |
| `FORMAT_MISMATCH` | `format` |
| `PATTERN_MISMATCH` | `pattern` |
| `PROTOCOL_MISMATCH` | Content-Type 불일치 |
| `NOT_FOUND` | 경로 매칭 실패 |

## 응답 커스텀

Mock 서버는 `examples` → `example` → `schema.default` → 최솟값 순으로 응답을 선택합니다.  
스키마에 `examples`를 작성하면 항상 그 값이 우선됩니다.

```yaml
# spec.yaml
responses:
  "200":
    content:
      application/json:
        schema:
          $ref: "#/components/schemas/User"
        examples:
          default:
            dataValue:
              id: "123e4567-e89b-12d3-a456-426614174000"
              name: "홍길동"
```
