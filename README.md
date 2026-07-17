# oa-sdk

OpenAPI 3.2 contract를 중심으로 한 API governance 인프라 모노레포.
여러 라이브러리와 시스템이 내보내는 OpenAPI/JSON Schema 호환 조각을 수집해 하나의
OpenAPI artifact로 통합하고, metadata와 전체 path surface를 관리하며,
검증·비교·생성·mock/runtime 테스트·review gate까지 연결합니다.

현재 제품의 핵심은 `@oa-sdk/core` 위에서 schema/spec source, projection contract,
파싱·검증·생성, 변경 이력 관측을 연결하는 여섯 패키지의 Core Platform입니다.
상세한 범위와 신규 작업 승인 기준은
[`docs/internal/platform-scope.md`](./docs/internal/platform-scope.md)를 따릅니다.

```
Drizzle ORM ──▶                        ──▶ Mock Server
Zod Schema  ──▶  OpenAPI 3.2 Spec      ──▶ TypeScript 타입
               (단일 소스 + 검증)       ──▶ 서버 라우터 스텁
                                        ──▶ 클라이언트 SDK
```

## 패키지

패키지 릴리스 대상과 제외 workspace의 machine-readable 기준은
[`docs/internal/release-policy.json`](./docs/internal/release-policy.json)에 둔다.

### Core Platform

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/core` | 문자열, 포맷, 상태, codegen 보조 등 여러 패키지가 공유하는 기반 유틸리티 |
| `@oa-sdk/schemas` | TypeSpec production source, generated OpenAPI 3.2 artifact, Definition Builder rollback, 3.1 변환의 schema source package |
| `@oa-sdk/openapi-projection-contract` | Zod/Drizzle/외부 schema 조각을 OpenAPI로 투영할 때 공유하는 projection contract 타입층 |
| `@oa-sdk/parser` | OpenAPI 3.2 parse/IR/transform/fold/lint/validate/query pipeline |
| `@oa-sdk/codegen` | `oa-gen` CLI, Definition Builder target artifact, OpenAPI 수집/정규화/업그레이드/diff/review, typegen/router/client 생성, Zod/Drizzle projection bridge |
| `@oa-sdk/spec-lens` | OpenAPI spec change history observation과 review surface 관리 |

### Downstream Integration Libraries

Core 계약을 소비하고 end-to-end 사용 가능성을 검증하는 release-tracked 계층입니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/mock-server` | OpenAPI-native mock engine, AJV validation, Security, MSW/Node HTTP adapters, 테스트 client/coverage helper |
| `@oa-sdk/router` | OAS 3.2 spec에서 Hono/Express typed server router stub 생성 |
| `@oa-sdk/client` | OAS 3.2 spec에서 typed fetch client SDK, SSE, 인증/재시도 표면 생성 |

### Maintenance-only Separation Candidates

아래 패키지는 현재 경로와 import 호환성을 유지하되 security, compatibility, migration만
수행합니다. 새 기능은 명시적인 scope-reactivation decision이 있어야 합니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/dpm` | Relationship-first Data Pseudonymization Manifest schema와 fixture gate를 포함한 toolkit. catalog/profile/Kafka evidence를 review, approval, audit, registry/storage/gateway/publishing workflow로 연결 ([Concept](./docs/concepts/data-pseudonymization-manifest.md)) |
| `@oa-sdk/personas` | OpenAPI 위 persona matrix와 trait registry. 84 persona, 9 trait dimension, 8 CLI, roleplay/e2e governance와 test 자동 생성 ([Concept](./docs/concepts/data-persona.md)) |
| `@oa-sdk/typia-mock` | typia `ILlmApplication` 기반 LLM function-call validation/mock server |

### Apps And Reference Workspaces

| Workspace | 역할 |
|--------|------|
| `@oa-sdk/nestjs-ref` | NestJS Swagger 산출물을 oa-sdk governance로 수집/정규화하는 reference implementation |
| `@oa-sdk/playground` | schema pipeline과 mock server end-to-end 검증 playground |
| `@oa-sdk/preview` | preview app workspace |
| `@oa-sdk/spec-lens-ui` | `@oa-sdk/spec-lens`와 연결되는 UI app |

`apps/fastapi-ref`는 pnpm package가 아닌 FastAPI reference implementation이며 release policy
manifest 밖에서 관리합니다.

### Extracted Products

2026-07-11에 비핵심 제품을 독립 Git 저장소로 물리 분리했습니다.

| 저장소 | 소유 책임 |
|--------|----------|
| `markdown-editor` | `@oa-sdk/markdown-editor`, GLFM reference, editor PRD와 자체 build/test/release 경계 |
| `gitlab-agent-ops` | `@oa-sdk/infra-gitlab`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/orchestrator-gitlab-ui`, GitLab 운영·context 설계 문서 |

두 저장소는 `oa-sdk` workspace, release policy, CI에서 제외됩니다. `gitlab-agent-ops`는 별도
저장소인 `markdown-editor`를 submodule/workspace dependency로 소비하며 Markdown source를 복제해
소유하지 않습니다. 기존 `@oa-sdk/*` package name은 배포 namespace 결정 전까지 호환용으로 유지합니다.

## 사용 방법

개발/CI 기준 런타임은 Node.js 25 이상이며, nvm 사용자는 `.nvmrc` 기준으로 맞춘다.
패키지 매니저는 `packageManager`에 고정된 pnpm 10.30.3을 사용합니다.

Root의 `pnpm build`, `pnpm test`, `pnpm typecheck`는 Core Platform만 검증한다. 전체
monorepo 검증은 각각 `build:all`, `test:all`, `typecheck:all`을 사용하고, 경계별 검증은
`:downstream`, `:maintenance`, `:internal` 명령을 명시적으로 선택한다. `:internal`은 남아 있는
application/reference workspace만 검증한다.

```bash
nvm install
nvm use
corepack pnpm --version
corepack pnpm install

# 스펙 관리
pnpm schema:validate                       # TypeSpec production source → .merged.yaml + 3.1 downgrade + Spectral/Redocly + strict OAS 3.2
pnpm schema:rollback-check                 # TypeSpec path와 Definition Builder rollback path 동시 검증
pnpm schema:bundle                         # TypeSpec-derived 3.1 artifact를 dist/openapi.{yaml,json}로 번들
pnpm --filter @oa-sdk/schemas run build:openapi # Definition Builder rollback/reference artifact 생성
oa-gen validate --spec packages/schemas/src/.merged.yaml --require-32  # 관리 대상 계약 검증 (OpenAPI 3.2 strict gate)
oa-gen validate --spec raw.yaml                                    # intake/migration 호환 검증
oa-gen lint --spec packages/schemas/src/.merged.yaml               # 린트만
oa-gen reference-check --spec packages/schemas/src/.merged.yaml    # Apitomy reference 비교 (비권위적, optional dependency)
oa-gen scaffold-governance --root apps/nestjs-ref --service nestjs-ref --profile nestjs-swagger --source-command "pnpm export:openapi"
oa-gen scaffold-governance --root apps/fastapi-ref --service fastapi-ref --profile fastapi --source-command "uv run python scripts/export_openapi.py"
oa-gen collect --spec contracts/openapi.raw.yaml --normalized contracts/openapi.normalized.yaml --upgraded contracts/openapi.upgraded.yaml --profile nestjs-swagger
oa-gen normalize --spec contracts/openapi.raw.yaml --output contracts/openapi.normalized.yaml --profile nestjs-swagger
oa-gen upgrade --spec contracts/openapi.normalized.yaml --output contracts/openapi.upgraded.yaml
oa-gen diff --base old.yaml --head packages/schemas/src/.merged.yaml --fail-on-breaking
oa-gen check-artifact --head packages/schemas/src/.merged.yaml --artifact packages/schemas/dist/openapi.yaml
oa-gen check-artifact --head packages/schemas/src/.merged.yaml --target packages/schemas/src/targets/local-parity-api.yaml --artifact packages/schemas/src/.builder/local-parity-api.yaml
oa-gen drift --runtime-openapi runtime.yaml --managed-openapi packages/schemas/src/.merged.yaml
oa-gen inventory --spec packages/schemas/src/.merged.yaml --format markdown
oa-gen behavior-query --behavior-db ./.oa-cache/behavior.sqlite --mode summary-by-behavior-decision-signal --format json
oa-gen duplicate-review --fragments packages/schemas/src/fragments --policy report --format markdown
oa-gen duplicate-review --fragments packages/schemas/src/fragments --policy ci --target packages/schemas/src/targets/public-api.yaml --format json
oa-gen target-check --target packages/schemas/src/targets/public-api.yaml --must-include-path /health --must-exclude-path /admin
oa-gen review --base old.yaml --head packages/schemas/src/.merged.yaml --artifact packages/schemas/dist/openapi.yaml
oa-gen review-bundle --base old.yaml --head packages/schemas/src/.merged.yaml --artifact packages/schemas/dist/openapi.yaml --inventory --format markdown

# reference-check는 oa-sdk 판정은 유지하고, Apitomy provider/version·입력 hash·capability·
# serialization 확인과 차이 taxonomy를 보조 리포트로 남긴다.

# 코드 생성
oa-gen typegen --spec packages/schemas/src/.merged.yaml -o types.ts
oa-gen router  --spec packages/schemas/src/.merged.yaml -o router.ts --types-import './types'
oa-gen client  --spec packages/schemas/src/.merged.yaml -o client.ts --types-import './types'
oa-gen generate --drizzle-schema ./db/schema.ts --output ./domains/users/

# Mock 테스트
pnpm mock:start

# Persona governance — spec ↔ persona 매트릭스 ↔ e2e
pnpm personas:check                                       # merge → bind → validate
pnpm personas:coverage                                    # cross-cut 리포트 (markdown)
pnpm --filter @oa-sdk/personas flow                       # 의존성 그래프 (mermaid)
pnpm --filter @oa-sdk/personas propose                    # orphan → stub 자동
pnpm --filter @oa-sdk/personas gen:tests                  # vitest e2e 매트릭스 자동

# 3.1 호환 (Swagger UI)
pnpm --filter @oa-sdk/schemas run downgrade:3.1

# 데모 (API 구조 + Mock 서버 12시나리오 + 커버리지)
pnpm demo

# DPM 데모 (가명처리 manifest 검증 + compile + dry-run)
pnpm demo:dpm

# DPM storage 데모 (catalog profiler + registry/job/report persistence)
pnpm demo:dpm:storage
```

## 테스트에서 사용

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, createCoverageTracker } from '@oa-sdk/mock-server'
import { parseDocument, describeApi } from '@oa-sdk/parser'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)

const res = await client.post('/users', { name: 'Alice', email: 'a@b.com' },
  { headers: { authorization: 'Bearer token' } })
expect(res.status).toBe(201)

// API 구조 탐색
console.log(describeApi(parseDocument(spec)))
```

## 문서

| 문서 | |
|------|-|
| [Vision](./docs/vision.md) | 핵심 철학과 주 목표 |
| [Platform Scope](./docs/internal/platform-scope.md) | Core Platform, maintenance, 분리 경계와 신규 작업 승인 기준 |
| [Concepts](./docs/concepts.md) | 공통 용어와 계약 경계 |
| [Quick Start](./docs/guides/quick-start.md) | 5분 파이프라인 체험 |
| [OpenAPI Governance Workflow](./docs/guides/use-cases/openapi-governance-workflow.md) | target sidecar + PR review gate |
| [Duplicate Review](./docs/guides/duplicate-review.md) | fragment 중복 탐지 정책과 CI gate |
| [NestJS Swagger / FastAPI Governance](./docs/guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger 또는 FastAPI 산출물 수집 + normalized/upgraded artifact (apps/nestjs-ref, apps/fastapi-ref) |
| [Service Governance Template](./docs/guides/openapi-governance-service-template.md) | 서비스별 OpenAPI governance 설정 템플릿 |
| [Path Fragment Conventions](./docs/guides/path-fragment-conventions.md) | path 폴더/ID/feedback 좌표 규칙 |
| [Data Persona](./docs/concepts/data-persona.md) | persona 메타 프레임워크 — `@oa-sdk/personas` 컨셉 (3-bucket × 9-dimension × link types) |
| [전체 문서](./docs/README.md) | 유저 가이드 + SSOT |
| [구현 현황](./docs/internal/spec.md) | 패키지별 구현 현황 + 테스트 관리 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |
