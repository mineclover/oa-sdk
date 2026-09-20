# Mock 서버 사용 가이드

`oa-sdk`는 사양(OpenAPI 3.1/3.2 또는 TypeSpec `.tsp`)을 기반으로 즉시 동작하는 Mock API 서버 환경을 제공합니다.
개발 중인 프론트엔드나 에이전트, 통합 테스트 환경에서 실제 백엔드가 배포되기 전에도 계약을 완벽히 검증할 수 있습니다.

---

## 1. CLI 기반 무빌드 즉시 실행 (`oa-gen mock --tsp`)

중간 OpenAPI YAML 파일을 빌드할 필요 없이, TypeSpec(`.tsp`) 소스 파일로부터 직접 인메모리 컴파일을 거쳐 즉시 Mock 서버를 구동합니다:

```bash
# 기본 구동 (포트 4010)
oa-gen mock --tsp packages/schemas/typespec/main.tsp

# 파일 변경 감지 핫 리로드 (--watch) 및 CRUD 상태 저장소 시뮬레이션 (--stateful)
oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch --stateful --port 4010
```

### 주요 CLI 옵션
| 옵션 | 단축키 | 설명 |
|---|---|---|
| `--tsp <path>` | `-t` | TypeSpec 진입점 파일(`.tsp`) 경로 |
| `--spec <path>` | `-s` | OpenAPI JSON/YAML 또는 TypeScript 스펙 파일 경로 |
| `--watch` | `-w` | 스펙 파일 수정 시 서버 재시작 없이 100ms 내 라우트 핫 리로드(Hot-Reload) |
| `--stateful` | | 인메모리 CRUD 상태 저장소 활성화 (POST로 생성된 데이터가 subsequent GET/PATCH/DELETE에 반영됨) |
| `--port <port>` | `-p` | 서버 리스닝 포트 (기본값: `4010`) |
| `--host <host>` | | 서버 바인딩 호스트 (기본값: `127.0.0.1`) |

---

## 2. 프로그래밍 방식: MSW 어댑터 (브라우저 / Vitest)

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

## 3. Node HTTP 어댑터 (통합 테스트)

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
