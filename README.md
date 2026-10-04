# oa-sdk

OpenAPI 3.2 contract를 중심으로 한 API governance 인프라 모노레포.
**TypeSpec(`.tsp`)을 단일 진실 공급원(SSOT)**으로 채택하여, 도메인 스키마를 선언적으로 정의하고
엄격한 OpenAPI 3.2 아티팩트 컴파일, 검증·비교·생성·mock/runtime 테스트·review gate까지 완결합니다.
(외부 서비스의 OpenAPI/JSON Schema 호환 조각은 수집·정규화 intake 파이프라인으로 거버넌스합니다.)

현재 제품의 핵심은 `@oa-sdk/core` 위에서 schema/spec source, projection contract,
파싱·검증·생성, 변경 이력 관측과 wire contract를 연결하는 열 패키지의 Core Platform입니다.
상세한 범위와 신규 작업 승인 기준은
[`docs/internal/platform-scope.md`](./docs/internal/platform-scope.md)를 따릅니다.

> 🚀 **API 스키마 작성 5분 퀵스타트**: [TypeSpec 5분 퀵스타트 가이드](./docs/guides/typespec/01-quickstart-5min.md)  
> 🎮 **실행 가능한 실무 데모 4선**: [공식 실행 데모 가이드](./docs/examples/README.md) (`pnpm --filter @oa-sdk/playground run demo:all`)  
> ⚠️ **절대 불변 원칙**: API 계약을 변경할 때는 반드시 `packages/schemas/typespec/**/*.tsp` 원본 파일을 수정합니다. `.merged*.yaml`, `dist/` 등은 빌드 생성물이므로 절대로 직접 수정하지 마십시오.

```
┌─────────────────────────────────┐
│ TypeSpec (.tsp) Master Contract │ ──▶ API 계약 단일 진실 공급원 (SSOT, packages/schemas/typespec/)
└────────────────┬────────────────┘
                 │ (인메모리 컴파일 / AST Diff / 스냅샷 승인)
                 ▼
┌─────────────────────────────────┐
│   OpenAPI 3.2 Spec (.merged)    │ ──▶ 엄격한 계약 검증 (Spectral, Redocly, OAS 3.2 Gate)
└────────────────┬────────────────┘
                 ├──▶ 제로빌드 실시간 Mock Server (oa-gen mock --tsp ... --watch)
                 ├──▶ 런타임 오버헤드 0% TypeScript 타입 (oa-gen typegen)
                 ├──▶ 순수 핸들러 계약 (*.contract.ts) & 고성능 라우터 (Fastify / Bun Elysia)
                 └──▶ TanStack Query v5 3계층 프론트엔드 SDK 클라이언트
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
| `@oa-sdk/surface-ir` | (internal) ParsedDocument 위의 target-neutral API surface IR, Forge SDK/CLI projection, command별 OpenAPI Overlay |
| `@oa-sdk/codegen` | `oa-gen` CLI, Definition Builder target artifact, OpenAPI 수집/정규화/업그레이드/diff/review, typegen 생성, Zod/Drizzle projection bridge. router/client는 private downstream package API가 소유 |
| `@oa-sdk/spec-lens` | OpenAPI spec change history observation과 review surface 관리 |
| `@oa-sdk/spec-lens-contract` | spec-lens HTTP wire contract와 browser-safe response types |
| `@oa-sdk/typespec-decorators` | production TypeSpec source에서 검증된 OA SDK extension decorator와 플랫폼 공통 표준 계약(`contracts.tsp` / `OaSdkContracts`)을 제공 |
| `@oa-sdk/ast-sync` | TypeScript AST 양방향 동기화, type adapter, 독립형 guard 생성 |
| `@oa-sdk/tools` | JSON Schema 기반 MCP·HTTP·CLI 도구 계약과 실행 adapter |

### Downstream Integration Libraries

Core 계약을 소비하고 end-to-end 사용 가능성을 검증하는 release-tracked 계층입니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/mock-server` | OpenAPI-native mock engine, AJV validation, Security, MSW/Node HTTP adapters, 테스트 client/coverage helper |
| `@oa-sdk/router` | OAS 3.2 spec에서 Hono/Express typed server router stub 생성 |
| `@oa-sdk/client` | OAS 3.2 spec에서 typed fetch client SDK, SSE, 인증/재시도 표면 생성 |
| `@oa-sdk/chunk-stream` | bounded chunk stream, residency와 playback primitives |
| `@oa-sdk/chunk-stream-crdt` | CRDT chunk metadata와 delta 병합 |
| `@oa-sdk/chunk-stream-ui` | UI playback와 storyboard bridge |
| `@oa-sdk/chunk-stream-timeseries` | 시계열 chunk, interpolation과 decimation |
| `@oa-sdk/chunk-stream-react` | React playback·telemetry·awareness hooks |
| `@oa-sdk/peer-transport` | HTTP bridge client와 sender 기반 packet channel |
| `@oa-sdk/peer-server` | 로컬 peer registry와 인증된 HTTP RPC dispatch |
| `@oa-sdk/collab-workspace` | 인메모리 파일 lattice, presence와 intent lock |
| `@oa-sdk/mcp-mesh` | domain/session registry, tool routing과 CLI |

### Maintenance-only Separation Candidates

아래 패키지는 현재 경로와 import 호환성을 유지하되 security, compatibility, migration만
수행합니다. 새 기능은 명시적인 scope-reactivation decision이 있어야 합니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/dpm` | Relationship-first Data Pseudonymization Manifest schema와 fixture gate를 포함한 toolkit. catalog/profile/Kafka evidence를 review, approval, audit, registry/storage/gateway/publishing workflow로 연결 ([Concept](./docs/concepts/data-pseudonymization-manifest.md)) |
| `@oa-sdk/personas` | OpenAPI 위 persona matrix와 trait registry. HTTP 91개 + CLI 11개 persona, 9 trait dimension, 8 CLI, roleplay/e2e governance와 test 자동 생성 ([Concept](./docs/concepts/data-persona.md)) |
| `@oa-sdk/typia-mock` | typia `ILlmApplication` 기반 LLM function-call validation/mock server |
| `@oa-sdk/logical-erd-contract` | private TypeSpec logical-ERD prototype의 중립 artifact contract |
| `@oa-sdk/typespec-erd` | private TypeSpec logical-ERD prototype과 `oa-erd` CLI |
| `@oa-sdk/ttsc-compile-fixture` | bulk task에서 제외된 TypeScript 7 compiler fixture |
| `@oa-sdk/typespec-tooling` | TypeSpec IDE 설정·snippet과 linter 보조 |

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

### 공개 npm 패키지 사용

비공개 monorepo를 clone하지 않아도 공개된 core SDK와 CLI를 설치해 사용할 수 있다. 공개
배포는 [`mineclover/oa-sdk-releases`](https://github.com/mineclover/oa-sdk-releases)의 검증된
artifact만 사용하며, source tree·테스트·lockfile은 포함하지 않는다.

```bash
npm install @oa-sdk/core @oa-sdk/openapi-projection-contract @oa-sdk/typespec-decorators @oa-sdk/parser
npm install --save-dev @oa-sdk/codegen
npx oa-gen --help
```

현재 npm `latest`는 core/projection/decorators/parser `0.1.2`, `@oa-sdk/codegen` `0.5.0`이다.
다음 source release candidate는 `@oa-sdk/core`·`@oa-sdk/parser` `0.2.0`,
`@oa-sdk/codegen` `0.6.0`이며, artifact review와 external promotion 전에는 `latest`로
간주하지 않는다.
`@oa-sdk/schemas`, router, client, mock-server는 아직 별도 distribution decision 전의 private
workspace이므로 npm 설치 대상으로 안내하지 않는다.

### 비공개 소스 기여·검증

안정화 lane은 Node.js 24 LTS와 TypeScript 5.9.3을 사용하며, 기본 CI와 `.nvmrc`도 이 lane을
기준으로 한다. Node.js 26 Current 호환성 lane은 TypeScript 7.0.2와 `ttsc` 0.26.0으로 Core
TypeScript source와 생성 선언을 no-emit으로 검사한다. Current 릴리스는 운영
build/declaration emission을 대체하지 않으며 `.nvmrc.latest`로 선택하는 선행 호환성 검증 lane이다.

```bash
source scripts/use-node-version.sh stable # Node.js 24 LTS
source scripts/use-node-version.sh node26 # Node.js 26 Current compatibility
```

패키지 매니저는 `packageManager`에 고정된 pnpm 10.30.3을 사용합니다.

Root의 `pnpm build`, `pnpm test`, `pnpm typecheck`는 Core Platform만 검증한다. 전체
monorepo 검증은 각각 `build:all`, `test:all`, `typecheck:all`을 사용하고, 경계별 검증은
`:downstream`, `:maintenance`, `:internal` 명령을 명시적으로 선택한다. `:internal`은 남아 있는
application/reference workspace만 검증한다.

위의 공개 npm 경로는 `npx oa-gen <command>`를 사용한다. 반대로 아래 source checkout 예시는
root shell PATH에 없는 package binary를 가정하지 않고 built `node packages/codegen/dist/cli/index.js`
entrypoint를 직접 호출한다.

```bash
nvm install
nvm use
corepack pnpm --version
corepack pnpm install

# 스펙 관리 (TypeSpec 정본 워크플로)
node packages/codegen/dist/cli/index.js tsp-scaffold --route /articles --crud --envelope --file packages/schemas/typespec/articles.tsp # 엔드포인트/DTO 스캐폴딩
node packages/codegen/dist/cli/index.js mock --tsp packages/schemas/typespec/main.tsp --watch # TypeSpec 인메모리 컴파일 실시간 Mock 서버 (무빌드 핫리로드)
node packages/codegen/dist/cli/index.js tsp diff --base origin/main --head HEAD --fail-on-breaking # TypeSpec AST 시맨틱 브레이킹 체인지 검사
pnpm schema:approve-typespec-reference -- --write  # TypeSpec 검토 완료 후 승인 스냅샷(approved.openapi.yaml) 갱신
pnpm schema:validate                       # TypeSpec production source → .merged.yaml + 3.1 downgrade + Spectral/Redocly + strict OAS 3.2
pnpm schema:rollback-check                 # TypeSpec path와 Definition Builder rollback path 동시 검증
pnpm schema:bundle                         # TypeSpec-derived 3.1 artifact를 dist/openapi.{yaml,json}로 번들
pnpm --filter @oa-sdk/schemas run build:openapi # Definition Builder rollback/reference artifact 생성
node packages/codegen/dist/cli/index.js validate --spec packages/schemas/src/.merged.yaml --require-32  # 관리 대상 계약 검증 (OpenAPI 3.2 strict gate)
node packages/codegen/dist/cli/index.js validate --spec raw.yaml                                    # intake/migration 호환 검증
node packages/codegen/dist/cli/index.js lint --spec packages/schemas/src/.merged.yaml               # 린트만
node packages/codegen/dist/cli/index.js reference-check --spec packages/schemas/src/.merged.yaml    # Apitomy reference 비교 (비권위적, optional dependency)
node packages/codegen/dist/cli/index.js scaffold-governance --root apps/nestjs-ref --service nestjs-ref --profile nestjs-swagger --source-command "pnpm export:openapi"
node packages/codegen/dist/cli/index.js scaffold-governance --root apps/fastapi-ref --service fastapi-ref --profile fastapi --source-command "uv run python scripts/export_openapi.py"
node packages/codegen/dist/cli/index.js collect --spec contracts/openapi.raw.yaml --normalized contracts/openapi.normalized.yaml --upgraded contracts/openapi.upgraded.yaml --profile nestjs-swagger
node packages/codegen/dist/cli/index.js normalize --spec contracts/openapi.raw.yaml --output contracts/openapi.normalized.yaml --profile nestjs-swagger
node packages/codegen/dist/cli/index.js upgrade --spec contracts/openapi.normalized.yaml --output contracts/openapi.upgraded.yaml
node packages/codegen/dist/cli/index.js diff --base old.yaml --head packages/schemas/src/.merged.yaml --fail-on-breaking
node packages/codegen/dist/cli/index.js check-artifact --head packages/schemas/src/.merged.3.1.yaml --artifact packages/schemas/dist/openapi.yaml
node packages/codegen/dist/cli/index.js check-artifact --head packages/schemas/src/.merged.yaml --target packages/schemas/src/targets/local-parity-api.yaml --artifact packages/schemas/src/.builder/local-parity-api.yaml
node packages/codegen/dist/cli/index.js drift --runtime-openapi runtime.yaml --managed-openapi packages/schemas/src/.merged.yaml
node packages/codegen/dist/cli/index.js inventory --spec packages/schemas/src/.merged.yaml --format markdown
node packages/codegen/dist/cli/index.js behavior-query --behavior-db ./.oa-cache/behavior.sqlite --mode summary-by-behavior-decision-signal --format json
node packages/codegen/dist/cli/index.js duplicate-review --fragments packages/schemas/src/fragments --policy report --format markdown
node packages/codegen/dist/cli/index.js duplicate-review --fragments packages/schemas/src/fragments --policy ci --target packages/schemas/src/targets/public-api.yaml --format json
node packages/codegen/dist/cli/index.js target-check --target packages/schemas/src/targets/public-api.yaml --must-include-path /health --must-exclude-path /admin
node packages/codegen/dist/cli/index.js review --base old.yaml --head packages/schemas/src/.merged.3.1.yaml --artifact packages/schemas/dist/openapi.yaml
node packages/codegen/dist/cli/index.js review-bundle --base old.yaml --head packages/schemas/src/.merged.3.1.yaml --artifact packages/schemas/dist/openapi.yaml --inventory --format markdown

# reference-check는 oa-sdk 판정은 유지하고, Apitomy provider/version·입력 hash·capability·
# serialization 확인과 차이 taxonomy를 보조 리포트로 남긴다.

# 코드 생성
node packages/codegen/dist/cli/index.js typegen --spec packages/schemas/src/.merged.yaml -o types.ts
node packages/codegen/dist/cli/index.js generate --drizzle-schema ./db/schema.ts --output ./domains/users/

# private downstream router/client 통합은 apps/playground의 package API 예제로 검증

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
| [World Model Kernel](./docs/concepts/world-model.md) | World bootstrap, stimulus ingress, logical time, revision-pinned projection 계약 |
| [World Model 계약 소비](./docs/guides/use-cases/world-model-contract-consumption.md) | World Model contract 검증과 generated client/HTTP integration 준비 |
| [Onboarding Playbook (기여자 온보딩)](./docs/guides/onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩) | 저장소 목적, 정본 선택, 변경 경로와 검증 게이트 |
| [기본 스펙 사용 기준](./docs/guides/basic-spec-usage.md) | TypeSpec source, OpenAPI 3.2 artifact, 3.1 호환 출력, rollback 경계와 사용처 |
| [TypeSpec Authoring Conventions](./docs/guides/typespec-authoring-conventions.md) | TypeSpec source, approved snapshot, extension ownership과 validation 흐름 |
| [TypeSpec 가이드 시리즈](./docs/guides/typespec/01-quickstart-5min.md) | 5분 퀵스타트, 컨벤션 표준, 데코레이터/표준 계약, 스캐폴딩/diff CLI, 트러블슈팅 FAQ |
| [TypeScript 호환성](./docs/guides/typescript-compatibility.md) | Node 24/TS 5 안정화 lane과 Node 26/TS 7/`ttsc` Current 호환성 검증 lane의 경계 |
| [Artifact Release Preparation](./docs/guides/release-preparation.md) | public artifact의 version intent, source preflight, external promotion 경계 |
| [문서·스펙 거버넌스](./docs/spec-governance/README.md) | 문서 정본, 품질 기준, 검증 선택, 공식 기준 변경 절차 |
| [OpenAPI Governance Workflow](./docs/guides/use-cases/openapi-governance-workflow.md) | target sidecar + PR review gate |
| [Cloudflare Forge 지원](./docs/guides/forge-support.md) | Surface IR에서 Forge SDK/CLI projection과 OpenAPI Overlay를 생성하는 지원 범위, 사용 가능 기능, runtime 제한 |
| [Duplicate Review](./docs/guides/duplicate-review.md) | fragment 중복 탐지 정책과 CI gate |
| [NestJS Swagger / FastAPI Governance](./docs/guides/use-cases/nestjs-swagger-governance.md) | NestJS Swagger 또는 FastAPI 산출물 수집 + normalized/upgraded artifact (apps/nestjs-ref, apps/fastapi-ref) |
| [Service Governance Template](./docs/guides/openapi-governance-service-template.md) | 서비스별 OpenAPI governance 설정 템플릿 |
| [Path Fragment Conventions](./docs/guides/path-fragment-conventions.md) | path 폴더/ID/feedback 좌표 규칙 |
| [Data Persona](./docs/concepts/data-persona.md) | persona 메타 프레임워크 — `@oa-sdk/personas` 컨셉 (3-bucket × 9-dimension × link types) |
| [선언적 스펙 설정 (oa.config.ts)](./docs/guides/declarative-spec-configuration.md) | 모노레포 다중 프로파일 스펙, 정적 타입 가드, 스펙 드리프트 거버넌스 설정 |
| [CLI 명령 레퍼런스](./docs/guides/cli-command-reference.md) | 현재 `oa-gen` 명령의 목적·최소 입력·전역 `--root` 및 조건부 옵션 |
| [스키마 아키텍처 및 작성 규칙](./docs/guides/schema-architecture-and-conventions.md) | TypeSpec SSOT 마스터 스키마, 비디오 트랜지션 다형성 파라미터 표준, 4단계 프로젝션 파이프라인, 엄격한 수치 범위 및 MV3 무런타임 가드 |
| [테스트 인프라 (Test Infrastructure)](./docs/concepts/test-infrastructure.md) | 4계층 E2E 검증 모델(F01~F16), 스펙 신선도/드리프트 감지, 결정론적 SHA-256 해시, CSP 감사 게이트 |
| [Spec-Lens Platform](./docs/spec-lens/README.md) | OpenAPI 스펙 변경 이력 관측, Git 타임라인, D3 의존성 그래프, 웹 대시보드 (`@oa-sdk/spec-lens`, `apps/spec-lens`) |
| [전체 문서](./docs/README.md) | 유저 가이드 + 최적 탐색 경로 + SSOT |
| [구현 현황](./docs/internal/spec.md) | 패키지별 구현 현황 + 테스트 관리 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |

## 에이전트 스킬 (Agent Skills)

저장소는 AI 에이전트의 컨텍스트 오염을 방지하고 도메인별 최적화된 워크플로우를 제공하기 위해 Closed-by-Default 에이전트 스킬 거버넌스를 적용합니다:

- **환경 설정**: [`.agents/skills.json`](.agents/skills.json) (글로벌 화이트리스트 및 로컬 스킬 마운트)
- **도메인 모듈형 스킬**:
  - [`oa-codegen`](.agents/skills/oa-codegen/SKILL.md): AST 양방향 동기화, Trivia 보존, Typia 태그 인터섹션 파싱, Zod/TS 어댑터
  - [`oa-spec-lens`](.agents/skills/oa-spec-lens/SKILL.md): SQLite WAL 수명주기, 변경 관측, 심볼 그래프 쿼리, D3 시각화
  - [`oa-schemas`](.agents/skills/oa-schemas/SKILL.md): OpenAPI 3.1/3.2 다중 도메인 조각화, `oa://` 번들링, 순환 참조 해결
  - [`oa-runtime`](.agents/skills/oa-runtime/SKILL.md): 다운스트림 라우터 스텁, 타입드 클라이언트, 인메모리 목 서버
  - [`oa-governance`](.agents/skills/oa-governance/SKILL.md): API 페르소나 계약, DPM 패턴, Closed-by-Default 4-Tier 검증 체계
  - [`oa-sdk`](.agents/skills/oa-sdk/SKILL.md): 모노레포 루트 오케스트레이터 및 빠른 참조
- **검증 게이트**: `@spec-platform/document-gates`의 `createAgentConfigGate`가 `pnpm check:docs`에 통합되어 CI 및 로컬에서 상시 검증됩니다.
