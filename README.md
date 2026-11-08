# oa-sdk

oa-sdk는 API 계약을 관리하는 도구 모음입니다. 사람이 고치는 원본을 하나로 정하고, 그 원본에서 만드는 OpenAPI 문서, TypeScript 타입, 클라이언트, 핸들러 계약을 다시 만들 수 있는 생성물로 다룹니다. 이 저장소의 production 계약은 TypeSpec(`.tsp`)으로 작성하고 OpenAPI 3.2 문서를 생성합니다([ADR-009](./docs/internal/architecture/009-typespec-first-authoring.md)). 사용자 프로젝트는 `oa.config.ts`에 TypeSpec, OpenAPI YAML/JSON, Zod 스키마 모듈 중 하나를 원본으로 지정합니다.

- **고칠 곳은 한 곳**: 계약은 원본에서만 고치고 생성물은 다시 만듭니다. 이 저장소에서는 `.merged*.yaml`과 `dist/`가 생성물이며, CI가 원본과 어긋난 생성물을 실패시킵니다.
- **이미 있는 스키마에서 시작**: 기존 OpenAPI 문서로 바로 검증과 타입 생성을 시작합니다. NestJS·FastAPI가 내보낸 OpenAPI는 `oa-gen collect`로 정규화해 그 서비스의 계약으로 관리합니다.
- **같은 parser로 해석**: 코드 생성과 mock 서버가 `@oa-sdk/parser` 하나로 route와 `$ref`를 해석합니다.
- **계약에서 소비자 코드까지**: `oa-gen`이 타입, Zod 스키마, 타입 가드, 클라이언트, TanStack Query 옵션, 핸들러 계약을 만들고, `oa-gen mock`이 같은 계약으로 요청을 검증하는 mock 서버를 띄웁니다.
- **변경은 기계가 먼저 분류**: `oa-gen diff`와 `oa-gen tsp diff`(`--fail-on-breaking`), `check-artifact`, `drift`가 breaking change, 원본과 어긋난 생성물, runtime drift를 종료 코드로 알립니다.

oa-sdk는 비즈니스 로직을 대신 쓰거나 API를 호스팅하지 않습니다. 공개 패키지는 Node.js 22 이상에서 동작하며, 설치와 첫 실행은 [Quick Start](./docs/guides/quick-start.md)를 따릅니다. 가치별 동작 방식과 근거, oa-sdk가 하지 않는 일은 [가이드 색인](./docs/guides/README.md#oa-sdk가-해결하는-문제와-핵심-가치)에 정리했습니다. 패키지 범위와 신규 작업 승인 기준은 [Platform Scope](./docs/internal/platform-scope.md)를 따릅니다.

> 🚀 **다른 프로젝트에서 시작**: [Quick Start](./docs/guides/quick-start.md) — npm 설치부터 검증·타입 생성·mock 서버까지
>
> 🗺️ **기능부터 고르기**: [기능 선택 지도](./docs/guides/feature-map.md) — 계약 입력 → 코드 생성 → 실행·도구 연결 → 검증·리뷰 → 런타임 지원
>
> 🧩 **이 저장소에 기여**: [기여자 온보딩](./docs/guides/onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩), [TypeSpec 기여 워크플로](./docs/guides/typespec/01-quickstart-5min.md) — `packages/schemas`의 production 계약 수정
>
> 🎮 **실행 데모**: [실행 데모 가이드](./docs/examples/README.md) (저장소 안에서 `pnpm --filter @oa-sdk/playground run demo:all`로 데모 7개 실행)
>
> ⚠️ **이 저장소의 원칙**: API 계약을 바꿀 때는 `packages/schemas/typespec/**/*.tsp` 원본을 수정합니다. `.merged*.yaml`, `dist/` 등은 생성물이므로 직접 수정하지 않습니다.

이 저장소의 계약 흐름은 다음과 같습니다.

```
┌─────────────────────────────────┐
│ TypeSpec (.tsp) Master Contract │ ──▶ 원본 (packages/schemas/typespec/)
└────────────────┬────────────────┘
                 │ (인메모리 컴파일 / TypeSpec diff / 승인 snapshot)
                 ▼
┌─────────────────────────────────┐
│   OpenAPI 3.2 Spec (.merged)    │ ──▶ 계약 검증 (Spectral, Redocly, OAS 3.2 gate)
└────────────────┬────────────────┘
                 ├──▶ mock 서버 (oa-gen mock --tsp ... --watch)
                 ├──▶ TypeScript 타입 (oa-gen typegen)
                 ├──▶ 핸들러 계약 *.contract.ts, fetch 클라이언트, TanStack Query 키·옵션 (oa-gen generate)
                 └──▶ 프레임워크 라우터 코드 (@oa-sdk/router generateRouter(), 빌드 스크립트에서 호출)
```

교차 플랫폼 시맨틱 추상화·스키마 선언 책임 경계는 아래와 같으며, 상세 참조 차원·소비자 매핑은 [시맨틱 추상화 계약과 스키마 선언 책임 경계](./docs/internal/architecture/semantic-abstraction-contract-boundary.md) 및 [Contract Ownership Boundaries](./docs/internal/contract-boundaries.md)를 따릅니다(문서 경계 선언은 신규 공통 스키마/API 채택이나 codegen 배포를 뜻하지 않습니다).

| 소유 주체 (Owner) | 정본 (Source of Truth) | 파생 산출물 (Generated / Projected Artifact) | 경계 원칙 |
|---|---|---|---|
| **Semantic Platform** | 의미·추상화(`Term`·`Expression`·`SemanticFrame`·`ReusablePattern`·`DomainConcept`·`Assertion`·`Projection`) 및 `revision`·`catalog`·`pin` | 판본 고정 의미 참조 식별자·스냅샷 | 의미 채택·동치 판정의 유일한 권위; `oa-sdk`에서 재정의 금지 |
| **`oa-sdk`** | 승인된 계약의 TypeSpec(`.tsp`)·불변 JSON Schema 선언 및 호환성 규칙 | `approved.openapi.yaml`, `.merged*.yaml`, TS 타입·가드·Zod·client/router, `.oa-trace.json`/`.oa-manifest.json` | 구조·와이어 적합성과 `sourceRevision`/digest 추적만 담당; 이름·임베딩으로 의미 동치 추론 금지 |
| **도메인 플랫폼 & 타깃 어댑터** | 원천 표현 수집, 도메인 바인딩 매니페스트, 타깃별 투영 규약 | Snowflake Semantic View, RDF/OWL, Neo4j/Cypher, Prompt/QA/UI 투영과 관측 증적 | 각 타깃 프로젝션은 별도 어댑터 계약이며 `oa-sdk` 코어 정본이 아님 |

## 패키지

패키지 릴리스 대상과 제외 workspace의 machine-readable 기준은
[`docs/internal/release-policy.json`](./docs/internal/release-policy.json)에 둔다. 패키지별 배포 상태(npm 배포,
`@oa-sdk/codegen` 0.9.0 릴리스부터 배포, 배포 후보, 비공개)는 [라이브러리 진입점 지도](./docs/guides/library-entrypoints.md)가
정리한다. 구현·배포 후보·공개 import는 실제 npm 배포와 별개이며, 설치 직전 registry 버전을 확인한다.
이 저장소의 source version이나 [변경 이력](./docs/changelog.md)만으로 현재 npm 버전을 단정하지 않는다.

### Core Platform

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/core` | 문자열, 포맷, 상태, codegen 보조 등 여러 패키지가 공유하는 기반 유틸리티 |
| `@oa-sdk/schemas` | (비공개, 저장소 전용) TypeSpec production source, generated OpenAPI 3.2 artifact, Definition Builder rollback, 3.1 변환의 schema source package |
| `@oa-sdk/openapi-projection-contract` | Zod/Drizzle/외부 schema 조각을 OpenAPI로 투영할 때 공유하는 projection contract 타입층 |
| `@oa-sdk/parser` | OpenAPI 3.2 parse/IR/transform/fold/lint/validate/query pipeline |
| `@oa-sdk/surface-ir` | ParsedDocument 위의 target-neutral API surface IR, Forge SDK/CLI projection, command별 OpenAPI Overlay. `@oa-sdk/codegen`의 런타임 의존성으로 함께 설치되며 `oa-gen surface`가 사용 |
| `@oa-sdk/codegen` | `oa-gen` CLI, Definition Builder target artifact, OpenAPI 수집/정규화/업그레이드/diff/review, typegen 생성, Zod/Drizzle projection bridge. 핸들러 계약·클라이언트·mock 서버는 `oa-gen`이 실행 중 불러오는 동반 패키지(`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, 별도 설치)가 만든다 |
| `@oa-sdk/spec-lens` | (비공개, 저장소 전용) OpenAPI spec change history observation과 review surface 관리 |
| `@oa-sdk/spec-lens-contract` | (비공개, 저장소 전용) spec-lens HTTP wire contract와 browser-safe response types |
| `@oa-sdk/typespec-decorators` | production TypeSpec source에서 검증된 OA SDK extension decorator와 플랫폼 공통 표준 계약(`contracts.tsp`, 데코레이터와 같은 namespace `OaSdkTypeSpec`)을 제공 |
| `@oa-sdk/ast-sync` | TypeScript AST 양방향 동기화, type adapter, 독립형 guard 생성 |
| `@oa-sdk/tools` | JSON Schema 기반 MCP·HTTP·CLI 도구 계약과 실행 adapter |

### Downstream Integration Libraries

Core 계약을 소비하고 end-to-end 사용 가능성을 검증하는 release-tracked 계층입니다.
`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `@oa-sdk/codegen` 0.9.0 릴리스부터의
배포 대상입니다. `@oa-sdk/peer-transport`, `@oa-sdk/peer-server`, `@oa-sdk/webmcp-peer`,
`@oa-sdk/collab-workspace`, `@oa-sdk/mcp-mesh`, `@oa-sdk/telemetry`는 배포 후보이며,
`@oa-sdk/rpc`와 `@oa-sdk/popup-bridge`는 비공개 workspace입니다. 실제 설치 가능 버전은 registry에서 확인합니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/mock-server` | OpenAPI-native mock engine, AJV validation, Security, 테스트 client/coverage helper. Node HTTP adapter는 패키지 루트와 `/adapters/node-http`, MSW adapter는 `/adapters/msw`·`/browser`(선택적 peer `msw` 필요) |
| `@oa-sdk/router` | OAS 3.1/3.2 spec에서 Hono/Express/Fastify/Elysia 라우터 코드(`generateRouter()`)와 프레임워크와 무관한 핸들러 계약(`generateHandlerContract()`)을 만드는 빌드 타임 생성 함수 |
| `@oa-sdk/client` | OAS 3.1/3.2 spec에서 typed fetch client SDK, SSE, 인증/재시도 표면과 TanStack Query v5 키·옵션·훅 생성 |
| `@oa-sdk/chunk-stream` | bounded chunk stream, residency와 playback primitives |
| `@oa-sdk/chunk-stream-crdt` | CRDT chunk metadata와 delta 병합 |
| `@oa-sdk/chunk-stream-ui` | UI playback와 storyboard bridge |
| `@oa-sdk/chunk-stream-timeseries` | 시계열 chunk, interpolation과 decimation |
| `@oa-sdk/chunk-stream-react` | React playback·telemetry·awareness hooks |
| `@oa-sdk/peer-transport` | HTTP bridge client와 sender 기반 packet channel |
| `@oa-sdk/peer-server` | 로컬 peer registry와 인증된 HTTP RPC dispatch |
| `@oa-sdk/webmcp-peer` | room 기반 MCP router/relay, 브라우저·호스트 provider, 외부 에이전트 client와 승인·catalog 경계 (호스팅 서비스 아님) |
| `@oa-sdk/collab-workspace` | 인메모리 파일 lattice, presence와 intent lock |
| `@oa-sdk/mcp-mesh` | domain/session registry, tool routing과 CLI |
| `@oa-sdk/telemetry` | 추적 심볼 registry, XState v5 inspector, dispatcher와 HMAC sanitizer (`@oa-sdk/dpm` 의존성 없음) |
| `@oa-sdk/rpc` | (비공개, 저장소 전용) typed unary RPC client/server, JSON-RPC 2.0·REST binding (streaming 제외) |
| `@oa-sdk/popup-bridge` | (비공개, 저장소 전용) 별도 Origin 팝업을 여는 Origin 검증 핸드셰이크, `MessageChannel` 위 양방향 JSON-RPC, 계약 기반 타입 선언·RPC 생성 유틸리티 |

### Maintenance-only Separation Candidates

아래 패키지는 비공개 유지보수 패키지(maintenance-only, 저장소 전용)입니다. npm에 배포하지 않으며,
현재 경로와 import 호환성을 유지하되 security, compatibility, migration만 수행합니다. 새 기능은 명시적인
scope-reactivation decision이 있어야 합니다.

| 패키지 | 역할 |
|--------|------|
| `@oa-sdk/dpm` | Relationship-first DPM 계약·catalog/profile·review workflow의 비공개 maintenance/source compatibility mirror. 신규 기능·배포는 외부 `data-governance`가 소유 ([Concept](./docs/concepts/data-pseudonymization-manifest.md)) |
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

DPM의 canonical owner는 별도 공개 저장소 [mineclover/data-governance](https://github.com/mineclover/data-governance)입니다.
이 저장소의 비공개 `@oa-sdk/dpm` mirror를 외부의 같은 이름 npm 패키지와 버전·기능이 같다고 보지 않습니다.
외부 DPM의 파일 기반 read-only CLI는 DB 없이 동작하며, 상시·공유 검색은
[미래 TODO](https://github.com/mineclover/data-governance/blob/main/docs/internal/goals/shared-search-todo.md)입니다.
Spec-Lens의 로컬 SQLite 캐시와 이 미래 검색 서비스는 별개입니다.

## 사용 방법

### 공개 npm 패키지 사용

비공개 monorepo를 clone하지 않아도 npm에 배포된 패키지로 `oa-gen` CLI와 라이브러리를 쓸 수 있다. 공개
배포는 [`mineclover/oa-sdk-releases`](https://github.com/mineclover/oa-sdk-releases)의 검증된
artifact만 사용하며, source tree·테스트·lockfile은 포함하지 않는다. 공개 패키지는 Node.js 22 이상에서
동작한다.

```bash
# CLI와 동반 패키지(handler contract, client SDK, mock 서버 생성에 필요)
npm install --save-dev @oa-sdk/codegen @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server
npx oa-gen --help
```

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/surface-ir`는 `@oa-sdk/codegen` 0.9.0
릴리스부터의 배포 대상으로 안내되어 있다. 실제 설치 가능한 버전은 registry에서 확인한다.
`@oa-sdk/codegen`은 `@oa-sdk/core`, `@oa-sdk/parser` 등
런타임 의존성을 함께 설치하므로, 라이브러리 API를 직접 import할 때만 해당 패키지를 따로 추가한다.

동반 패키지(companion package)는 `oa-gen`이 핸들러 계약, 클라이언트 SDK, mock 서버를 만들 때 불러오는
패키지이며 `@oa-sdk/codegen`을 설치해도 함께 설치되지 않는다. 어떤 `oa-gen` 명령에 어떤 동반 패키지가
필요한지와 없을 때의 동작은 [CLI 설정 가이드](docs/guides/cli-setup.md#동반-패키지-companion-packages)를
따른다. `@oa-sdk/schemas`, `@oa-sdk/spec-lens`, `pnpm schema:*` 명령은 이 저장소 안에서만 쓴다(npm에
배포하지 않음).

### 비공개 소스 기여·검증

안정화 lane은 Node.js 24 LTS와 TypeScript 5.9.3을 사용하며, 기본 CI와 `.nvmrc`도 이 lane을
기준으로 한다. Node.js 26 Current 호환성 lane은 TypeScript 7.0.2와 `ttsc` 0.26.0으로 Core
TypeScript source와 생성 선언을 no-emit으로 검사한다. Current 릴리스는 운영
build/declaration emission을 대체하지 않으며 `.nvmrc.latest`로 선택하는 선행 호환성 검증 lane이다.

```bash
source scripts/use-node-version.sh stable # Node.js 24 LTS
source scripts/use-node-version.sh node26 # Node.js 26 Current compatibility
```

패키지 매니저는 `packageManager`에 고정된 pnpm 11.28.6을 사용합니다.

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
# tsp-scaffold --file은 이미 있는 파일에만 추가하고 import·using 줄을 붙이지 않는다.
# articles.tsp는 @typespec/http·@typespec/openapi·@oa-sdk/typespec-decorators import와
# using Http; using OpenAPI; using OaSdkTypeSpec; namespace OaSdkApi;를 갖춰 먼저 만들고 main.tsp에서 import한다.
node packages/codegen/dist/cli/index.js tsp-scaffold --route /articles --crud --envelope --file packages/schemas/typespec/articles.tsp # 엔드포인트/DTO 스캐폴딩
node packages/codegen/dist/cli/index.js mock --tsp packages/schemas/typespec/main.tsp --watch # TypeSpec 인메모리 컴파일 실시간 Mock 서버 (무빌드 핫리로드)
node packages/codegen/dist/cli/index.js tsp diff --base origin/main:packages/schemas/typespec/main.tsp --head packages/schemas/typespec/main.tsp --fail-on-breaking # 커밋 전 변경까지 포함한 TypeSpec 의미 단위 breaking change 검사
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
node packages/codegen/dist/cli/index.js generate:pydantic --spec packages/schemas/src/.merged.yaml --out generated/pydantic # OAS 3.2 schema·operation → Pydantic v2 타입
node packages/codegen/dist/cli/index.js generate --drizzle-schema ./db/schema.ts --output ./domains/users/

# 동반 패키지 API(@oa-sdk/router generateRouter, @oa-sdk/client generateClient) 통합은 apps/playground/tests에서 검증
pnpm --filter @oa-sdk/playground test

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

Pydantic 타입 생성 옵션과 범위는 [Pydantic 코드 생성 가이드](./docs/guides/pydantic-codegen.md)를 따른다.

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
| [Contract Ownership Boundaries](./docs/internal/contract-boundaries.md) | TypeSpec·OpenAPI·runtime·외부 소유자 계약 경계 |
| [시맨틱 추상화·스키마 선언 책임 경계](./docs/internal/architecture/semantic-abstraction-contract-boundary.md) | Semantic Platform 의미 정본과 `oa-sdk` 스키마 선언·codegen·타깃 어댑터 책임 분리 |
| [Concepts](./docs/concepts.md) | 공통 용어와 계약 경계 |
| [Quick Start](./docs/guides/quick-start.md) | 다른 프로젝트에서 설치부터 검증·생성·mock 서버까지 |
| [가이드 색인](./docs/guides/README.md) | 핵심 가치, 시작하기, 역할별 읽기 경로 |
| [World Model Kernel](./docs/concepts/world-model.md) | World bootstrap, stimulus ingress, logical time, revision-pinned projection 계약 |
| [World Model 계약 소비](./docs/guides/use-cases/world-model-contract-consumption.md) | World Model contract 검증과 generated client/HTTP integration 준비 |
| [Onboarding Playbook (프로젝트 도입)](./docs/guides/onboarding-playbook.md) | 기존·신규 프로젝트에 단계적으로 도입하는 순서와 프레임워크 연결 레시피 |
| [Onboarding Playbook (기여자 온보딩)](./docs/guides/onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩) | 저장소 목적, 정본 선택, 변경 경로와 검증 게이트 |
| [기본 스펙 사용 기준](./docs/guides/basic-spec-usage.md) | TypeSpec source, OpenAPI 3.2 artifact, 3.1 호환 출력, rollback 경계와 사용처 |
| [TypeSpec Authoring Conventions](./docs/guides/typespec-authoring-conventions.md) | TypeSpec source, approved snapshot, extension ownership과 validation 흐름 |
| [TypeSpec 가이드 시리즈](./docs/guides/typespec/01-quickstart-5min.md) | 이 저장소의 TypeSpec 기여 워크플로, 컨벤션 표준, 데코레이터/표준 계약, 스캐폴딩/diff CLI, 트러블슈팅 FAQ |
| [TypeScript 호환성](./docs/guides/typescript-compatibility.md) | 공개 패키지 사용자 요구사항(Node.js 22 이상)과 저장소의 Node 24/TS 5 안정화 lane, Node 26/TS 7/`ttsc` 호환성 검증 lane |
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
| [`ttsc-ex` · `oa-sdk` · `context-action` 책임 분리 및 동기화 가이드](./docs/guides/ttsc-ex-delegation-and-sync-guide.md) | 3대 워크스페이스 단일 책임 분리 원칙, `.tsp` 도메인 데코레이터/코드젠 위임 매트릭스 및 자율 Pull 동기화 흐름 |
| [테스트 인프라 (Test Infrastructure)](./docs/concepts/test-infrastructure.md) | 4계층 E2E 검증 모델(F01~F16), 스펙 신선도/드리프트 감지, 결정론적 SHA-256 해시, CSP 감사 게이트 |
| [Spec-Lens Platform](./docs/spec-lens/README.md) | OpenAPI 스펙 변경 이력 관측, Git 타임라인, D3 의존성 그래프, 웹 대시보드 (`@oa-sdk/spec-lens`, `apps/spec-lens`) |
| [전체 문서](./docs/README.md) | 유저 가이드 + 최적 탐색 경로 + SSOT |
| [구현 현황](./docs/internal/spec.md) | 패키지별 구현 현황 + 테스트 관리 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |

## 에이전트 스킬 (Agent Skills)

저장소는 AI 에이전트의 컨텍스트 오염을 방지하고 도메인별 최적화된 워크플로우를 제공하기 위해 Closed-by-Default 에이전트 스킬 거버넌스를 적용합니다:

- **환경 설정**: [`.agents/skills.json`](.agents/skills.json) (글로벌 화이트리스트 및 로컬 스킬 마운트)
- **도메인 모듈형 스킬**:
  - [`oa-codegen`](.agents/skills-optional/oa-codegen/SKILL.md): AST 양방향 동기화, Trivia 보존, Typia 태그 인터섹션 파싱, Zod/TS 어댑터
  - [`oa-spec-lens`](.agents/skills-optional/oa-spec-lens/SKILL.md): SQLite WAL 수명주기, 변경 관측, 심볼 그래프 쿼리, D3 시각화
  - [`oa-schemas`](.agents/skills-optional/oa-schemas/SKILL.md): OpenAPI 3.1/3.2 다중 도메인 조각화, `oa://` 번들링, 순환 참조 해결
  - [`oa-runtime`](.agents/skills-optional/oa-runtime/SKILL.md): 다운스트림 라우터 스텁, 타입드 클라이언트, 인메모리 목 서버
  - [`oa-governance`](.agents/skills/oa-governance/SKILL.md): API 페르소나 계약, DPM 패턴, Closed-by-Default 4-Tier 검증 체계
  - [`oa-sdk`](.agents/skills/oa-sdk/SKILL.md): 모노레포 루트 오케스트레이터 및 빠른 참조
- **검증 게이트**: `@spec-platform/document-gates`의 `createAgentConfigGate`가 `pnpm check:docs`에 통합되어 CI 및 로컬에서 상시 검증됩니다.
