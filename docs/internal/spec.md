# Spec — 현재 구현 현황

> API 상세: [api-index.md](./api-index.md) / OAS 커버리지: [oas32-coverage.md](./oas32-coverage.md)

---

## 패키지 구조

```
core         ← 공유 유틸 (문자열, 코드젠, 포맷, 응답 상태)
parser       ← core. OAS 3.2 파서 + IR + fold + lint + validate + query
codegen      ← core + parser + router + client. CLI 7커맨드
mock-server  ← core + parser. AJV 검증 + 어댑터 + 테스트 헬퍼
router       ← core + parser. Hono/Express 스텁
client       ← core + parser. fetch SDK + SSE
schemas      ← 독립. OAS 소스 + merge + 3.1↔3.2 변환
```

---

## `@oa-sdk/core` ✅

| 함수 | 용도 |
|------|------|
| `pascalCase`, `escapeKey`, `toColonPath` | 문자열 변환 |
| `collectTypeNames` | operation → typegen 타입 이름 (ResponseHeaders 포함) |
| `formatGeneratedTs` | 생성 코드 자동 들여쓰기 |
| `pickDefaultStatus` | OAS responses → 상태 코드 (범위/default 지원) |

## `@oa-sdk/parser` ✅

| 기능 | 상세 |
|------|------|
| OAS 3.2 타입 | 30개 오브젝트, §별 13파일, 자체 관리 (openapi3-ts 없음) |
| `parseDocument()` | → ParsedDocument IR (operations, routes, schemas, security, tags, webhooks) |
| `SchemaAlgebra` fold | 스키마 재귀 순회 — 타입별 의미 해석 |
| `lintDocument()` | 7카테고리 17규칙 (structure/operations/parameters/refs/security/style/components) |
| `validateDocument()` | 종합 검증 (파싱 + 린트 + 3.2 전용 필드 감지) |
| Query API | `findOperation`, `findByTag`, `describeApi`, `resolveServerUrl`, `groupByTag` |
| Tags 계층 | parent/kind 트리 — describeApi에서 재귀 렌더링 |

## `@oa-sdk/mock-server` ✅

| 기능 | 상세 |
|------|------|
| `handleRequest()` | 공통 핸들러 (validateRequest → pickResponse). MSW/Node HTTP 공유 |
| AJV 검증 | 8 에러코드 + discriminator 네이티브 지원 |
| Security | bearer/apiKey(header/query/cookie)/oauth2/oidc/mTLS, OR/AND, 빈 security |
| Parameters | style/explode 역직렬화 (form/simple/label/matrix/pipe/space) |
| Response headers | OAS headers → HTTP 헤더 전달 |
| Body 파싱 | JSON, form-urlencoded, multipart/form-data, text/plain |
| 스트리밍 | SSE (data: + [DONE]) + NDJSON (bare JSON lines), `generateStreamChunks()` 공유 |
| 어댑터 | MSW 2.x + Node HTTP (Connection: keep-alive 패리티) |
| Response override | `server.override(operationId, response)` — 테스트별 응답 오버라이드 |
| `createMswMockServer()` | MSW 어댑터 + override API 통합 |
| `createTestClient` | get/post/put/patch/delete + query + json 자동파싱 |
| `createCoverageTracker` | operationId별 호출 추적 + 커버리지 비율 |
| `filterRouteIndex` / `RouteFilter` | 태그/경로/메서드 기반 RouteIndex 필터링 |
| Webhooks | ParsedDocument.webhooks → RouteIndex 자동 병합 |
| 브라우저 번들 | `@oa-sdk/mock-server/browser` — Node.js 의존성 없는 브라우저용 엔트리 |
| 부하 | 100 동시 요청 <200ms |

## `@oa-sdk/codegen` ✅

| 기능 | 상세 |
|------|------|
| Zod 4 → OAS | discriminator, nullable, enum, 전 타입 커버리지 |
| ZodLazy → $ref | 재귀 스키마 지원 (refs 컨텍스트 기반) |
| Drizzle → Zod → OAS | pgTable/mysqlTable/sqliteTable, select/insert/update |
| typegen | OAS → TS ($ref 참조, JSDoc, ResponseHeaders, Op 묶음 타입, Error 타입, tsc 검증) |
| additionalProperties | `Record<string, T>` + index signature 타입 생성 |
| CLI | `generate`/`typegen`/`router`/`client`/`lint`/`validate`/`dev`/`--help` |

## `@oa-sdk/router` ✅

Hono/Express 스텁. `OasDocument | ParsedDocument` 입력. typegen 타입 import, JSDoc, 204.
Content-type aware 스텁 + security requirement hints. Hono 타입드 라우터 (응답/바디 타입 캐스팅).
Webhook 핸들러 스텁 생성.

## `@oa-sdk/client` ✅

fetch `createClient()` + SSE `async *` generator. `OasDocument | ParsedDocument` 입력. baseUrl from servers.
NDJSON vs SSE 스트림 분리 + `resolveServerUrl` 서버 변수 해소.
ClientMiddleware (`onRequest`/`onResponse`/`onError`) 인터셉터. Webhook 페이로드 타입 생성.

## `@oa-sdk/schemas` ✅

도메인 분리 + 환경 프로필 + merge. `downgrade:3.1` (사이드카 무손실) + `upgrade:3.2`.

---

## 사용 방법

### 스펙 관리
```bash
pnpm --filter @oa-sdk/schemas run merge           # 도메인 병합
oa-gen validate --spec .merged.yaml                # 종합 검증
oa-gen lint --spec .merged.yaml                    # 린트만
pnpm --filter @oa-sdk/schemas run downgrade:3.1    # 3.1 변환 (Swagger UI 호환)
```

### 코드 생성
```bash
oa-gen typegen --spec .merged.yaml -o types.ts     # TS 타입
oa-gen router  --spec .merged.yaml -o router.ts --types-import './types'
oa-gen client  --spec .merged.yaml -o client.ts --types-import './types'
oa-gen generate --drizzle-schema ./db/schema.ts --output ./domains/users/
```

### 테스트
```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'
import { parseDocument, describeApi, findOperation } from '@oa-sdk/parser'

// Mock 서버
const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

// 요청/검증
const res = await client.post('/users', { name: 'Alice', email: 'a@b.com' }, {
  headers: { authorization: 'Bearer token' }
})
expect(res.status).toBe(201)

// 커버리지
const tracker = createCoverageTracker()
// ... 테스트 후
console.log(tracker.coverage(allOps))  // 0.86

// API 탐색
console.log(describeApi(parseDocument(spec)))
```

### 데모
```bash
pnpm demo  # API 구조 + Mock 12시나리오 + 커버리지
```

---

## 검증 체계

| 도구 | 대상 | 결과 |
|------|------|------|
| 자체 린터 | 3.2 원본 | 0 에러, 0 경고 |
| Redocly | 3.1 변환 | valid, 4 경고 (의도적) |
| Spectral | 3.1 변환 | 0 에러, 1 힌트 |
| 부하 | 100 동시 요청 | <200ms |

---

## 테스트

| 패키지 | 케이스 |
|--------|--------|
| parser | 128 |
| codegen | 218 |
| mock-server | 553 |
| playground | 114 |
| router | 28 |
| client | 27 |
| schemas | 73 |
| **합계** | **1141** |
