# 패키지 구조

```
oa-sdk/
  packages/
    core/          @oa-sdk/core         공유 유틸 (pascalCase, toColonPath, collectTypeNames)
    parser/        @oa-sdk/parser       OAS 3.2 파서 + IR + fold + lint + query
    schemas/       @oa-sdk/schemas      도메인 분리 OAS 소스 + merge + 검증
    mock-server/   @oa-sdk/mock-server  AJV Mock 서버 (MSW + Node HTTP) + 테스트 헬퍼
    codegen/       @oa-sdk/codegen      Zod/Drizzle → OAS + typegen + CLI
    router/        @oa-sdk/router       OAS → Hono/Express 라우터 스텁
    client/        @oa-sdk/client       OAS → fetch 클라이언트 SDK
  apps/
    playground/    통합 테스트 + 데모
  docs/
    guides/        유저 가이드 (use-cases 포함)
    internal/      프로젝트 관리 SSOT
    references/    OAS 3.2 스펙 분할본
```

## 의존 그래프

```
core (0 의존)
  ↓
parser ← core
  ↓
codegen      ← core + parser + router + client
mock-server  ← core + parser
router       ← core + parser
client       ← core + parser
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
| `src/openapi.yaml` | base (info + tags + license) |
| `src/profiles/*.yaml` | 환경별 servers |
| `src/domains/*/spec.yaml` | 도메인별 paths + components |
| `scripts/merge.ts` | 도메인 병합 |
| `scripts/downgrade-3.1.ts` | 3.2→3.1 다운그레이드 |

### @oa-sdk/mock-server

| 파일 | 역할 |
|------|------|
| `src/core/request-validator.ts` | AJV 검증 + Security + style/explode |
| `src/core/response-picker.ts` | 응답 선택 + headers 전달 |
| `src/core/generate.ts` | 최소 값 생성 (Faker 미사용) |
| `src/core/stream.ts` | SSE/NDJSON 스트리밍 |
| `src/adapters/msw.ts` | MSW 어댑터 |
| `src/adapters/node-http.ts` | Node HTTP 어댑터 |
| `src/testing.ts` | createTestClient + createCoverageTracker |

### @oa-sdk/codegen

| 파일 | 역할 |
|------|------|
| `src/zod-to-schema.ts` | Zod 4 → OAS Schema |
| `src/typegen/schema-to-ts.ts` | OAS → TypeScript 타입 |
| `src/typegen/generate-types.ts` | ParsedDocument → TS 파일 |
| `src/drizzle/extractor.ts` | Drizzle 테이블 감지 |
| `src/drizzle/converter.ts` | Drizzle → Zod 변환 |
| `src/cli/index.ts` | oa-gen CLI (6개 커맨드) |

### @oa-sdk/router

| 파일 | 역할 |
|------|------|
| `src/generate-router.ts` | OAS → Hono/Express 라우터 |

### @oa-sdk/client

| 파일 | 역할 |
|------|------|
| `src/generate-client.ts` | OAS → fetch createClient() + SSE stream |
