# Mock 서버 사용 가이드

`oa-sdk`의 mock 서버는 OpenAPI 3.1/3.2 문서나 TypeSpec(`.tsp`) 원본을 읽어, 계약대로 응답하고 계약에 맞지 않는 요청은 거절하는 HTTP 서버를 띄웁니다. 백엔드를 구현하기 전에 프론트엔드·에이전트·통합 테스트를 계약에 맞춰 개발할 수 있습니다. 이 문서는 `@oa-sdk/codegen` 0.10.0과 `@oa-sdk/mock-server` 0.1.5 기준입니다.

이 문서가 mock 서버의 실행 방법, 상태 유지(stateful) CRUD, 응답 선택 규칙, 검증 오류 형식의 정본입니다. 테스트 코드에서 쓰는 패턴은 [Mock 서버로 테스트](./use-cases/mock-testing.md), 커버리지 추적은 [테스트 피드백 루프](./use-cases/test-feedback.md), 패키지 API 전체 목록은 [`@oa-sdk/mock-server` README](../../packages/mock-server/README.md)를 봅니다.

---

## 1. 설치

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/mock-server
```

- `oa-gen mock`은 서버를 동반 패키지(companion package) `@oa-sdk/mock-server`에서 불러옵니다. 이 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다([동반 패키지](./cli-setup.md#동반-패키지-companion-packages)). 코드에서만 mock 서버를 쓴다면 `@oa-sdk/mock-server`만 설치해도 됩니다.
- `@oa-sdk/mock-server`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.
- `msw`는 MSW 어댑터(`@oa-sdk/mock-server/adapters/msw`, `@oa-sdk/mock-server/browser`)를 쓸 때만 설치합니다. `oa-gen mock`과 패키지 루트, Node HTTP 어댑터는 `msw` 없이 동작합니다.

---

## 2. CLI로 실행하기

### 2.1 `oa-gen mock`

디스크에 생성물을 쓰지 않고 스펙을 메모리에서 읽어 바로 서빙합니다. TypeSpec 파일은 `@oa-sdk/codegen`에 들어 있는 TypeSpec 컴파일러로 메모리에서 컴파일합니다.

```bash
# OpenAPI 문서 서빙 (기본 http://127.0.0.1:4010)
npx oa-gen mock --spec ./openapi.yaml

# TypeSpec 원본을 감시하며 서빙, 상태 유지 CRUD 사용
npx oa-gen mock --tsp typespec/main.tsp --watch --stateful --port 4010

# 경로 없이 실행하면 oa.config.ts의 spec target을 서빙 (oa-gen init이 추가하는 mock 스크립트)
npx oa-gen mock --watch
```

서빙할 스펙은 다음 순서로 정합니다.

1. `--tsp <파일>`
2. `--spec <파일>`
3. `oa.config.ts`의 spec target. 정확히 하나일 때만 쓰고, `.tsp` 원본이면 `--tsp`처럼 컴파일합니다. 출력에 `[oa-gen mock] Serving spec target "<id>" of oa.config.ts: <schemaEntry>`가 표시됩니다. spec target이 없거나 둘 이상이면 오류를 출력하고 종료 코드 1로 실패합니다.

| 옵션 | 설명 |
|---|---|
| `--tsp, -t <파일>` | TypeSpec 진입점(`.tsp`) |
| `--spec, -s <파일>` | OpenAPI JSON/YAML 문서, 또는 `@oaOperation` JSDoc을 단 TypeScript 소스 |
| `--port, -p <포트>` | 리스닝 포트 (기본값 `4010`) |
| `--host <호스트>` | 바인딩 호스트 (기본값 `127.0.0.1`) |
| `--watch, -w` | 스펙 파일(`.yaml`, `.json`, `.tsp`, `.ts`) 변경을 감시합니다. 변경 후 100ms 디바운스를 거쳐 다시 컴파일하고, 서버를 재시작하지 않고 라우트를 교체합니다. 컴파일이나 파싱에 실패하면 오류를 출력하고 이전 라우트를 유지합니다. |
| `--stateful` | 메모리 저장소로 컬렉션 CRUD를 흉내 냅니다(4절). |

TypeSpec 원본에서 4xx 응답을 선언할 때는 `@oa-sdk/typespec-decorators`의 `ErrorResponse<Status>`나 `StandardHttpErrors`를 씁니다. `@oaUseResponseComponent`는 이 저장소의 bundle restore 경로에서만 실제 응답으로 바뀌고, `oa-gen mock --tsp`의 메모리 컴파일에서는 응답이 생기지 않습니다.

### 2.2 `oa-mock`

`@oa-sdk/mock-server` 패키지는 자체 CLI `oa-mock`도 제공합니다. OpenAPI JSON/YAML 파일만 받고(`.tsp`와 `oa.config.ts` 기본값은 `oa-gen mock`에만 있음), 네트워크 지연·손실을 흉내 내는 옵션이 있습니다. 스펙이 여러 파일로 나뉘어 있으면 다른 파일을 가리키는 `$ref`(`./schemas.yaml#/User`, `./paths/user.yaml` 등)를 스펙 파일의 위치에서 풀어 검증하고 서빙하므로, 다른 파일에 있는 path item의 operation도 응답합니다. 없는 파일이나 서로만 가리키는 `$ref`처럼 풀 수 없는 `$ref`가 있으면 포트를 열기 전에 그 `$ref`를 출력하고 종료 코드 1로 실패합니다.

```bash
npx oa-mock --spec ./openapi.yaml --port 4010 --stateful
npx oa-mock --spec ./openapi.yaml --ttfb 100 --jitter 25 --packet-loss 5% --loss-mode status
```

| 옵션 | 설명 |
|---|---|
| `--spec, -s <파일>` | OpenAPI JSON/YAML 파일 (필수) |
| `--port, -p <포트>` | 0~65535 (기본값 `4010`) |
| `--stateful` | 상태 유지 CRUD |
| `--throttle <속도>` | 대역폭 제한 (`500kbps`, `1mbps`, 초당 바이트 수) |
| `--ttfb <ms>`, `--jitter <ms>` | 첫 바이트 지연과 그 오차 |
| `--packet-loss <비율>`, `--loss-mode drop\|status` | 요청 손실 확률(`5%` 또는 `0.05`)과 손실 방식(소켓 끊기 또는 503) |

---

## 3. 코드에서 실행하기

어댑터에는 스펙 객체를 넘깁니다. 프로젝트의 OpenAPI 문서를 읽어 넘기며, JSON 문서는 `JSON.parse(readFileSync(...))`나 import attribute(`import spec from './openapi.json' with { type: 'json' }`)로, YAML 문서는 `yaml` 패키지의 `parse()`로 읽습니다. 이 저장소의 `@oa-sdk/schemas`는 npm에 배포하지 않는 저장소 전용 패키지이므로 외부 프로젝트의 예제 입력으로 쓰지 않습니다.

### 3.1 Node HTTP 어댑터 (통합 테스트, E2E)

실제 HTTP 서버를 띄웁니다. `createNodeMockServer`는 패키지 루트와 `@oa-sdk/mock-server/adapters/node-http`에서 export되며 `msw`가 필요 없습니다.

```typescript
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server'

const spec = JSON.parse(readFileSync('./openapi.json', 'utf8'))
let mockServer: NodeMockServer

beforeAll(async () => {
  mockServer = createNodeMockServer(spec, { port: 0 }) // port 0: 빈 포트 자동 선택
  await mockServer.start()
})

afterAll(async () => {
  await mockServer.stop()
})

test('GET /users', async () => {
  const res = await fetch(`${mockServer.url}/users`, { headers: { authorization: 'Bearer test-token' } })
  expect(res.status).toBe(200)
})
```

- 기본 포트와 호스트는 `4010`, `127.0.0.1`입니다. 실제 주소는 `start()` 뒤 `mockServer.url`에 있습니다.
- 스펙의 `servers[0]` URL에 경로가 있으면(`https://api.example.com/v1`) `mockServer.url`이 그 경로까지 포함합니다(`http://127.0.0.1:<port>/v1`). 요청은 `${mockServer.url}/users`로 보냅니다. `${mockServer.url}/v1/users`는 `/v1/v1/users`가 되어 404입니다. 다른 서버를 쓰려면 `serverIndex`, `serverVariables` 옵션을 줍니다.
- 응답을 검사하는 헬퍼(`createTestClient`)는 [Mock 서버로 테스트](./use-cases/mock-testing.md)를 봅니다.

### 3.2 MSW 어댑터 (브라우저, Vitest)

MSW로 `fetch`를 가로챕니다. `@oa-sdk/mock-server/adapters/msw`(Node, Vitest)나 `@oa-sdk/mock-server/browser`(브라우저 번들)에서 import하고, `msw` 2.x를 함께 설치합니다(`npm install --save-dev msw`).

```typescript
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'

const spec = JSON.parse(readFileSync('./openapi.json', 'utf8'))
const server = setupServer(...createMswHandlers(spec))

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

브라우저에서는 `msw/browser`의 `setupWorker(...createMswHandlers(spec))`를 씁니다. `createMswHandlers(spec, { onRequest })`의 `onRequest({ method, path, operationId })`로 들어온 요청을 관찰할 수 있습니다.

---

## 4. 상태 유지 CRUD와 플러그인

### 4.1 `stateful`

기본 mock 서버는 매 요청에 스펙의 예제나 스키마로 만든 같은 응답을 돌려줍니다. `stateful`을 켜면 메모리 저장소가 컬렉션 경로의 요청을 처리해, POST로 만든 항목을 GET으로 다시 읽고 DELETE로 지울 수 있습니다. CLI에서는 `--stateful`, 코드에서는 `stateful: true` 또는 `stateful: { seed, generateId }`입니다.

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, {
  port: 0,
  stateful: {
    seed: {
      '/users': [
        { id: 'usr-1', name: 'Alice', status: 'active' },
        { id: 'usr-2', name: 'Bob', status: 'active' },
      ],
    },
  },
})
await server.start()

// 테스트마다 seed 상태로 되돌림
server.reset()
```

| 요청 | 동작 |
|---|---|
| `GET /users` | 저장된 항목 배열을 반환합니다. 쿼리에 `limit`·`pageSize`·`per_page`가 있으면(`offset` 또는 `page`와 함께) 잘라서 반환하고, 문서화된 200 스키마에 `items`나 `data` 속성이 있으면 `{ items, total, page?, limit }`이나 `{ data, total }`으로 감쌉니다. |
| `POST /users` | 요청 본문을 추가합니다. `id`가 없으면 `generateId`(기본 `crypto.randomUUID()`)로 만듭니다. 200만 문서화하지 않았다면 201로 답합니다. |
| `GET`·`PUT`·`PATCH`·`DELETE /users/{id}` | `id`(또는 path 파라미터 이름)로 항목을 찾아 반환·교체·병합·삭제합니다. 없으면 404 `NOT_FOUND`입니다. `DELETE`는 200만 문서화하지 않았다면 204로 답합니다. 저장소가 한 번도 다루지 않은 컬렉션의 경로는 스펙 기반 응답으로 돌아갑니다. |

- 요청 검증(6절)을 통과한 요청만 저장소에 도달합니다.
- 저장소가 만든 응답은 문서화된 응답 스키마로 검증하지 않습니다. 예를 들어 200 스키마가 `{ items }`인데 `limit` 없이 조회하면 배열을 그대로 반환합니다.
- MSW 어댑터에서는 `createMswMockServer(spec, { stateful })`가 `{ handlers, reset(), override(), ... }`를 반환합니다(`@oa-sdk/mock-server/browser`, `/adapters/msw`).

### 4.2 플러그인

`createNodeMockServer`, `createMswHandlers`, `createMswMockServer`는 `plugins: MockPlugin[]`을 받습니다. 플러그인은 요청 검증을 통과한 요청에만 실행됩니다.

- `onMatch(context)`: 응답(`{ status, contentType?, body?, headers? }`)을 반환하면 스펙 기반 응답 대신 그 응답을 씁니다. 처음 응답을 반환한 플러그인이 이깁니다. 아무것도 반환하지 않으면 다음 플러그인이나 기본 응답으로 넘어갑니다.
- `onResponse(response, context)`: 선택된 응답을 변환합니다. 모든 플러그인의 훅이 순서대로 실행됩니다.
- `reset()`: 플러그인 상태를 지웁니다. `server.reset()`이 모든 플러그인의 `reset()`을 호출합니다.

`stateful`은 내장 플러그인 `inMemoryStorePlugin()`을 추가하는 단축 옵션입니다.

### 4.3 그 밖의 서버 제어

| API | 동작 |
|---|---|
| `server.override(operationId, { status, body?, headers? })` | 해당 operation의 응답을 고정합니다. `clearOverride(operationId)`, `clearOverrides()`로 해제합니다. MSW의 `createMswMockServer`도 같은 메서드를 가집니다. |
| `server.updateSpec(spec)` | 서버를 재시작하지 않고 스펙을 교체합니다(Node HTTP 어댑터). `oa-gen mock --watch`가 이 메서드를 씁니다. |
| `include` 옵션 | `{ paths, operations, tags, filter }` 중 하나라도 맞는 라우트만 엽니다. |
| `chaos` 옵션 | `{ ttfbMs, jitterMs, packetLoss, lossMode, throttleBytesPerSec }`. `oa-mock`의 네트워크 옵션과 같습니다(Node HTTP 어댑터). |

---

## 5. 응답 선택 규칙

요청 검증을 통과하면 operation의 응답 중 하나를 고릅니다.

- 상태 코드: 정확한 3자리 코드 중 가장 낮은 2xx, 2xx가 없으면 가장 낮은 코드, 그다음 범위 코드(`2XX`가 `200`), 마지막으로 `default`(`200`).
- 본문: `examples`의 첫 항목 `dataValue` → `value` → `example` → `schema.example` → `schema.default` → 스키마로 만든 최소값.
- 응답 헤더는 스펙에 선언한 헤더로 채웁니다.
- 고른 응답 본문이 스키마를 만족하지 않거나 응답이 하나도 없으면 500으로 답합니다(6절).

예제를 적어 두면 항상 그 값이 응답이 됩니다.

```yaml
responses:
  "200":
    description: OK
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

스트리밍 응답(`text/event-stream`, `application/x-ndjson`, `application/jsonl`)은 예제가 있으면 그 이벤트 하나를, 없으면 스키마(OpenAPI 3.2 `itemSchema` 포함)로 만든 이벤트 3개를 보낸 뒤 연결을 닫습니다. `data: [DONE]` 프레임은 보내지 않습니다.

---

## 6. 요청 검증과 오류 응답

요청은 `Security → Content-Type → 파라미터 → 본문` 순서로 검증합니다.

| 상황 | 응답 |
|---|---|
| 정의되지 않은 경로 | 404 `{ "error": { "code": "NOT_FOUND", ... } }` |
| 경로는 있지만 메서드가 없음 | 405, `Allow` 헤더에 허용 메서드 (Node HTTP 어댑터) |
| 보안 요구사항이 있는데 인증 정보가 없음 | 401. operation이 401 응답을 문서화했으면 그 응답, 아니면 `{ "code": "UNAUTHORIZED", "message": ... }` |
| 파라미터·본문·Content-Type 검증 실패 | 422. operation이 422 응답을 문서화했으면 그 응답(스키마가 허용하면 `details` 포함), 아니면 아래 오류 형식 |
| 검증 스키마를 컴파일할 수 없음 | 500 `SCHEMA_COMPILE_ERROR` |
| 고른 응답이 응답 스키마를 만족하지 않거나 응답이 정의되지 않음 | 500 |

401은 보안 스킴이 요구하는 자격 증명(헤더, 쿼리, 쿠키)이 있는지만 봅니다. 토큰 값은 검사하지 않습니다.

422 응답의 기본 형식은 다음과 같습니다. 최상위 `code`는 `CONSTRAINT_VIOLATION`이고, 위반 항목마다 `details`에 세부 코드가 들어갑니다.

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
    ],
    "_meta": { "operationId": "createUser", "method": "post", "path": "/users" }
  }
}
```

`received`(와 예전 이름 `value`)는 값의 형태(타입, 길이, 항목 수)만 담습니다. 보낸 문자열, 객체, 배열, 비밀번호, 토큰 값은 오류 응답에 나오지 않습니다.

| 코드 | 의미 |
|---|---|
| `TYPE_ERROR` | 타입 불일치 (`type`) |
| `CONSTRAINT_VIOLATION` | `minLength`, `maxLength`, `minimum`, `maximum`, `minItems` 등 제약 위반 |
| `MISSING_REQUIRED_FIELD` | 필수 필드·파라미터 누락 (`required`) |
| `INVALID_ENUM_VALUE` | `enum`에 없는 값 |
| `FORMAT_MISMATCH` | `format` 위반 (`email`, `uuid`, `date-time` 등) |
| `PATTERN_MISMATCH` | `pattern` 불일치 |
| `PROTOCOL_MISMATCH` | `Content-Type`이 선언된 요청 본문 media type과 다름 |
| `SCHEMA_COMPILE_ERROR` | mock 서버가 검증용 스키마를 컴파일하지 못함 (500) |
| `NOT_FOUND` | 경로 매칭 실패 (404), 또는 응답이 정의되지 않은 operation (500) |
