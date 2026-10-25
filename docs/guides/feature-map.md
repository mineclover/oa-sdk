# 기능 선택 지도

oa-sdk에서 **무엇을 할 수 있는지**, **어디서 시작할지**, **무엇은 별도 범위인지**를 고르는 지도다.
명령 옵션은 [CLI 레퍼런스](./cli-command-reference.md), import 경로와 배포 기록은
[라이브러리 진입점 지도](./library-entrypoints.md), 자세한 사용 순서는 [가이드 색인](./README.md)을 따른다.

## 상태를 읽는 기준

- **Core**: 계약 작성·해석·검증·생성·관측의 제품 중심이다. Core라도 저장소 전용일 수 있다.
- **Downstream**: Core 계약을 소비하는 연동 라이브러리다. Core의 필수 설치 항목은 아니다.
- **저장소 전용**: 이 checkout의 private workspace다. public export가 있어도 npm 배포를 뜻하지 않는다.
- **Maintenance**: 기존 호환성·보안·이전 경계를 유지한다. 구현이 있다고 신규 기능을 자동 재개하지 않는다.
- **외부 제품 / TODO**: 다른 저장소가 소유하거나 아직 활성화하지 않은 범위다.

분류의 정본은 [Platform Scope](../internal/platform-scope.md)와
[release policy](../internal/release-policy.json)다. 현재 workspace는 Core 11 / Downstream 15 /
Maintenance 7 / Apps 4개다. 구현 여부, 공개 import, 배포 후보, 실제 npm 배포, 운영 준비는 서로 다르다.
이 지도는 2026-10-25 checkout 기준이며 npm registry의 현재 버전을 조회한 결과가 아니다.

API·데이터 구조·소비자 인터페이스를 독립적으로 구성하는 방법은
[용도별 파이프라인 구성](./pipeline-configuration.md)을 따른다.

## 계약 관리 — Core

| 하고 싶은 일 | 제공하는 기능과 시작점 | 읽을 문서 |
| --- | --- | --- |
| 새 프로젝트 또는 기존 서비스에 도입 | `oa-gen init`, `oa.config.ts`; TypeSpec·OpenAPI YAML/JSON·Zod 원본 선택. 저장소 자체의 production 원본은 `.tsp` | [Quick Start](./quick-start.md), [온보딩](./onboarding-playbook.md) |
| 계약 작성·수집·정규화 | TypeSpec 데코레이터·표준 계약, `tsp-scaffold`, `collect`·`normalize`·`upgrade`; NestJS/FastAPI 산출물도 입력으로 소비 | [TypeSpec 작성](./typespec/03-decorators-reference.md), [외부 서비스 계약 관리](./use-cases/nestjs-swagger-governance.md) |
| OpenAPI 해석·검증 | `@oa-sdk/parser`의 IR·ref graph·lint·validate·query; `oa-gen validate`·`lint` | [OpenAPI 3.2 계약 관리](./openapi32-contract-management.md), [parser](../../packages/parser/README.md) |
| 타입·검증 코드 생성 | `typegen`, `generate:zod`, `generate:guards`; HTTP 없는 모델과 CSP용 standalone guard 지원 | [순수 타입과 가드](./pure-types-and-guards.md), [CLI 레퍼런스](./cli-command-reference.md) |
| Zod/Drizzle·TypeScript 연결 | Zod/Drizzle projection과 `@oa-sdk/ast-sync`의 AST 동기화. DB 모델과 API 계약은 별도 원본이며 지원 변환 범위를 확인 | [코드젠 워크플로](./use-cases/codegen-workflow.md), [타입 계약 관리](../concepts/type-contract-management.md) |
| 변경·생성물·런타임 차이 검사 | `diff`, `tsp diff`, `check-artifact`, `drift`, `review-bundle`; breaking-change 차단은 명시한 gate/옵션으로 적용 | [거버넌스 워크플로](./use-cases/openapi-governance-workflow.md), [CLI 레퍼런스](./cli-command-reference.md) |
| 빌드 파이프라인·출처 연결 | `@oa-sdk/codegen/plugin`의 TypeSpec 빌더, trace manifest, 생성 선언의 TypeSpec graph semantic sidecar | [빌더 플랫폼](./typespec-builder-platform.md), [graph semantic index](./typespec-graph-semantic-index.md) |
| 다른 호출 표면으로 투영 | `@oa-sdk/surface-ir`, `oa-gen surface`의 Forge projection·Overlay와 RPC contract 투영. RPC 실행 runtime은 아래 Downstream과 별개 | [Forge 지원](./forge-support.md), [계약 RPC](./typespec-rpc.md) |
| 도구 계약을 MCP·CLI·HTTP로 제공 | `@oa-sdk/tools`에서 JSON Schema 도구를 정의하고 adapter로 노출. API 계약에서 도구를 자동 생성하는 기능과는 구분 | [tools](../../packages/tools/README.md) |
| 스펙 변경 이력 관측 | **저장소 전용** Spec-Lens의 revision·diff·timeline·graph·provenance. TypeSpec output-pointer provenance의 가용성은 별도 표시 | [Spec-Lens](../spec-lens/README.md), [구현 현황](../internal/spec.md) |

## 계약 소비 — Downstream

| 하고 싶은 일 | 제공하는 기능과 경계 | 읽을 문서 |
| --- | --- | --- |
| 백엔드 핸들러 구현 | `@oa-sdk/router`의 순수 `*.contract.ts`와 Hono/Express/Fastify/Elysia 라우터 코드 생성. 비즈니스 구현·서버 실행은 사용자 책임 | [핸들러 계약](./backend-handler-contracts.md), [router](../../packages/router/README.md) |
| 프론트엔드·서비스 클라이언트 | `@oa-sdk/client`의 fetch SDK, 취소·스트리밍, TanStack Query v5 키·옵션·React 훅 생성 | [클라이언트·쿼리 소비](./client-and-query-consumption.md) |
| 개발·테스트용 mock | `@oa-sdk/mock-server`의 Node HTTP/MSW adapter, validation, 인메모리 상태, watch 시 route 교체. 운영 API 호스팅 대체가 아님 | [Mock 사용법](./mock-server-usage.md) |
| typed procedure 호출·제공 | **저장소 전용** `@oa-sdk/rpc`의 unary client/server, JSON-RPC 2.0·REST binding. streaming procedure는 제외 | [계약 RPC](./typespec-rpc.md), [rpc](../../packages/rpc/README.md) |
| chunk·시계열·재생 UI | `chunk-stream`, `chunk-stream-crdt`, `chunk-stream-ui`, `chunk-stream-timeseries`, `chunk-stream-react`의 bounded stream·병합·재생 primitives | [진입점 지도](./library-entrypoints.md), [API index](../internal/api-index.md) |
| 브라우저 도구와 외부 에이전트 연결 | `webmcp-peer`의 room/router/relay/provider/client와 승인·catalog 경계. `peer-transport`, `peer-server`, `collab-workspace`, `mcp-mesh`는 전송·세션·협업 primitives. 호스팅 서비스나 운영 인프라를 자동 제공하지 않음 | [WebMCP 가이드](./webmcp-projection-and-relay-guide.md), [webmcp-peer](../../packages/webmcp-peer/README.md), [보안 경계](../security/webmcp-hardening.md) |
| 설계 단계에서 telemetry 연결 | `@oa-sdk/telemetry`의 추적 심볼, XState v5 inspector, dispatcher, HMAC sanitizer. `@oa-sdk/dpm` 설치·실행에 의존하지 않음 | [telemetry](../../packages/telemetry/README.md) |

핸들러·클라이언트·mock을 CLI로 생성/실행할 때는
[동반 패키지 설치](./cli-setup.md#동반-패키지-companion-packages)를 확인한다.
`@oa-sdk/codegen` 설치가 모든 Downstream을 함께 설치한다는 뜻은 아니다.
`webmcp-peer`·`telemetry` 등의 배포 후보 등록도 npm 설치 가능성을 보장하지 않는다.

## 저장소 전용·유지보수·외부 제품

| 영역 | 현재 책임과 경계 |
| --- | --- |
| `@oa-sdk/schemas`, Spec-Lens, Apps | 이 저장소의 계약·관측·reference/demo workspace다. `pnpm schema:*`와 내부 UI 실행을 일반 npm 사용자에게 요구하지 않는다. |
| oa-sdk의 `@oa-sdk/dpm` | 비공개 maintenance/source compatibility mirror다. 신규 DPM 계약·기능·배포의 canonical owner는 [mineclover/data-governance](https://github.com/mineclover/data-governance)이며 같은 이름의 npm 패키지와 이 mirror의 버전·기능을 동일시하지 않는다. |
| DPM 상시·공유 검색 | 외부 owner의 [TODO-SHARED-SEARCH](https://github.com/mineclover/data-governance/blob/main/docs/internal/goals/shared-search-todo.md)로 보류했다. 현재 외부 DPM 파일 기반 read-only CLI에는 DB·Docker·persistent index가 필요 없다. 이 기능 문서 정리가 DB/adapter/서비스 작업을 재개하지 않는다. |
| 나머지 Maintenance | `personas`, `typia-mock`, `logical-erd-contract`, `typespec-erd`, `typespec-tooling`, `ttsc-compile-fixture`는 기존 계약·prototype·호환성 검증 범위다. 신규 기능은 별도 scope 결정이 필요하다. |
| 추출된 제품 | Markdown editor는 `markdown-editor`, GitLab 운영 도구는 `gitlab-agent-ops`가 소유한다. oa-sdk의 workspace·release·CI 범위가 아니다. |

### DB가 필요한가?

- 일반 계약 검증·타입/SDK 생성·mock 사용에 외부 PostgreSQL이나 Docker를 요구하지 않는다.
- 증분 codegen은 `.oa-cache/state.sqlite` 로컬 캐시를 선택적으로 사용하고 캐시 오류 시 full rebuild로 fallback한다.
- Spec-Lens는 `.spec-lens.db` 로컬 SQLite 캐시를 사용한다. 이것은 DPM 공유 검색용 서비스 DB와 다른 기능이다.
- 기존 DPM storage adapter·SQL·검증 기록은 유지보수/참고 자료다. 그 존재가 현재 CLI의 DB 필수 조건이나 운영 활성화 승인은 아니다.

## 상세와 근거 찾기

| 확인할 것 | 정본 |
| --- | --- |
| 명령과 옵션 | [CLI 레퍼런스](./cli-command-reference.md) |
| package root·subpath·배포 기록 | [라이브러리 진입점 지도](./library-entrypoints.md); 설치 직전 registry 버전도 확인 |
| export symbol | [API index](../internal/api-index.md) |
| 구현과 알려진 한계 | [Spec](../internal/spec.md) |
| 회귀 테스트 경로 | [Feature Test Matrix](../internal/feature-test-matrix.md) |
| 현재 작업과 미래 과제 | [Plan](../internal/plan.md), [Todo](../internal/todo.md) — 완료 이력과 active task를 구분 |

`✅`나 테스트 통과는 해당 구현의 검증 기록이다. npm 배포 완료, 모든 입력 지원 또는 운영 준비 완료의 표시는 아니다.
