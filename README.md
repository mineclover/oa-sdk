# oa-sdk

OpenAPI 3.2 contract를 중심으로 한 API governance 인프라 모노레포.
여러 라이브러리와 시스템이 내보내는 OpenAPI/JSON Schema 호환 조각을 수집해 하나의
OpenAPI artifact로 통합하고, metadata와 전체 path surface를 관리하며,
검증·비교·생성·mock/runtime 테스트·review gate까지 연결합니다.

```
Drizzle ORM ──▶                        ──▶ Mock Server
Zod Schema  ──▶  OpenAPI 3.2 Spec      ──▶ TypeScript 타입
               (단일 소스 + 검증)       ──▶ 서버 라우터 스텁
                                        ──▶ 클라이언트 SDK
```

## 패키지

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/core` | 공유 유틸 (문자열, 코드젠, 포맷, 응답 상태) |
| `@oa-sdk/schemas` | 도메인 분리 OAS 3.2 소스 + merge + 3.1↔3.2 변환 |
| `@oa-sdk/parser` | OAS 3.2 파서 + IR + fold + lint + validate + query |
| `@oa-sdk/mock-server` | AJV Mock 서버 (MSW + Node HTTP) + Security + 테스트 헬퍼 |
| `@oa-sdk/codegen` | Zod/Drizzle → OAS + Definition Builder target artifact + 외부 OpenAPI 수집/업그레이드 + OAS → TS 타입 + oa-gen CLI 21커맨드 |
| `@oa-sdk/router` | OAS → Hono/Express 라우터 스텁 |
| `@oa-sdk/client` | OAS → fetch 클라이언트 SDK + SSE + 인증 미들웨어 + 재시도 |
| `@oa-sdk/typia-mock` | typia ILlmApplication 기반 LLM 함수 호출 검증 서버 |
| `@oa-sdk/personas` | OpenAPI 위 persona 매트릭스 — 84 페르소나 / 9 trait dimension / 8 CLI / e2e roleplay 자동 생성 ([Concept](./docs/concepts/data-persona.md)) |
| `@oa-sdk/infra-gitlab` | Pulumi preset — 로컬 Docker에 GitLab CE Omnibus + Runner 기동 ([README](./packages/infra-gitlab/README.md) · [Operations](./packages/infra-gitlab/OPERATIONS.md) · [TODO](./docs/internal/todo.md#infra-gitlab-잔여-항목)). 자율 코딩 에이전트(Symphony 계열)용 DevOps substrate Phase 1. |

## 사용 방법

```bash
pnpm install

# 스펙 관리
pnpm --filter @oa-sdk/schemas run merge    # 도메인 병합
oa-gen validate --spec .merged.yaml        # 종합 검증 (3.2 + 3.1 호환)
oa-gen lint --spec .merged.yaml            # 린트만
oa-gen scaffold-governance --root apps/nestjs-ref --service nestjs-ref --profile nestjs-swagger --source-command "pnpm export:openapi"
oa-gen scaffold-governance --root apps/fastapi-ref --service fastapi-ref --profile fastapi --source-command "uv run python scripts/export_openapi.py"
oa-gen collect --spec contracts/openapi.raw.yaml --normalized contracts/openapi.normalized.yaml --upgraded contracts/openapi.upgraded.yaml --profile nestjs-swagger
oa-gen normalize --spec contracts/openapi.raw.yaml --output contracts/openapi.normalized.yaml --profile nestjs-swagger
oa-gen upgrade --spec contracts/openapi.normalized.yaml --output contracts/openapi.upgraded.yaml
oa-gen diff --base old.yaml --head .merged.yaml --fail-on-breaking
oa-gen check-artifact --head .merged.yaml --artifact dist/openapi.yaml
oa-gen check-artifact --head .merged.yaml --target packages/schemas/src/targets/local-parity-api.yaml --artifact packages/schemas/src/.builder/local-parity-api.yaml
oa-gen drift --runtime-openapi runtime.yaml --managed-openapi .merged.yaml
oa-gen inventory --spec .merged.yaml --format markdown
oa-gen behavior-query --behavior-db ./.oa-cache/behavior.sqlite --mode summary-by-behavior-decision-signal --format json
oa-gen duplicate-review --fragments packages/schemas/src/fragments --format markdown
oa-gen target-check --target packages/schemas/src/targets/public-api.yaml --must-include-path /health --must-exclude-path /admin
oa-gen review --base old.yaml --head .merged.yaml --artifact dist/openapi.yaml
oa-gen review-bundle --base old.yaml --head .merged.yaml --artifact dist/openapi.yaml --inventory --format markdown

# 코드 생성
oa-gen typegen --spec .merged.yaml -o types.ts
oa-gen router  --spec .merged.yaml -o router.ts --types-import './types'
oa-gen client  --spec .merged.yaml -o client.ts --types-import './types'
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
| [Concepts](./docs/concepts.md) | 공통 용어와 계약 경계 |
| [Quick Start](./docs/guides/quick-start.md) | 5분 파이프라인 체험 |
| [OpenAPI Governance Workflow](./docs/guides/use-cases/openapi-governance-workflow.md) | target sidecar + PR review gate |
| [NestJS Swagger / FastAPI Governance](./docs/guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger 또는 FastAPI 산출물 수집 + normalized/upgraded artifact (apps/nestjs-ref, apps/fastapi-ref) |
| [Service Governance Template](./docs/guides/openapi-governance-service-template.md) | 서비스별 OpenAPI governance 설정 템플릿 |
| [Path Fragment Conventions](./docs/guides/path-fragment-conventions.md) | path 폴더/ID/feedback 좌표 규칙 |
| [Data Persona](./docs/concepts/data-persona.md) | persona 메타 프레임워크 — `@oa-sdk/personas` 컨셉 (3-bucket × 9-dimension × link types) |
| [전체 문서](./docs/README.md) | 유저 가이드 + SSOT |
| [구현 현황](./docs/internal/spec.md) | 패키지별 구현 현황 + 테스트 관리 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |
