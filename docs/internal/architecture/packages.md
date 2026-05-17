# 패키지 구조

```
oa-sdk/
  packages/
    openapi-projection-contract/ @oa-sdk/openapi-projection-contract OAS projection contract + validation
    core/          @oa-sdk/core         공유 유틸 (pascalCase, toColonPath, collectTypeNames)
    parser/        @oa-sdk/parser       OAS 3.2 파서 + IR + fold + lint + query
    schemas/       @oa-sdk/schemas      Definition Builder fragments/targets + OAS artifact 검증
    mock-server/   @oa-sdk/mock-server  AJV Mock 서버 (MSW + Node HTTP) + 테스트 헬퍼
    codegen/       @oa-sdk/codegen      Zod/Drizzle → OAS + typegen + CLI
    router/        @oa-sdk/router       OAS → Hono/Express 라우터 스텁
    client/        @oa-sdk/client       OAS → fetch 클라이언트 SDK + 인증 + 재시도
    typia-mock/    @oa-sdk/typia-mock   typia ILlmApplication 검증 서버
  apps/
    playground/    통합 테스트 + 데모
    preview/       @oa-sdk/preview  Vite 프리뷰 웹앱 (SW mock + 코드 생성)
  docs/
    guides/        유저 가이드 (use-cases 포함)
    internal/      프로젝트 관리 SSOT
    references/    OAS 3.2 스펙 분할본
```

## 의존 그래프

```
openapi-projection-contract (0 의존)
core (0 의존)
  ↓
parser ← core + openapi-projection-contract
  ↓
codegen      ← core + parser + openapi-projection-contract (+ router, client: optional peer — CLI 전용)
mock-server  ← core + parser
router       ← core + parser
client       ← core + parser
typia-mock   ← core + parser (+ typia: peer)
schemas      ← 독립
```

## 패키지별 주요 파일

→ 상세: [api-index.md](../api-index.md) (SSOT)

### @oa-sdk/core

| 파일 | 역할 |
|------|------|
| `src/strings.ts` | pascalCase, escapeKey, toColonPath |
| `src/codegen-utils.ts` | collectTypeNames |
| `src/format.ts` | formatGeneratedTs (코드 자동 정렬) |
| `src/response-utils.ts` | pickDefaultStatus |
| `src/http.ts` | createHttpServer, writeJson, readRaw, readJsonBody, ApiError, ApiErrorDetail |

### @oa-sdk/openapi-projection-contract

| 파일 | 역할 |
|------|------|
| `src/index.ts` | OpenApiProjectionResult, projection profile semantics, projection metadata extension constants, dependency-light validation |

### @oa-sdk/parser

| 파일 | 역할 |
|------|------|
| `src/types/*.ts` | OAS 3.2 전체 타입 (§별 13파일) |
| `src/types.ts` | ParsedDocument IR |
| `src/parse.ts` | parseDocument() 풀 파서 |
| `src/schema-loader.ts` | loadSchema() + matchRoute() |
| `src/deref.ts` | $ref 역참조 + 순환 감지 |
| `src/fold.ts` | SchemaAlgebra + foldSchema() |
| `src/pipeline.ts` | SpecPass[] 파이프라인 |
| `src/lint.ts` | 자체 OAS 3.2 린터 |
| `src/query.ts` | findOperation, findByTag, describeApi |

### @oa-sdk/schemas

| 파일 | 역할 |
|------|------|
| `src/fragments/**/*.yaml` | canonical definition fragments |
| `src/targets/*.yaml` | Definition Builder target configs |
| `src/openapi.yaml`, `src/profiles/*.yaml`, `src/domains/*/spec.yaml` | legacy merge reference material |
| `scripts/downgrade-3.1.ts` | 3.2→3.1 다운그레이드 |

### @oa-sdk/mock-server

| 파일 | 역할 |
|------|------|
| `src/core/request-validator.ts` | AJV 검증 + Security + style/explode |
| `src/core/response-picker.ts` | 응답 선택 + headers 전달 |
| `src/core/generate.ts` | 최소 값 생성 (Faker 미사용) |
| `src/core/stream.ts` | SSE/NDJSON 스트리밍 |
| `src/core/route-filter.ts` | 라우트 필터 (paths/operations/tags/custom) |
| `src/adapters/msw.ts` | MSW 어댑터 + createMswMockServer (override 지원) |
| `src/adapters/node-http.ts` | Node HTTP 어댑터 + response override |
| `src/browser.ts` | 브라우저용 엔트리 (Node.js 의존성 없음) |
| `src/testing.ts` | createTestClient + createCoverageTracker |

### @oa-sdk/codegen

| 파일 | 역할 |
|------|------|
| `src/zod-to-schema.ts` | Zod 4 → OAS Schema |
| `src/typegen/schema-to-ts.ts` | OAS → TypeScript 타입 (JSDoc 제약, readonly, deprecated, annotations) |
| `src/typegen/generate-types.ts` | ParsedDocument → TS 파일 (schema/Op 중복 방지) |
| `src/drizzle/extractor.ts` | Drizzle 테이블 감지 |
| `src/drizzle/converter.ts` | Drizzle → Zod 변환 |
| `src/cli/index.ts` | oa-gen CLI 디스패치 (커맨드 모듈 기반) |
| `src/cli/commands/*.ts` | 7개 커맨드 모듈 (generate/typegen/router/client/lint/validate/dev) |
| `src/cli/lib/*.ts` | CLI 공유 유틸 (types, args, load-spec, output, help, run, try-import) |

### @oa-sdk/router

| 파일 | 역할 |
|------|------|
| `src/generate-router.ts` | OAS → Hono/Express 라우터 |

### @oa-sdk/client

| 파일 | 역할 |
|------|------|
| `src/generate-client.ts` | OAS → fetch createClient() + SSE + 인증 미들웨어 + retry/timeout + validate |

### @oa-sdk/typia-mock

| 파일 | 역할 |
|------|------|
| `src/types.ts` | ILlmApplication/ILlmFunction 호환 타입 + ValidationResult |
| `src/core/validator.ts` | 3단계 파이프라인 (parse → coerce → validate) |
| `src/core/generate.ts` | typiaGenerateAlgebra + foldSchema 기반 mock 데이터 생성 |
| `src/core/function-registry.ts` | ILlmApplication 함수 조회 |
| `src/server/node-http.ts` | HTTP 검증 서버 (GET /functions, POST /validate, POST /call) |
