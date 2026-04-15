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
| Source location index | YAML AST range 기반 `JSON Pointer → line/column` 매핑. object key, array index, nested schema pointer를 기록하며 JSON 입력은 빈 index로 fallback |
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
| typegen public API | `generateTypes*`, `analyzeExternalSchemaRefs`, `schemaToTs`, `TypegenOptions`, `SchemaToTsOptions`, external ref diagnostic 타입은 root entry와 `@oa-sdk/codegen/typegen`에서 공개. package exports는 `.`, `./drizzle`, `./typegen`만 지원하고 deep typegen implementation import는 비공개. 공개 option type import는 package import fixture와 API index validation으로 회귀 방지 |
| typegen external refs | 외부 YAML/JSON schema-position `$ref` alias 생성 (`#/components/schemas/*`, `#/$defs/*`, 비 components schema root), nested relative ref source 기준 해소, 이름/operation 타입 충돌 시 파일명 기반 deterministic rename + 경고, unsupported pointer는 `unknown` 경고 |
| typegen 중복 방지 | schema 이름과 Op 타입 이름 충돌 시 schema 우선, 중복 생성 방지 |
| typegen const 중첩 | 중첩 프로퍼티의 `const` → 리터럴 타입 정규화 |
| additionalProperties | `Record<string, T>` + index signature 타입 생성 |
| WorkspaceIndex | 파일 hash/component/ref/source/diagnostic/type alias metadata용 index 경계. 기본 noop은 모든 파일을 dirty 처리해 기존 full rebuild 동작 유지 |
| SQLiteWorkspaceIndex | `.oa-cache/state.sqlite`에 index row를 보존. WAL/foreign key/transaction을 사용하고 schema/options mismatch 또는 DB 오류 시 full rebuild fallback |
| Workspace dirty detection | entry/domain/profile/external ref 파일 scan → new/modified/deleted/unchanged 분류 → refs.to_file 역방향 dirty 전파 → stale row invalidation |
| CLI | 커맨드 모듈 구조. `generate`/`typegen`/`router`/`client`/`lint`/`validate`/`dev`/`--help`; `validate`/`typegen`은 opt-in `--incremental --cache-dir`, `dev`는 watch mode에서 같은 index path 사용. `lint`/`validate` diagnostic은 YAML source map이 있으면 `file:line:column`을 출력하고 target `file#pointer` fallback을 유지 |

### Resolver baseline (US-001) / Shared contract (US-002) / External cache alignment (US-003)

| Surface | 현재 코드 경로 | 고정한 동작 |
|---------|----------------|-------------|
| `RefResolver` | `packages/parser/src/ref-resolver.ts`의 `createRefResolver()` → `resolvePointer()` + external YAML/JSON document cache | parser 내부 contract. internal/external/unsupported kind, JSON Pointer, cache key/document cache key, source file/pointer, target file/pointer metadata, missing/circular/read-failed diagnostic을 단일 결과 객체로 반환. public index에는 export하지 않음 |
| `resolveRefGraph()` | `packages/parser/src/ref-graph.ts`의 `collectRefs()` traversal → 공유 `RefResolver` | 내부 ref, 외부 YAML/JSON ref, 외부 파일 내부 nested ref를 graph node로 기록. 누락 pointer/read 실패와 순환은 diagnostic으로 기록하며 `$ref` sibling 내부 ref도 계속 수집 |
| `derefSpec()` | `packages/parser/src/deref.ts`의 `DerefFolder.foldRef()` → 공유 `RefResolver` + deref file cache/stack | 내부/외부 YAML/JSON ref를 인라인 전개하고 외부 파일 내부 상대 ref는 해당 파일 기준으로 해소. missing ref는 원본 `$ref` node 유지. 기본 cycle은 `{}`로 절단하고 `cycleStrategy: preserve-ref`는 ref 유지. `$ref` sibling은 해소 결과에 병합 |
| `createSourceLocationIndex()` | `packages/parser/src/source-location.ts` | YAML 문서는 AST node range와 `LineCounter`로 pointer별 line/column을 만들고, JSON 문서는 YAML 전용 metadata 없이 빈 index를 반환한다. Ref graph/lint/schema validation diagnostic source metadata, CLI diagnostic 출력, WorkspaceIndex source_locations/diagnostics line/column 보강에 사용하며 매핑이 없으면 기존 `file#pointer` 문자열로 fallback한다 |
| typegen external refs | `generateTypesFromSpec()` → `parseDocument()`(deref 없음) → `analyzeExternalSchemaRefs()` → `resolveRefGraph()` → `schemaToTs(refNameOverrides)` | 외부 YAML/JSON 문서의 schema-position `$ref`는 generated alias로 정규화한다. 지원 target은 `#/components/schemas/*`, `#/$defs/*`, `#/schemas/*`, `#/models/*`처럼 schema object를 가리키는 비 components root를 포함한다. alias 이름은 JSON Pointer 마지막 segment를 TypeScript identifier로 정규화해 사용하고, 이름 충돌/로컬 shadow/operation generated type shadow는 기존처럼 파일명 기반 deterministic rename warning에 resolved file+pointer와 생성 타입명을 포함한다. raw ref override는 entry 문서 ref에만 쓰고, 외부 schema 내부 ref는 absolute file+pointer identity로 정규화해 source 문서 기준 상대 경로를 보존한다. unsupported pointer shape은 warning과 함께 `unknown`으로 생성하고, missing/read/pointer 실패는 resolver diagnostic code와 source metadata를 유지한다 |

### WorkspaceIndex boundary (US-007) / SQLite storage (US-008) / Dirty invalidation (US-009)

| Surface | 현재 코드 경로 | 고정한 동작 |
|---------|----------------|-------------|
| `WorkspaceIndex` | `packages/codegen/src/workspace-index.ts` | parser 밖의 codegen index 경계. file hash, component, ref edge, source location, diagnostic, type alias metadata 모델을 정의 |
| `createNoopWorkspaceIndex()` / `createWorkspaceIndex()` | `packages/codegen/src/workspace-index.ts` | 기본 index는 읽기 결과를 비우고 scan 입력 전체를 changed로 반환해 기존 full rebuild 결과를 정답으로 유지. `mode: 'sqlite'`는 SQLite 구현체를 생성 |
| `createMemoryWorkspaceIndex()` | `packages/codegen/src/workspace-index.ts` | 테스트와 향후 CLI orchestration용 메모리 구현. 변경 감지와 파일 단위 metadata 교체/무효화를 제공하지만 correctness 판단의 원천은 아님 |
| `createSQLiteWorkspaceIndex()` | `packages/codegen/src/sqlite-workspace-index.ts` | `.oa-cache/state.sqlite` 기본 경로에 `meta`, `files`, `components`, `refs`, `source_locations`, `diagnostics`, `type_aliases` 테이블 생성. WAL, `busy_timeout`, foreign key, transaction-wrapped write를 사용 |
| SQLite compatibility meta | `packages/codegen/src/sqlite-workspace-index.ts` | `schema_version`, `compatibility_hash`, `compatibility_json`을 `meta`에 저장. schema/options mismatch는 cache row를 비우고 다음 diff를 full rebuild로 반환 |
| Dirty detection helpers | `packages/codegen/src/workspace-index.ts` | entry/domain/profile/external ref 파일을 absolute path + realpath + size + mtime + sha256으로 scan. index와 비교해 new/modified/deleted/unchanged를 분류하고, changed/deleted target의 `refs.to_file` 역방향 source를 dirty로 전파한 뒤 stale row invalidation 입력을 반환 |
| CLI incremental orchestration | `packages/codegen/src/cli/lib/incremental.ts` | `validate`/`typegen --incremental`과 `dev`가 동일한 scan → dirty detect → invalidate → full parser/codegen output → index refresh 경로를 사용. cache 실패나 cache miss는 출력 correctness에 영향을 주지 않고 full rebuild 결과가 우선 |

`WorkspaceIndex`는 최적화와 영향도 계산을 위한 index layer이며, component 중복, `$ref` 해소, cycle diagnostic, type alias 생성의 최종 correctness는 현재 파일 내용으로 재계산하는 full parser/codegen 경로가 담당한다. SQLite open/read/write 오류는 no-op과 같은 full rebuild fallback으로 전환하고, 실패한 write transaction은 rollback된다.

## `@oa-sdk/router` ✅

Hono/Express 스텁. `OasDocument | ParsedDocument` 입력. typegen 타입 import, JSDoc, 204.
Content-type aware 스텁 + security requirement hints. Hono 타입드 라우터 (응답/바디 타입 캐스팅).
문서화된 응답 헤더가 있으면 `Partial<XxxResponseHeaders>` stub과 header setter helper를 생성해 Hono/Express 핸들러에서 타입 힌트를 유지.
Webhook 핸들러 스텁 생성.

## `@oa-sdk/client` ✅

fetch `createClient()` + SSE `async *` generator. `OasDocument | ParsedDocument` 입력. baseUrl from servers.
NDJSON vs SSE 스트림 분리 + `resolveServerUrl` 서버 변수 해소.
ClientMiddleware (`onRequest`/`onResponse`/`onError`) 인터셉터. 문서화된 응답 헤더가 있으면 기존 body 반환 메서드는 유지하고 `withResponse.<operation>()`에서 `{ body, headers, response }`를 반환하며 `headers`는 `XxxResponseHeaders` 타입과 case-insensitive lookup을 사용. Webhook 페이로드 타입 생성.

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
oa-gen validate --spec .merged.yaml --incremental --cache-dir .oa-cache
oa-gen lint --spec .merged.yaml                    # 린트만
pnpm --filter @oa-sdk/schemas run downgrade:3.1    # 3.1 변환 (Swagger UI 호환)
```

### 코드 생성
```bash
oa-gen typegen --spec .merged.yaml -o types.ts     # TS 타입
oa-gen typegen --spec .merged.yaml -o types.ts --incremental --cache-dir .oa-cache
oa-gen router  --spec .merged.yaml -o router.ts --types-import './types'
oa-gen client  --spec .merged.yaml -o client.ts --types-import './types'
oa-gen generate --drizzle-schema ./db/schema.ts --output ./domains/users/
oa-gen dev --spec .merged.yaml --cache-dir .oa-cache
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
| Test | 8 패키지 + playground | vitest 1622 케이스 |
| Schema validate | schemas + oa-gen | 도메인 병합 + 3.1 변환 + Spectral/Redocly + 3.2 자체 검증 표준 파이프라인 |
| Freshness check | 산출물 | git diff --exit-code |
| API index | docs ↔ code | root export 정합성 + codegen typegen option subpath 검증 |
| Spec diff (PR) | base ↔ head | endpoint 변경 요약 |

---

## 테스트

| 패키지 | 케이스 |
|--------|--------|
| core | 52 |
| parser | 201 |
| codegen | 491 |
| mock-server | 561 |
| playground | 114 |
| router | 36 |
| client | 39 |
| schemas | 75 |
| typia-mock | 53 |
| **합계** | **1622** |
