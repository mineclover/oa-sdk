# Platform Scope

이 문서는 oa-sdk가 앞으로 무엇을 1급 제품 범위로 관리하는지 정하는 scope SSOT다.
구현 현황은 [`spec.md`](./spec.md), 패키지 구조는
[`architecture/packages.md`](./architecture/packages.md), release 분류는
[`release-policy.json`](./release-policy.json)에 둔다. 구현되어 있거나 같은 monorepo에 있다는
사실만으로 active product scope가 되지는 않는다.

## Core Mission

oa-sdk의 핵심 임무는 `@oa-sdk/core`를 기반으로 schema와 OpenAPI spec의 source of truth를
정의하고, 외부 schema projection을 수용하며, 파싱·검증·생성·변경 이력 관측까지 하나의
계약 관리 계층으로 연결하는 것이다.

```text
@oa-sdk/core
├─ @oa-sdk/openapi-projection-contract  외부 schema producer 입력 계약
├─ @oa-sdk/typespec-decorators           production TypeSpec decorator와 provenance helper
├─ @oa-sdk/schemas                      TypeSpec/OpenAPI schema SSOT와 artifact
├─ @oa-sdk/parser                       OpenAPI 의미 해석, IR, 검증
├─ @oa-sdk/codegen                      build, 변환, governance CLI
├─ @oa-sdk/spec-lens                    revision, diff, provenance 관측
├─ @oa-sdk/spec-lens-contract           spec-lens browser-safe wire contract
├─ @oa-sdk/ast-sync                     V3 TypeScript AST 양방향 동기화, 구문 특성 분류 및 독립형 타입 가드
└─ @oa-sdk/tools                        TypeSpec JSON Schema 기반 MCP 도구 및 Interactive CLI 브릿지 엔진
```

Core Platform은 다음 열 패키지다.

| Package | Core responsibility |
| --- | --- |
| `@oa-sdk/core` | 공통 primitive와 dependency-light 기반 계약 |
| `@oa-sdk/openapi-projection-contract` | 외부 schema producer가 OpenAPI 조각을 전달하는 안정된 경계 |
| `@oa-sdk/typespec-decorators` | production TypeSpec source가 사용하는 versioned decorator와 provenance helper |
| `@oa-sdk/schemas` | TypeSpec source, OpenAPI artifact, compatibility/rollback source |
| `@oa-sdk/parser` | OpenAPI 3.2 parse, IR, ref resolution, lint, validate, query |
| `@oa-sdk/codegen` | schema/spec build, normalize, diff/review, type generation과 governance CLI |
| `@oa-sdk/spec-lens` | spec revision, diff, timeline, provenance와 source observation |
| `@oa-sdk/spec-lens-contract` | spec-lens HTTP response와 schema version의 browser-safe contract |
| `@oa-sdk/ast-sync` | V3 TypeScript AST 양방향 무손실 동기화, 구문 특성 분류기, 타입체커 순환 탐지, 독립형 타입 가드 |
| `@oa-sdk/tools` | TypeSpec JSON Schema 기반 MCP 도구 및 Interactive CLI 브릿지 엔진 |

## Architecture Governance Boundary

oa-sdk는 실행 가능한 API 계약과 그 계약의 생성·검증·변경 이력을 소유한다. 전체 서비스
아키텍처의 의도와 계층 관계까지 소유하지 않는다.

| 책임 | 소유 시스템 |
| --- | --- |
| TypeSpec/Zod/Drizzle → OpenAPI artifact | oa-sdk |
| OpenAPI 정규화·검증·diff·drift·codegen·mock | oa-sdk |
| API·BFF·UI·DB·ADR·Rule·lifecycle 관계 | archi-adr |
| 조직 architecture standards와 계층 정책 | archi-adr |
| 연계 | OpenAPI/SQL/provenance artifact + CI gate |

`archi-adr`는 oa-sdk의 생성 artifact를 source artifact로 소비할 수 있지만, oa-sdk가
`archi-adr`의 YAML 모델을 workspace dependency로 가져오거나 archi-adr의 BFF/UI/ADR
그래프를 재구현하는 것을 기본 경로로 삼지 않는다. 두 저장소를 함께 사용할 때 권장 흐름은
`oa-sdk build/validate/diff → artifact 고정 → archi-adr SourceArtifactDefinition/implements →
archi-adr validate/render`다.

상호 경계의 반대편 기준은 `archi-adr/docs/project/current-spec.txt`다.

## Scope Tiers

| Tier | Workspaces | Policy |
| --- | --- | --- |
| Core Platform | `core`, `openapi-projection-contract`, `typespec-decorators`, `schemas`, `parser`, `codegen`, `spec-lens`, `spec-lens-contract`, `ast-sync`, `tools` | 제품 방향과 신규 기능 투자의 기본 범위 |
| Downstream Integration | `router`, `client`, `mock-server` | Core 계약을 소비하고 end-to-end로 증명하는 release-tracked integration surface |
| Maintenance-only | `dpm`, `personas`, `typia-mock`, `logical-erd-contract`, `typespec-erd`, `typespec-tooling`, `ttsc-compile-fixture` | security, compatibility, migration 작업만 허용하는 분리 후보 또는 승인된 독립 prototype. `@oa-sdk/typia-mock`은 Core Platform에서 TS 컴파일러 변환기 복잡도를 격리하면서 Samchon ILlmApplication 통합점을 유지하는 유지보수 경계다. |
| Apps and references | `nestjs-ref`, `playground`, `preview`, `spec-lens-ui` | 배포 라이브러리가 아닌 검증, reference, UI workspace |

Downstream Integration은 Core Platform 자체가 아니다. 이 계층의 API와 테스트는 Core 계약의
소비 가능성을 증명하지만 schema/spec 관리 방향을 결정하지 않는다. 앱도 동일하게 core
capability의 consumer 또는 검증 surface이며 독립적인 제품 roadmap을 만들지 않는다.

## Maintenance Policy

Maintenance-only 패키지에 허용되는 변경은 다음으로 제한한다.

- 알려진 보안 취약점이나 privacy/safety 결함 수정
- 지원 런타임, 의존성, TypeScript/OpenAPI 계약과의 호환성 유지
- 별도 저장소 또는 새 package boundary로 옮기기 위한 migration과 extraction 준비

새로운 도메인 기능, 새로운 운영 workflow, 기능 확장을 위한 새 goal은 유지보수가 아니다.
Application/reference workspace도 Core Platform 우선순위를 사용해 자동으로 확장하지 않는다.

## Scope Reactivation Decision

Core Platform 여덟 패키지 밖에서 신규 feature goal을 만들려면 구현 전에 명시적인
scope-reactivation decision을 남겨야 한다. 최소한 다음 내용을 기록한다.

1. 다시 활성화할 package/workspace와 사용자 문제
2. Core Mission과의 직접 관계 또는 별도 제품으로 유지해야 하는 이유
3. 소유자, 유지 비용, release/CI 책임과 종료 조건
4. 이 monorepo에 둘지 extraction candidate로 이동할지에 대한 결정

결정이 없으면 non-core feature request는 착수하지 않고 backlog에도 active goal로 올리지
않는다. 버그 수정처럼 보이는 요청도 실제로 새 capability를 추가하면 feature로 분류한다.

### DPM temporary reactivation — 2026-07-14

The roadmap execution request for Goal 68 records a temporary scope reactivation for
`@oa-sdk/dpm` in this monorepo. The current canonical implementation site is
`mineclover/oa-sdk/packages/dpm`; the package remains private and is still excluded from
the Core Platform release track.

| Decision item | Recorded decision |
| --- | --- |
| User problem | Preserve a reviewable logical data/API/DB binding contract while preparing DPM extraction. |
| Owner | `mineclover/oa-sdk` maintainers temporarily own the implementation, review, and compatibility adapter. |
| Release/CI | Maintenance track checks (`build:maintenance`, `test:maintenance`, `typecheck:maintenance`, and DPM surface smoke) remain authoritative; no publish is enabled. |
| Location | Implement the authorized Goal 68 contract temporarily in this monorepo under `packages/dpm`. |
| Exit condition | An external `data-governance` owner/repository is named, the public artifact and migration window are accepted, and this package can be reduced to an adapter. |
| Boundary | No production vault, tokenization worker, row rewrite, physical FK mutation, or control-plane search/edit/publish workflow is activated by this decision. |

The existing `data_definitions` `1.0` shape is frozen as a structural compatibility contract.
Goal 68.1 introduces an explicitly experimental `1.1` identity contract in the same public
subpath; `1.1` is not an external stability promise until the extraction exit condition is met.

### TypeSpec logical ERD prototype reactivation — 2026-07-28

The TypeSpec logical-ERD prototype is an explicitly bounded reactivation under
`packages/logical-erd-contract` and `packages/typespec-erd`. It does not reactivate DPM,
OpenAPI code generation, or physical database mutation scope.

| Decision item | Recorded decision |
| --- | --- |
| User problem | Declare logical entities, fields, keys, and relationships with stable IDs and review their provenance/diff. |
| Owner | OA SDK maintainers own the prototype artifact and TypeSpec compiler integration. |
| Release/CI | Maintenance track builds, typechecks, and tests both packages; both remain private until an artifact compatibility and external distribution decision. |
| Authority | TypeSpec owns logical intent. DB catalog/migration remains physical authority. DPM is an optional future consumer, not a dependency or persistence owner. |
| Exit condition | A versioned `oa-sdk.logical-erd.v1` adoption decision defines public package ownership, catalog adapter contract, and review-gate integration. |
| Boundary | No DDL/migration/FK mutation, no generic metadata extension, no DPM persistence schema change, and no dependency from public `@oa-sdk/codegen`. |

### Typia Mock Maintenance-Only Boundary & Lifecycle Role

`@oa-sdk/typia-mock`은 모노레포 내에서 **Maintenance-only** 등급으로 명확히 한정된 quarantine boundary다. 이 패키지는 Core Platform 배포 릴리스 트랙(`pnpm release`, `build`, `test`)에서 제외되며, 독립된 유지보수 검증 명령(`build:maintenance`, `test:maintenance`, `typecheck:maintenance`)을 통해서만 빌드 및 테스트된다.

| 결정 항목 | 기록된 결정 및 근거 |
|---|---|
| **사용자 문제 (User Problem)** | Samchon `typia` 생태계의 `ILlmApplication` 파이프라인(`typia.llm.application<App>()`)을 소비하는 LLM 도구 호출 및 MCP 에이전트 워크플로를 모의 HTTP 환경에서 검증할 수 있는 표준 엔드포인트 제공. |
| **설계 근거 (Design Rationale & Isolation)** | `typia`는 컴파일 타임 AST 변환기(`ttsc`, `ts-patch`)에 강하게 의존한다. 이를 Core Platform(`core`, `schemas`, `parser`, `codegen`)에 도입할 경우, 모노레포 전체와 다운스트림 컨슈머에게 컴파일러 몽키패치와 build chain 복잡성을 강제하게 된다. `@oa-sdk/typia-mock`을 Maintenance-only 경계로 격리(quarantine)함으로써 Core Platform의 무변환 표준 `tsc` 빌드 무결성을 완벽히 수호한다. |
| **책임 및 소유자 (Governance & Lifecycle)** | Core Platform 개발 범위에서 제외되며, security 패치, Node.js/TypeScript 런타임 호환성 보장, 그리고 Samchon `ILlmApplication` 계약과의 최소 정합성만 유지(maintenance)한다. |
| **종료 조건 (Exit Condition)** | 외부 `typia-tools` 또는 `samchon-adapter` 독립 저장소가 준비되면 모노레포 외부로 완전히 추출(extraction)한다. |
| **경계 불변식 (Boundary Invariant)** | `@oa-sdk/codegen`의 기본 프로젝션 파이프라인이나 공개 클라이언트는 `@oa-sdk/typia-mock`을 런타임/빌드 의존성(zero runtime dependency)으로 참조할 수 없으며, Core Platform 패키지에는 어떠한 typia mock runtime dependency도 허용되지 않는다. 신규 기능 추가는 엄격히 금지된다. |

## Repository Separation

2026-07-11에 Markdown editor와 GitLab agent operations 제품을 각각 `markdown-editor`와
`gitlab-agent-ops` 독립 저장소로 추출했다. 전자는 GLFM/editor source of truth를, 후자는 GitLab
infra/orchestrator/UI와 운영 문서를 소유한다. `gitlab-agent-ops`는 `markdown-editor`를 단방향으로
소비하며, 두 제품은 이 monorepo의 workspace, release policy, CI 책임에 포함되지 않는다.

남은 물리 분리 후보는 다음과 같다.

| Candidate | Current surface | Rationale |
| --- | --- | --- |
| `data-governance` | `@oa-sdk/dpm`, `@oa-sdk/personas` | DPM 및 persona 계약 추출 |
| `typia-adapter` | `@oa-sdk/typia-mock` | 컴파일러 변환기 격리 및 ILlmApplication 목 서버 외부화 |

## Root Command Semantics

기본 root 명령은 Core Mission에 맞춘다.

| Command | Scope |
| --- | --- |
| `pnpm build`, `pnpm test`, `pnpm typecheck` | Core Platform 여덟 package |
| `pnpm build:downstream`, `pnpm test:downstream`, `pnpm typecheck:downstream` | Downstream Integration 세 package |
| `pnpm build:maintenance`, `pnpm test:maintenance`, `pnpm typecheck:maintenance` | Maintenance-only compatibility proof |
| `pnpm build:internal`, `pnpm test:internal`, `pnpm typecheck:internal` | App/reference workspace |
| `pnpm build:all`, `pnpm test:all`, `pnpm typecheck:all` | 전체 monorepo 회귀 |

CI는 네 policy track을 네 실행 그룹으로 표시한다. `internal` 실행 그룹은 applications를
검증한다. 모든 그룹은 현재 회귀 검증을 통과해야 하지만, 신규 제품 우선순위와
기본 개발 명령은 Core Platform에만 귀속된다.

Turbo는 `@oa-sdk/codegen`의 기존 downstream peer/dev dependency 때문에 Core task 실행 중
router/client/mock-server의 prerequisite build를 수행할 수 있다. 이는 build graph 정합성 증명이며
Downstream을 Core product scope로 승격시키거나 maintenance 작업을 포함하는 의미가 아니다.

`pnpm release`는 release-tracked인 Core Platform과 Downstream Integration만 build한 뒤
Changesets를 실행한다. Maintenance와 application workspace는 release 대상이 아니다.
