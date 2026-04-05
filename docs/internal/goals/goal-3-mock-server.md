# Goal 3 — Mock API 서버

**상태: ✅ 구현 완료**

## 목표

- UI 유닛 테스트용 Mock 서버
- AJV v8 기반 상세 에러 분류 (8가지 에러 코드)
- MSW 2.x 어댑터 + Node HTTP 어댑터 양쪽 지원
- Faker 미사용 — `examples` / `default` / `generateMinimal()` 순서로 응답 생성

## 에러 코드

| 코드 | 의미 |
|---|---|
| `TYPE_ERROR` | 타입 불일치 (`received: number, expected: string`) |
| `CONSTRAINT_VIOLATION` | 조건 미충족 (`minLength: 8, received length: 3`) |
| `MISSING_REQUIRED_FIELD` | 필수 필드 누락 |
| `INVALID_ENUM_VALUE` | enum 미포함 값 |
| `FORMAT_MISMATCH` | format 불일치 (uuid, email 등) |
| `PATTERN_MISMATCH` | pattern regex 불일치 |
| `PROTOCOL_MISMATCH` | Content-Type 불일치 |
| `NOT_FOUND` | 경로 매칭 실패 |

## 응답 선택 우선순위

1. `examples[0].dataValue` (OAS 3.2)
2. `examples[0].value` (OAS 3.1 호환)
3. `example` 필드
4. `schema.example`
5. `schema.default`
6. `generateMinimal()` — format 힌트 기반 최솟값 생성 (Faker 미사용)

## 어댑터

### MSW 어댑터

```ts
import { createMswHandlers } from '@oa-sdk/mock-server/msw'

const handlers = createMswHandlers(openApiSpec)
// setupServer(...handlers) 또는 setupWorker(...handlers)
```

### Node HTTP 어댑터

```ts
import { createNodeMockServer } from '@oa-sdk/mock-server/node'

const server = createNodeMockServer(openApiSpec, { port: 4010 })
await server.start()
// server.url → 'http://localhost:4010'
await server.stop()
```

## 검증 흐름

```
요청 수신
  → Content-Type 검사 (PROTOCOL_MISMATCH)
  → path params 검사
  → query params 검사
  → header params 검사
  → request body AJV 검증
  → 실패 시 422 + MockErrorDetail[]
  → 성공 시 응답 선택 → 200/201 반환
```

## 패키지

`packages/mock-server` — [architecture/packages.md](../architecture/packages.md) 참조
