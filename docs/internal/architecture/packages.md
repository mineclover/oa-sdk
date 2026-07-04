# 패키지 구조

```
oa-sdk/
  packages/
    openapi-projection-contract/ @oa-sdk/openapi-projection-contract OAS projection contract + validation
    core/          @oa-sdk/core         공유 유틸 (pascalCase, toColonPath, collectTypeNames)
    parser/        @oa-sdk/parser       OAS 3.2 파서 + IR + fold + lint + query
    schemas/       @oa-sdk/schemas      TypeSpec production source + Definition Builder rollback + OAS artifact 검증
    dpm/           @oa-sdk/dpm          Relationship-first Data Pseudonymization Manifest toolkit
    personas/      @oa-sdk/personas     Data Persona trait registry + persona matrix + validator
    mock-server/   @oa-sdk/mock-server  AJV Mock 서버 (MSW + Node HTTP) + 테스트 헬퍼
    codegen/       @oa-sdk/codegen      Zod/Drizzle → OAS + typegen + CLI
    router/        @oa-sdk/router       OAS → Hono/Express 라우터 스텁
    client/        @oa-sdk/client       OAS → fetch 클라이언트 SDK + 인증 + 재시도
    typia-mock/    @oa-sdk/typia-mock   typia ILlmApplication 검증 서버
    spec-lens/     @oa-sdk/spec-lens    OpenAPI spec change history + observation
    markdown-editor/ @oa-sdk/markdown-editor GLFM editor helpers + serialization
    orchestrator-gitlab/ @oa-sdk/orchestrator-gitlab GitLab-native coding-agent orchestration
    infra-gitlab/  @oa-sdk/infra-gitlab GitLab CE/Runner infrastructure preset
  apps/
    playground/    통합 테스트 + 데모
    preview/       @oa-sdk/preview  Vite 프리뷰 웹앱 (SW mock + 코드 생성)
  docs/
    guides/        유저 가이드 (use-cases 포함)
    internal/      프로젝트 관리 SSOT
    references/    OAS 3.2 스펙 분할본
```

## 패키지 카테고리

| 카테고리 | 패키지 | 소유 범위 |
|---|---|---|
| API 계약/스펙 SSOT | `@oa-sdk/schemas`, `@oa-sdk/parser`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen` | TypeSpec/OpenAPI 계약, projection envelope, 파싱/검증/생성 |
| 논리 데이터 계약 | `@oa-sdk/dpm`, `@oa-sdk/personas` | 물리 DB schema를 변경하지 않고 catalog snapshot, logical entity, relationship registry, 가명처리 policy와 API audience 의무를 정의 |
| 실행/소비자 산출물 | `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/typia-mock` | API 계약을 라우터, fetch client, mock runtime, LLM function validation server로 투영 |
| 거버넌스/관측 | `@oa-sdk/spec-lens` | 스펙 변경 이력, diff, drift 관측 |
| 운영/도구성 | `@oa-sdk/core`, `@oa-sdk/markdown-editor`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/infra-gitlab` | 공통 유틸, 편집 보조, GitLab 오케스트레이션, 인프라 preset |

`@oa-sdk/dpm`은 API 스펙 패키지의 확장이 아니라 논리 데이터 계약 패키지다. DB catalog나
OpenAPI projection은 구조적 evidence로만 소비하고, approved relationship과 namespace 정책은
DPM manifest와 Relationship Registry가 소유한다. 물리 FK 생성, DB migration, production data
rewrite는 기본 책임이 아니며, 필요하면 recommendation 또는 별도 runtime phase로 분리한다.

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
personas     ← 독립
dpm          ← openapi-projection-contract
spec-lens    ← parser + codegen
markdown-editor ← 독립
orchestrator-gitlab ← 독립
infra-gitlab ← 독립
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
| `src/parse.ts` | parseDocument() 풀 파서 (Node/full pipeline entry) |
| `src/parse-core.ts` | pipeline 후 OAS 객체 또는 browser no-deref 객체를 ParsedDocument IR로 구성하는 순수 코어 |
| `src/browser.ts` | 브라우저 안전 parser entry. no-deref parse + query/fold/route match + internal-only deref |
| `src/deref-internal.ts` | 파일시스템 없이 internal `$ref`만 인라인 전개 |
| `src/schema-loader.ts` | loadSchema() + route-match re-export |
| `src/schema-loader-browser.ts` | browser no-deref RouteIndex loader |
| `src/route-match.ts` | HTTP_METHODS + RouteIndex matchRoute() |
| `src/deref.ts` | $ref 역참조 + 순환 감지 |
| `src/fold.ts` | SchemaAlgebra + foldSchema() |
| `src/pipeline.ts` | SpecPass[] 파이프라인 |
| `src/lint.ts` | 자체 OAS 3.2 린터 |
| `src/query.ts` | findOperation, findByTag, describeApi |

### @oa-sdk/schemas

| 파일 | 역할 |
|------|------|
| `typespec/main.tsp` | production TypeSpec schema source |
| `typespec/oa-sdk.typespec-bundle.json` | production TypeSpec bundle manifest |
| `typespec/accepted-restored-drift.json` | reviewed restored-vs-reference drift manifest |
| `src/fragments/**/*.yaml` | Definition Builder rollback/reference fragments |
| `src/targets/*.yaml` | Definition Builder rollback/reference target configs |
| `src/openapi.yaml`, `src/profiles/*.yaml`, `src/domains/*/spec.yaml` | legacy merge reference material |
| `scripts/downgrade-3.1.ts` | 3.2→3.1 다운그레이드 |

### @oa-sdk/dpm

| 파일 | 역할 |
|------|------|
| `src/schema/` | DPM manifest JSON Schema, schema identity, syntax contract |
| `src/catalog/` | PostgreSQL/OpenAPI projection 기반 catalog snapshot model과 freshness hash |
| `src/discovery/` | 실행 불가능한 relationship candidate report |
| `src/registry/` | approved/proposed/rejected/deprecated/superseded relationship snapshot lifecycle |
| `src/model/` | logical entity, canonical key, relationship namespace model |
| `src/validator/` | REL/SAF semantic diagnostics without source DB access |
| `src/compiler/` | validated manifest + catalog + registry → compiled plan |
| `src/dry-run/` | raw sensitive value 없는 impact report |
| `src/gateway/` | DPM 관리 HTTP surface의 OpenAPI artifact |
| `src/publishing/` | AI schema context와 physical FK recommendation output |

### @oa-sdk/personas

| 파일 | 역할 |
|------|------|
| `src/profiles/*.profile.yaml` | 도메인별 persona profile |
| `src/data-models/*.persona.yaml` | 데이터 모델 persona matrix |
| `src/kind.ts` | persona kind taxonomy |
| `src/generate-tests.ts` | profile 기반 테스트 생성 보조 |

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
| `src/typegen/browser.ts` | 브라우저 안전 typegen entry. in-memory spec만 처리하고 외부 파일 ref graph는 import하지 않음 |
| `src/drizzle/extractor.ts` | Drizzle 테이블 감지 |
| `src/drizzle/converter.ts` | Drizzle → Zod 변환 |
| `src/cli/index.ts` | oa-gen CLI 디스패치 (커맨드 모듈 기반) |
| `src/cli/commands/*.ts` | 7개 커맨드 모듈 (generate/typegen/router/client/lint/validate/dev) |
| `src/cli/lib/*.ts` | CLI 공유 유틸 (types, args, load-spec, output, help, run, try-import) |

### @oa-sdk/router

| 파일 | 역할 |
|------|------|
| `src/generate-router.ts` | OAS → Hono/Express 라우터 |
| `src/browser.ts` | 브라우저 안전 라우터 생성 entry. in-memory spec만 처리하고 Node parser pipeline은 import하지 않음 |

### @oa-sdk/client

| 파일 | 역할 |
|------|------|
| `src/generate-client.ts` | OAS → fetch createClient() + SSE + 인증 미들웨어 + retry/timeout + validate |
| `src/browser.ts` | 브라우저 안전 클라이언트 생성 entry. in-memory spec만 처리하고 Node parser pipeline은 import하지 않음 |

### @oa-sdk/typia-mock

| 파일 | 역할 |
|------|------|
| `src/types.ts` | ILlmApplication/ILlmFunction 호환 타입 + ValidationResult |
| `src/core/validator.ts` | 3단계 파이프라인 (parse → coerce → validate) |
| `src/core/generate.ts` | typiaGenerateAlgebra + foldSchema 기반 mock 데이터 생성 |
| `src/core/function-registry.ts` | ILlmApplication 함수 조회 |
| `src/server/node-http.ts` | HTTP 검증 서버 (GET /functions, POST /validate, POST /call) |

### @oa-sdk/spec-lens

| 파일 | 역할 |
|------|------|
| `src/application/` | snapshot refresh, graph, diff, timeline query use cases |
| `src/infrastructure/` | GitHub/GitLab/local file source adapters, SQLite cache |
| `src/presentation/http/server.ts` | HTTP presentation adapter |
| `src/cli.ts` | spec observation CLI entry |

### @oa-sdk/markdown-editor

| 파일 | 역할 |
|------|------|
| `src/glfm/` | GitLab Flavored Markdown autocomplete, snippets, Plate serialization |
| `src/plate/` | Plate editor preset and commands |
| `src/core/` | editor persistence and shared types |
| `themes/*.css` | reusable editor themes |

### @oa-sdk/orchestrator-gitlab

| 파일 | 역할 |
|------|------|
| `src/cli.ts` | orchestrator CLI entry |
| `src/orchestrator.ts` | GitLab issue polling and orchestration loop |
| `src/agents/` | Codex, Claude, echo, subprocess agent adapters |
| `src/workspace.ts` | isolated workspace management |
| `src/gitlab-client.ts` | GitLab API client |
| `src/context-search.ts` | project context search |

### @oa-sdk/infra-gitlab

| 파일 | 역할 |
|------|------|
| `src/index.ts` | Pulumi GitLab CE/Runner local Docker preset |
| `src/k3s/` | k3s target configuration and runner resources |
| `src/cloud-vm/` | cloud VM target configuration and user-data |
| `src/network.ts` | network resource helpers |
| `scripts/register-runner*.sh` | GitLab runner registration scripts |
