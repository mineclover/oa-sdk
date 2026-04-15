# Spec — 현재 구현 현황

> API 상세: [api-index.md](./api-index.md) / OAS 커버리지: [oas32-coverage.md](./oas32-coverage.md)

---

## 패키지 구조

```
core         ← 공유 유틸 (문자열, 코드젠, 포맷, 응답 상태, HTTP 서버)
parser       ← core. OAS 3.2 파서 + IR + fold + lint + validate + query
codegen      ← core + parser (+ router, client: optional peer). CLI 7커맨드
mock-server  ← core + parser. AJV 검증 + 어댑터 + 테스트 헬퍼
router       ← core + parser. Hono/Express 스텁
client       ← core + parser. fetch SDK + SSE
typia-mock   ← core + parser (+ typia: peer). LLM 함수 호출 검증 서버
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
| `parseDocument()` | → ParsedDocument IR (operations, routes, schemas, security, tags, webhooks), `basePath`/`cycleStrategy` 옵션 |
| `SchemaAlgebra` fold | 스키마 재귀 순회 — 타입별 의미 해석 |
| `resolveRefGraph()` | 공유 `RefResolver` 기반 내부/외부 `$ref` 그래프 수집, nested external ref 추적, 누락/순환 diagnostic |
| `derefSpec()` | 공유 `RefResolver` 기반 내부/외부 YAML/JSON `$ref` 인라인 전개, sibling 구조 정보 보존, `cycleStrategy` 지원 |
| `lintDocument()` | 7카테고리 17규칙 + ref graph diagnostic source 출력 |
| `validateDocument()` | 종합 검증 (파싱 + 린트 + JSON Schema 2020-12 메타 검증 + ref graph diagnostic) |
| Query API | `findOperation`, `findByTag`, `describeApi`, `resolveServerUrl`, `groupByTag` |
| Tags 계층 | parent/kind 트리 — describeApi에서 재귀 렌더링 |

## `@oa-sdk/mock-server` ✅

| 기능 | 상세 |
|------|------|
| allOf merge | `generateAlgebra`의 allOf — 모든 branch object merge (intersection 정합) |
| `handleRequest()` | 공통 핸들러 (validateRequest → pickResponse). MSW/Node HTTP 공유 |
| AJV 검증 | 9 에러코드 + discriminator 네이티브 지원 + schema compile 실패 분리 |
| Request schema preflight | `validateRequestSchemas` / `assertValidRequestSchemas` — mock 생성 시점에 request schema compile 검증 |
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
| typegen 제약 JSDoc | format/min/max/pattern → `@format`/`@minimum` 등 JSDoc 태그 |
| typegen readOnly | `readOnly: true` → `readonly` 수식어 |
| typegen deprecated | `deprecated: true` → `@deprecated` JSDoc |
| typegen annotations | `annotations` 객체 → `includeAnnotations` 옵션으로 `@note`/`@see` JSDoc |
| typegen external refs | 외부 YAML/JSON `$ref` schema alias 생성, nested relative ref source 기준 해소, 이름 충돌 시 파일명 기반 deterministic rename + 경고 |
| typegen 중복 방지 | schema 이름과 Op 타입 이름 충돌 시 schema 우선, 중복 생성 방지 |
| typegen const 중첩 | 중첩 프로퍼티의 `const` → 리터럴 타입 정규화 |
| additionalProperties | `Record<string, T>` + index signature 타입 생성 |
| WorkspaceIndex | 파일 hash/component/ref/source/diagnostic/type alias metadata용 index 경계. 기본 noop은 모든 파일을 dirty 처리해 기존 full rebuild 동작 유지 |
| CLI | 커맨드 모듈 구조. `generate`/`typegen`/`router`/`client`/`lint`/`validate`/`dev`/`--help` |

### Resolver baseline (US-001) / Shared contract (US-002) / External cache alignment (US-003)

| Surface | 현재 코드 경로 | 고정한 동작 |
|---------|----------------|-------------|
| `RefResolver` | `packages/parser/src/ref-resolver.ts`의 `createRefResolver()` → `resolvePointer()` + external YAML/JSON document cache | parser 내부 contract. internal/external/unsupported kind, JSON Pointer, cache key/document cache key, source file/pointer, target file/pointer metadata, missing/circular/read-failed diagnostic을 단일 결과 객체로 반환. public index에는 export하지 않음 |
| `resolveRefGraph()` | `packages/parser/src/ref-graph.ts`의 `collectRefs()` traversal → 공유 `RefResolver` | 내부 ref, 외부 YAML/JSON ref, 외부 파일 내부 nested ref를 graph node로 기록. 누락 pointer/read 실패와 순환은 diagnostic으로 기록하며 `$ref` sibling 내부 ref도 계속 수집 |
| `derefSpec()` | `packages/parser/src/deref.ts`의 `DerefFolder.foldRef()` → 공유 `RefResolver` + deref file cache/stack | 내부/외부 YAML/JSON ref를 인라인 전개하고 외부 파일 내부 상대 ref는 해당 파일 기준으로 해소. missing ref는 원본 `$ref` node 유지. 기본 cycle은 `{}`로 절단하고 `cycleStrategy: preserve-ref`는 ref 유지. `$ref` sibling은 해소 결과에 병합 |
| typegen external refs | `generateTypesFromSpec()` → `parseDocument()`(deref 없음) → `analyzeExternalSchemaRefs()` → `resolveRefGraph()` → `schemaToTs(refNameOverrides)` | 외부 `#/components/schemas/*` YAML/JSON schema를 generated alias로 추가. nested external schema alias도 생성. raw ref override는 entry 문서 ref에만 쓰고, 외부 schema 내부 ref는 absolute file+pointer identity로 정규화해 source 문서 기준 상대 경로를 보존. 이름 충돌/로컬 shadow는 deterministic rename warning에 resolved file+pointer와 생성 타입명을 포함. missing/read/pointer 실패는 resolver diagnostic code와 source metadata를 유지 |

### WorkspaceIndex boundary (US-007)

| Surface | 현재 코드 경로 | 고정한 동작 |
|---------|----------------|-------------|
| `WorkspaceIndex` | `packages/codegen/src/workspace-index.ts` | parser 밖의 codegen index 경계. file hash, component, ref edge, source location, diagnostic, type alias metadata 모델을 정의하되 SQLite 구현은 포함하지 않음 |
| `createNoopWorkspaceIndex()` / `createWorkspaceIndex()` | `packages/codegen/src/workspace-index.ts` | 기본 index는 읽기 결과를 비우고 scan 입력 전체를 changed로 반환해 기존 full rebuild 결과를 정답으로 유지 |
| `createMemoryWorkspaceIndex()` | `packages/codegen/src/workspace-index.ts` | 테스트와 향후 CLI orchestration용 메모리 구현. 변경 감지와 파일 단위 metadata 교체/무효화를 제공하지만 correctness 판단의 원천은 아님 |

`WorkspaceIndex`는 최적화와 영향도 계산을 위한 index layer이며, component 중복, `$ref` 해소, cycle diagnostic, type alias 생성의 최종 correctness는 현재 파일 내용으로 재계산하는 full parser/codegen 경로가 담당한다.

## `@oa-sdk/router` ✅

Hono/Express 스텁. `OasDocument | ParsedDocument` 입력. typegen 타입 import, JSDoc, 204.
Content-type aware 스텁 + security requirement hints. Hono 타입드 라우터 (응답/바디 타입 캐스팅).
Webhook 핸들러 스텁 생성.

## `@oa-sdk/client` ✅

fetch `createClient()` + SSE `async *` generator. `OasDocument | ParsedDocument` 입력. baseUrl from servers.
NDJSON vs SSE 스트림 분리 + `resolveServerUrl` 서버 변수 해소.
ClientMiddleware (`onRequest`/`onResponse`/`onError`) 인터셉터. Webhook 페이로드 타입 생성.

## `@oa-sdk/typia-mock` ✅

| 기능 | 상세 |
|------|------|
| 검증 파이프라인 | parse → coerce → validate (typia ILlmFunction 위임) |
| 에러 분류 | 5 TypiaValidationCode (TYPE_ERROR, CONSTRAINT_VIOLATION, FORMAT_MISMATCH, PATTERN_MISMATCH, UNKNOWN) |
| Mock 생성 | `typiaGenerateAlgebra` — allOf 전체 merge, SchemaAlgebra 공유 |
| HTTP 서버 | GET /functions, POST /validate/:fn, POST /call/:fn |
| 함수 레지스트리 | ILlmApplication 함수 목록/조회 |

## `@oa-sdk/schemas` ✅

도메인 분리 + 환경 프로필 + merge. 중복 path/component 기본 오류. `downgrade:3.1` (사이드카 무손실) + `upgrade:3.2`.

---

## 사용 방법

### 스펙 관리
```bash
pnpm --filter @oa-sdk/schemas run merge            # 도메인 병합
pnpm schema:validate                               # merge + 3.1 변환 + Spectral/Redocly + oa-gen validate
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
| 자체 린터 + ref graph | 3.2 원본 | 0 에러, 0 경고 |
| JSON Schema 메타 검증 | Schema Object | 2020-12 keyword 정합성 |
| Mock schema preflight | request body/parameter schema | mock 생성 전 AJV compile 오류 차단 |
| Redocly | 3.1 변환 | valid, 4 경고 (의도적) |
| Spectral | 3.1 변환 | 0 에러, 1 힌트 |
| 부하 | 100 동시 요청 | <200ms |

## CI 자동화

| Step | 대상 | 동작 |
|------|------|------|
| Build | 7 패키지 + CI 스크립트 | tsup ESM 빌드 |
| Typecheck | 7 패키지 + playground | tsc --noEmit strict |
| Test | 8 패키지 + playground | vitest 1594 케이스 |
| Schema validate | schemas + oa-gen | 도메인 병합 + 3.1 변환 + Spectral/Redocly + 3.2 자체 검증 표준 파이프라인 |
| Freshness check | 산출물 | git diff --exit-code |
| API index | docs ↔ code | export 정합성 검증 |
| Spec diff (PR) | base ↔ head | endpoint 변경 요약 |

---

## 테스트

| 패키지 | 케이스 |
|--------|--------|
| core | 51 |
| parser | 196 |
| codegen | 473 |
| mock-server | 561 |
| playground | 114 |
| router | 35 |
| client | 36 |
| schemas | 75 |
| typia-mock | 53 |
| **합계** | **1594** |
