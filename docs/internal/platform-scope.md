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
├─ @oa-sdk/surface-ir                   target-neutral API surface IR와 Forge projection
├─ @oa-sdk/codegen                      build, 변환, governance CLI
├─ @oa-sdk/spec-lens                    revision, diff, provenance 관측
├─ @oa-sdk/spec-lens-contract           spec-lens browser-safe wire contract
├─ @oa-sdk/ast-sync                     V3 TypeScript AST 양방향 동기화, 구문 특성 분류 및 독립형 타입 가드
└─ @oa-sdk/tools                        TypeSpec JSON Schema 기반 MCP 도구 및 Interactive CLI 브릿지 엔진
```

Core Platform은 다음 11개 패키지다.

| Package | Core responsibility |
| --- | --- |
| `@oa-sdk/core` | 공통 primitive와 dependency-light 기반 계약 |
| `@oa-sdk/openapi-projection-contract` | 외부 schema producer가 OpenAPI 조각을 전달하는 안정된 경계 |
| `@oa-sdk/typespec-decorators` | production TypeSpec source가 사용하는 versioned decorator와 provenance helper |
| `@oa-sdk/schemas` | TypeSpec source, OpenAPI artifact, compatibility/rollback source |
| `@oa-sdk/parser` | OpenAPI 3.2 parse, IR, ref resolution, lint, validate, query |
| `@oa-sdk/surface-ir` | ParsedDocument 위의 target-neutral API surface IR, Forge SDK/CLI projection, command별 OpenAPI Overlay |
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

## Forge Target Support

Cloudflare Forge는 Core Mission의 외부 target projection으로 지원한다. TypeSpec source나
canonical OpenAPI artifact를 Forge metadata로 직접 수정하지 않고, `@oa-sdk/parser`의
`ParsedDocument`와 `@oa-sdk/surface-ir`의 target-neutral surface를 통해 Forge operation
projection과 command별 OpenAPI Overlay를 생성한다. 지원 범위와 제한은
[Forge 지원 가이드](../guides/forge-support.md)에 기록한다.

현재 production artifact에 대해 Surface IR은 34개 operation을 5개 Forge command와 34개
method로 투영한다. Forge core 초기화 parity는 검증되며, Docker/Fern 기반 전체 TypeScript
SDK 생성과 SSE/envelope runtime은 별도 downstream 검증 범위다.

`archi-adr`는 oa-sdk의 생성 artifact를 source artifact로 소비할 수 있지만, oa-sdk가
`archi-adr`의 YAML 모델을 workspace dependency로 가져오거나 archi-adr의 BFF/UI/ADR
그래프를 재구현하는 것을 기본 경로로 삼지 않는다. 두 저장소를 함께 사용할 때 권장 흐름은
`oa-sdk build/validate/diff → artifact 고정 → archi-adr SourceArtifactDefinition/implements →
archi-adr validate/render`다.

상호 경계의 반대편 기준은 `archi-adr/docs/project/current-spec.txt`다.

## Scope Tiers

| Tier | Workspaces | Policy |
| --- | --- | --- |
| Core Platform | `core`, `openapi-projection-contract`, `typespec-decorators`, `schemas`, `parser`, `surface-ir`, `codegen`, `spec-lens`, `spec-lens-contract`, `ast-sync`, `tools` (11개) | 제품 방향과 신규 기능 투자의 기본 범위 (Downstream은 `devDependencies`로만 참조 가능) |
| Downstream Integration | `router`, `client`, `mock-server`, `chunk-stream`, `chunk-stream-crdt`, `chunk-stream-ui`, `chunk-stream-timeseries`, `chunk-stream-react`, `peer-transport`, `peer-server`, `webmcp-peer`, `collab-workspace`, `mcp-mesh`, `telemetry`, `rpc` (15개) | Core 계약을 소비하고 end-to-end로 증명하는 release-tracked integration surface (`rpc`를 제외하고 `distributionCandidates` 승격 완료) |
| Maintenance-only | `dpm`, `personas`, `typia-mock`, `logical-erd-contract`, `typespec-erd`, `typespec-tooling`, `ttsc-compile-fixture` (7개) | security, compatibility, migration 작업만 허용하는 분리 후보 또는 승인된 독립 prototype. `@oa-sdk/typia-mock`은 Core Platform에서 TS 컴파일러 변환기 복잡도를 격리하면서 Samchon ILlmApplication 통합점을 유지하는 유지보수 경계다. |
| Apps and references | `nestjs-ref`, `playground`, `preview`, `spec-lens-ui` (4개) | 배포 라이브러리가 아닌 검증, reference, UI workspace |

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

Core Platform 11개 패키지 밖에서 신규 feature goal을 만들려면 구현 전에 명시적인
scope-reactivation decision을 남겨야 한다. 최소한 다음 내용을 기록한다.

1. 다시 활성화할 package/workspace와 사용자 문제
2. Core Mission과의 직접 관계 또는 별도 제품으로 유지해야 하는 이유
3. 소유자, 유지 비용, release/CI 책임과 종료 조건
4. 이 monorepo에 둘지 extraction candidate로 이동할지에 대한 결정

결정이 없으면 non-core feature request는 착수하지 않고 backlog에도 active goal로 올리지
않는다. 버그 수정처럼 보이는 요청도 실제로 새 capability를 추가하면 feature로 분류한다.

### WebMCP peer unified package — 2026-10-18

브라우저/호스트 웹앱과 외부 AI 에이전트를 하나의 peer 기반 MCP 라우팅 계층으로 연결하는
통합 패키지 `@oa-sdk/webmcp-peer`를 Downstream Integration에 추가한다. 기존
`peer-transport`, `peer-server`, `collab-workspace`, `mcp-mesh` 강화 결정(2026-09-22)과 별개의
신규 workspace에 대한 결정이다.

| Decision item | Recorded decision |
| --- | --- |
| User problem | 브라우저 앱이 노출한 도구를 외부 AI 에이전트가 MCP로 호출하려면 room 라우팅, WebSocket signaling/relay, 승인 게이트, 카탈로그 드리프트 감지를 매번 직접 조립해야 한다. |
| Core relation | Core 패키지에 runtime 의존성을 두지 않는 독립 downstream 라이브러리다. MCP 도구 descriptor(JSON Schema `inputSchema`)를 3계층 topology(room router/WebSocket signaling server, browser provider, external agent client)로 라우팅해, Core가 만든 도구 surface가 외부 에이전트까지 도달하는 end-to-end 경로를 증명한다. 도구 계약의 모양은 결정하지 않는다. |
| Owner | OA SDK maintainers가 wire protocol(`webmcp-peer.v1`), 승인·카탈로그 fail-closed 경계, API 호환성, downstream 테스트와 문서를 유지한다. |
| Release/CI | Downstream Integration release-tracked distribution candidate(`0.1.0`)로 등록하고 downstream build/test/typecheck에 포함한다. 실제 publish는 활성화하지 않는다. |
| Location | `packages/webmcp-peer`에 두고 공개 entrypoint는 `.`, `./config`, `./client`, `./provider`, `./server`다. |
| Exit condition | room lease/승인, Streamable HTTP(`/p/:id/mcp`)와 WebSocket(`/p/:id/client`) 경로, 카탈로그 드리프트 fail-closed가 회귀 테스트로 고정된다. 호스팅형 signaling 서비스나 별도 제품으로 확대할 때 별도 결정을 기록한다. |
| Boundary | 외부 runtime 의존성 없이 표준 Web API(`fetch`, `WebSocket`, `RTCPeerConnection`)와 Node built-in만 사용하는 라이브러리 범위다. 호스팅형 signaling 서비스, 다중 테넌트 계정/인증 서비스, TURN/STUN 운영 인프라를 제공한다고 주장하지 않는다. |

### TypeSpec contract RPC runtime — 2026-10-12

사용자가 TypeSpec으로 선언한 계약을 RPC 형태로 호출·제공하는 유틸리티 구현을 요청했다.
계약 투영(`buildRpcContract`)은 Forge projection과 같은 Surface IR target projection이므로
Core Platform인 `@oa-sdk/surface-ir`와 `@oa-sdk/codegen`(`pluginRpc`, `generateRpcModule`)에
둔다. 이 결정은 그 계약을 소비하는 runtime인 새 `@oa-sdk/rpc` workspace에 대한 것이다.

| Decision item | Recorded decision |
| --- | --- |
| User problem | TypeSpec operation을 REST route 단위로만 호출할 수 있어, 같은 계약을 typed procedure 호출(`client.users.getUserById({ id })`)이나 JSON-RPC 2.0 같은 단일 endpoint·메시지 채널 transport로 쓰려면 수작업 adapter가 필요하다. |
| Core relation | Core 계약(Surface IR RPC contract)을 소비해 하나의 handler 집합이 JSON-RPC와 원래 REST route를 함께 처리함을 end-to-end로 증명한다. 계약의 모양은 Core가 소유하고 runtime은 결정하지 않는다. |
| Owner | OA SDK maintainers가 runtime API, 파라미터 직렬화 호환성, downstream 테스트와 문서를 유지한다. |
| Release/CI | Downstream Integration release-tracked private workspace로 등록하고 downstream build/test/typecheck에 포함한다. distribution candidate 승격과 publish는 별도 결정으로 미룬다. `./ajv` subpath만 optional peer `ajv`를 import한다. |
| Location | `packages/rpc`에 둔다. 기존 `@oa-sdk/codegen` wire-adapter의 `RpcContractTargetAdapter`는 Protobuf/MessagePack 바이너리 wire client로 남기고(파라미터·codec·오류 처리 수정), JSON procedure 호출은 이 runtime이 맡는다. |
| Exit condition | 계약 투영, client/server, JSON-RPC 2.0, REST binding, 실제 TypeSpec 컴파일에서 생성한 module의 타입 검사가 회귀 테스트로 고정된다. streaming procedure(SSE, client/bidi streaming)나 WebSocket/peer-transport adapter로 확장할 때 별도 결정을 기록한다. |
| Boundary | unary 호출만 다룬다. streaming operation은 진단과 함께 계약에서 제외한다. 인증·rate limit·batch 최적화는 transport/server 사용자 책임이며 제공한다고 주장하지 않는다. |

### WebMCP libraries hardening — 2026-09-22

사용자가 명시적으로 요청한 통신·인증·데이터 처리 최적화, 취약점 수정, 라이브러리화,
필수 테스트 보강을 기존 `peer-transport`, `peer-server`, `collab-workspace`, `mcp-mesh`
구현에 적용한다. 네 패키지는 Downstream Integration에서 버전과 검증을 관리한다.

| Decision item | Recorded decision |
| --- | --- |
| User problem | 도구 호출·피어 레지스트리·동시 편집 데이터가 검증 없이 처리되고 기존 테스트가 실패 경계를 검증하지 못한다. |
| Core relation | `@oa-sdk/tools`의 스키마 기반 도구 계약을 재사용 가능한 전송·세션·협업 라이브러리로 소비한다. |
| Owner | OA SDK maintainers가 보안 경계, API 호환성, downstream 테스트와 문서의 유지 책임을 가진다. |
| Release/CI | 기존 public manifest에 맞춰 artifact distribution candidate로 등록하고 downstream build/test/typecheck에 포함한다. 실제 publish는 활성화하지 않는다. |
| Location | 현재 네 패키지를 모노레포에 유지하고 중복 peer bridge 구현은 transport 라이브러리에 위임한다. |
| Exit condition | 공유 프로토콜과 필수 회귀 테스트가 downstream gate를 통과한다. 별도 WebRTC signaling 또는 편집 제품으로 확대할 때 별도 소유권 결정을 기록한다. |
| Boundary | 이번 범위는 현재 HTTP/인메모리 구현의 강화이다. 완성된 WebSocket signaling, WebRTC 연결, 파일 watcher, 멀티 사용자 OAuth 서비스를 제공한다고 주장하지 않는다. |

### mock-server request-path performance — 2026-10-05

사용자가 오케스트레이션 결정 D2에서 downstream 성능 항목 중 C1만 승인했다. 생성 client의
스키마/정규식 재생성(C3)은 이 결정에 포함하지 않는다.

| Decision item | Recorded decision |
| --- | --- |
| User problem | mock-server가 요청마다 응답 본문을 다시 생성하고 Ajv로 다시 검증해 `node-http.ts`의 사전 계산 fast path가 사실상 쓰이지 않는다. `allowedHeadersCache` 키가 구체 URL이라 장시간 실행 시 메모리가 끝없이 커지고, 생성기가 선택 속성까지 모두 접은 뒤 버린다. |
| Core relation | 새 capability가 아니라 기존 mock 런타임의 성능·메모리 결함 수정이다. 파서 DAG 계약(Goal 69)과 `matchRoute`(C2) 개선을 소비한다. |
| Owner | OA SDK maintainers가 mock-server 런타임 동작 호환성과 downstream 테스트를 유지한다. |
| Release/CI | 기존 downstream build/test/typecheck tier가 검증한다. built CLI smoke(`test:cli-smoke:prebuilt`)는 mock-server `test:ci` 안에서 Turbo build task가 만든 dist로 실행한다. 버전과 publish 정책은 바꾸지 않는다. |
| Location | `packages/mock-server`에 유지한다. |
| Exit condition | 요청당 재생성·재검증이 제거되거나 캐시되고, 캐시 크기가 라우트 수로 제한되며, 기존 응답 바이트·검증 오류 출력이 회귀 테스트로 고정된다. before/after 측정치를 남긴다. |
| Boundary | 응답 생성 규칙, 검증 의미, 공개 API는 바꾸지 않는다. 새 mock 기능(시나리오, 상태 저장 확장 등)은 이 결정에 포함하지 않는다. |

### DPM temporary reactivation — 2026-07-14

> **Amendment 2026-10-25:** the canonical owner for new DPM features and releases is the public
> [mineclover/data-governance](https://github.com/mineclover/data-governance) repository. This oa-sdk
> workspace remains a private, non-publishing maintenance/source compatibility mirror; external
> package versions and later features are not this mirror's release or implementation status.
> [Always-on/shared search is deferred TODO](https://github.com/mineclover/data-governance/blob/main/docs/internal/goals/shared-search-todo.md).
> The external file-based read-only CLI needs no DB/Docker; retained SQL/local rehearsal evidence
> does not authorize further database/privilege/adapter/service work. Phase 10 production data-plane
> remains deferred. The location and temporary authority below describe the 2026-07-14 decision only.

The earlier 2026-10-23 amendment recorded the external publication of `@oa-sdk/dpm@0.1.2` on
2026-07-28. This is retained release history, not a claim that the oa-sdk mirror publishes or
that this is the external registry's current version.

The roadmap execution request for Goal 68 records a temporary scope reactivation for
`@oa-sdk/dpm` in this monorepo. At that decision, the temporary implementation site was
`mineclover/oa-sdk/packages/dpm`; the local package remains private and is still excluded from
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

DPM 신규 기능·배포의 canonical owner는 이미 외부 `data-governance`다. oa-sdk의 DPM mirror 유지·축소와
나머지 후보의 분리는 별도 판단이며, `personas`까지 이전 완료했다는 뜻은 아니다.

| Candidate | Current surface | Rationale |
| --- | --- | --- |
| `data-governance` | `@oa-sdk/dpm` mirror, `@oa-sdk/personas` 후보 | DPM 외부 owner는 확정; local mirror 유지·축소와 persona 계약 추출은 별도 판단 |
| `typia-adapter` | `@oa-sdk/typia-mock` | 컴파일러 변환기 격리 및 ILlmApplication 목 서버 외부화 |

workspace 의존자가 없는 패키지의 유지·추출·제거 판단 자료는 [`package-hygiene-decisions.md`](./package-hygiene-decisions.md)에 둔다(사용자 결정 대기).

## Root Command Semantics

기본 root 명령은 Core Mission에 맞춘다.

| Command | Scope |
| --- | --- |
| `pnpm build`, `pnpm test`, `pnpm typecheck` | Core Platform 11개 package |
| `pnpm build:downstream`, `pnpm test:downstream`, `pnpm typecheck:downstream` | Downstream Integration 15개 package |
| `pnpm build:maintenance`, `pnpm test:maintenance`, `pnpm typecheck:maintenance` | Maintenance-only compatibility proof |
| `pnpm build:internal`, `pnpm test:internal`, `pnpm typecheck:internal` | App/reference workspace |
| `pnpm build:all`, `pnpm test:all`, `pnpm typecheck:all` | 전체 monorepo 회귀 |

CI는 네 policy track을 네 실행 그룹으로 표시한다. `internal` 실행 그룹은 applications를
검증한다. 모든 그룹은 현재 회귀 검증을 통과해야 하지만, 신규 제품 우선순위와
기본 개발 명령은 Core Platform에만 귀속된다.

현재 GitHub Actions는 `.github/workflows/ci.yml`의 단일 `ci` job만 실행한다. 이 job은 핵심
build/typecheck/test와 필수 governance를 수행한다. Node 22/24/26 public runtime, TS7,
maintenance/internal, schema validation/rollback, NestJS/FastAPI governance는 `pnpm ci:local`이
로컬에서 실행한다. 이전 `workspace-build-outputs` artifact와 4-job/6-matrix 구성은 2026-10-05
설계 기록이며, 지금은 존재하지 않는다. `test:ci`는 package 밖의 문서·script도 읽기 때문에
cache하지 않고 매번 실행하며, 실행 전에 해당 package의 build를 Turbo task로 보장받는다.
따라서 `test:ci`는 `turbo run test:ci`로 실행하는 것을 전제로 한다. mock-server `test:ci`의
built CLI smoke는 dist를 다시 build하지 않고, Turbo 밖에서 직접 실행하면 dist가 없거나 build
input(`src/`의 test 외 file, `tsup.config.*`, `tsconfig*.json`, `package.json`)보다 수정 시각이
오래되었을 때 실패한다.
원격 cache(`TURBO_TOKEN`)와 테스트 병렬화는 쓰지 않는다.

`parser-bench` job은 `pnpm bench:parser`를 `BENCH_PARSER_BUDGET_SCALE=2`로 실행한다. 이 job은
`needs`가 없어 `ci` job과 나란히 돈다. 실패하면 workflow는 실패하지만 `ci` job의 결정적 gate와
`ci`에 의존하는 job을 건너뛰게 만들지 않고, 따로 재실행할 수 있다. 이 job은 parser가 의존하는
workspace package(현재 `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`)만 build한다.

이 gate는 parser `$ref` 전개 성능(Goal 69)을 두 가지로 확인한다. 하나는 각 case의 median이 시간
budget 안에 있는지다. 표본은 main thread의 CPU 시간이라 core를 기다린 시간은 들어가지 않는다.
budget은 Apple M3 Pro에서 약 3배 여유를 두고 정했고, hosted runner의 단일 스레드 속도가 그 절반
정도라 CI에서는 2배로 늘린다. 다른 하나는 ring 100→200의 비용 증가율이 n^2.5 이하인지다. 증가율은
같은 round에서 잰 두 크기의 비율을 round마다 구한 뒤 그 median으로 정하고, 이 한도는 늘리지 않는다.
일정한 기계 속도 차이는 비율에서 상쇄되지만 부하는 상쇄되지 않는다. 부하는 cache·memory 경합으로
CPU 시간도 늘리기 때문이다. 그래서 round마다 case 순서를 고정 seed로 섞고, 표본을 재기 전마다
전체 GC를 돌려 어떤 case도 다른 case의 garbage 비용을 떠안지 않게 한다.

Turbo는 `@oa-sdk/codegen`의 기존 downstream peer/dev dependency 때문에 Core task 실행 중
router/client/mock-server의 prerequisite build를 수행할 수 있다. 이는 build graph 정합성 증명이며
Downstream을 Core product scope로 승격시키거나 maintenance 작업을 포함하는 의미가 아니다.

`pnpm release`는 release-tracked인 Core Platform과 Downstream Integration만 build한 뒤
Changesets를 실행한다. Maintenance와 application workspace는 release 대상이 아니다.
