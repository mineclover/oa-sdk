# 기능 선택 지도

oa-sdk에서 **무엇을 할 수 있는지**, **어디서 시작할지**, **무엇은 별도 범위인지**를 고르는 지도다.
명령 옵션은 [CLI 레퍼런스](./cli-command-reference.md), import 경로와 배포 기록은
[라이브러리 진입점 지도](./library-entrypoints.md), 자세한 사용 순서는 [가이드 색인](./README.md)을 따른다.

## 목적별 전체 기능

기능은 **계약 입력 → 코드 생성 → 실행·도구 연결 → 검증·리뷰 → 런타임 지원** 순서로 읽는다.
각 단계에서 필요한 기능을 선택한다. 이 순서는 모든 파이프라인을 구성하거나 모든 패키지를
설치해야 한다는 뜻은 아니다. Core/Downstream과 배포 상태는 아래에서 별도로 확인한다.
계약의 저작·소비 경계는 [Contract Ownership Boundaries](../internal/contract-boundaries.md)를
따른다.

| 순서 | 목적 | 대표 작업·결과 |
| --- | --- | --- |
| [1. 계약 입력](#1-계약-입력) | 시작할 원본과 입력 경계 정하기 | init, TypeSpec 작성, OpenAPI 수집·정규화, Zod/Drizzle 연결 |
| [2. 코드 생성](#2-코드-생성) | 필요한 산출물 만들기 | 데이터 타입·guard·Python DTO → 서버 핸들러·라우터 → 소비자 SDK·Query·RPC 계약 |
| [3. 실행·도구 연결](#3-실행과-도구-연결) | 계약과 handler를 호출 표면에 연결하기 | RPC runtime, MCP·CLI·HTTP 도구, WebMCP provider/client |
| [4. 검증·리뷰](#4-검증과-리뷰) | 결과와 변경을 확인하기 | lint·validate·mock, diff·drift·동기화, 출처·이력·영향도 |
| [5. 런타임 지원](#5-런타임-지원) | 실행 중 데이터와 상태를 다루기 | chunk 재생·CRDT·협업 상태·telemetry |

## 목적별 상세 기능

### 1 계약 입력

| 작업 | 기능·시작점·범위 | 문서 |
| --- | --- | --- |
| 새 프로젝트 또는 기존 서비스에 도입 | `oa-gen init`, `oa.config.ts`; 저장소 production API는 TypeSpec-first로 작성하고, 외부 서비스는 OpenAPI YAML/JSON·Zod/TS artifact를 intake로 선택 | [Quick Start](./quick-start.md), [온보딩](./onboarding-playbook.md), [계약 경계](../internal/contract-boundaries.md) |
| 계약 작성·수집·정규화 | TypeSpec 데코레이터·bundle/approval gate가 repo API source를 소유한다. `collect`·`normalize`·`upgrade`는 NestJS/FastAPI 등 외부 producer artifact를 수용한다 | [TypeSpec 작성](./typespec/03-decorators-reference.md), [외부 서비스 계약 관리](./use-cases/nestjs-swagger-governance.md) |
| Zod/Drizzle·TypeScript 연결 | Zod/Drizzle projection과 `@oa-sdk/ast-sync`의 AST 동기화. DB 모델과 API 계약은 별도 원본이며 지원 변환 범위를 확인 | [코드젠 워크플로](./use-cases/codegen-workflow.md), [타입 계약 관리](../concepts/type-contract-management.md) |

### 2 코드 생성

| 작업 | 기능·시작점·범위 | 문서 |
| --- | --- | --- |
| 타입·검증 코드 생성 | `typegen`, `generate:zod`, `generate:guards`; `generate:pydantic`은 OAS 3.2 `components.schemas`와 operation에서 Python Pydantic v2 타입(`models.py`, `operations.py`) 생성; router·registry는 범위 밖 | [순수 타입과 가드](./pure-types-and-guards.md), [Pydantic 코드 생성](./pydantic-codegen.md), [CLI 레퍼런스](./cli-command-reference.md) |
| 백엔드 핸들러 구현 | `@oa-sdk/router`의 순수 `*.contract.ts`와 Hono/Express/Fastify/Elysia 라우터 코드 생성. 비즈니스 구현·서버 실행은 사용자 책임 | [핸들러 계약](./backend-handler-contracts.md), [router](../../packages/router/README.md) |
| 프론트엔드·서비스 클라이언트 | `@oa-sdk/client`의 fetch SDK, 취소·스트리밍, TanStack Query v5 키·옵션·React 훅 생성 | [클라이언트·쿼리 소비](./client-and-query-consumption.md) |
| 다른 호출 표면으로 투영 | `@oa-sdk/surface-ir`, `oa-gen surface`의 Forge projection·Overlay와 RPC contract 투영. RPC 실행 runtime은 3단계의 `@oa-sdk/rpc`가 담당 | [Forge 지원](./forge-support.md), [계약 RPC](./typespec-rpc.md) |
| 빌드 파이프라인·출처 연결 | `@oa-sdk/codegen/plugin`의 TypeSpec 빌더, trace manifest, 생성 선언의 TypeSpec graph semantic sidecar | [빌더 플랫폼](./typespec-builder-platform.md), [graph semantic index](./typespec-graph-semantic-index.md) |

### 3 실행과 도구 연결

| 작업 | 기능·시작점·범위 | 문서 |
| --- | --- | --- |
| typed procedure 호출·제공 | **저장소 전용** `@oa-sdk/rpc`의 unary client/server, JSON-RPC 2.0·REST binding. streaming procedure는 제외 | [계약 RPC](./typespec-rpc.md), [rpc](../../packages/rpc/README.md) |
| 별도 Origin 팝업과 양방향 호출 | **저장소 전용** `@oa-sdk/popup-bridge`의 Origin 검증 핸드셰이크, `MessageChannel` 위 JSON-RPC·이벤트, `defineContract` 타입 선언과 RPC 생성 유틸리티. Host 새로고침 자동 복구와 COOP `same-origin` Host는 제외 | [팝업 브리지](./popup-bridge.md), [popup-bridge](../../packages/popup-bridge/README.md) |
| 도구 계약을 MCP·CLI·HTTP로 제공 | `@oa-sdk/tools`에서 JSON Schema 도구를 정의하고 adapter로 노출. API 계약에서 도구를 자동 생성하는 기능과는 구분 | [tools](../../packages/tools/README.md) |
| 브라우저 도구와 외부 에이전트 연결 | `webmcp-peer`의 room/router/relay/provider/client와 승인·catalog 경계. `peer-transport`, `peer-server`, `mcp-mesh`는 전송·세션·협업 primitives. 호스팅 서비스나 운영 인프라를 자동 제공하지 않음 | [WebMCP 가이드](./webmcp-projection-and-relay-guide.md), [webmcp-peer](../../packages/webmcp-peer/README.md), [보안 경계](../security/webmcp-hardening.md) |

### 4 검증과 리뷰

| 작업 | 기능·시작점·범위 | 문서 |
| --- | --- | --- |
| OpenAPI 해석·검증 | `@oa-sdk/parser`의 IR·ref graph·lint·validate·query; `oa-gen validate`·`lint` | [OpenAPI 3.2 계약 관리](./openapi32-contract-management.md), [parser](../../packages/parser/README.md) |
| 개발·테스트용 mock | `@oa-sdk/mock-server`의 Node HTTP/MSW adapter, validation, 인메모리 상태, watch 시 route 교체. 운영 API 호스팅 대체가 아님 | [Mock 사용법](./mock-server-usage.md) |
| 변경·생성물·런타임 차이 검사 | `diff`, `tsp diff`, `check-artifact`, `drift`, `review-bundle`; breaking-change 차단은 명시한 gate/옵션으로 적용 | [거버넌스 워크플로](./use-cases/openapi-governance-workflow.md), [CLI 레퍼런스](./cli-command-reference.md) |
| 스펙 변경 이력 관측 | **저장소 전용** Spec-Lens의 revision·diff·timeline·graph·provenance. TypeSpec output-pointer provenance의 가용성은 별도 표시 | [Spec-Lens](../spec-lens/README.md), [구현 현황](../internal/spec.md) |

### 5 런타임 지원

| 작업 | 기능·시작점·범위 | 문서 |
| --- | --- | --- |
| chunk·시계열·재생 UI | `chunk-stream`, `chunk-stream-crdt`, `chunk-stream-ui`, `chunk-stream-timeseries`, `chunk-stream-react`의 bounded stream·병합·재생 primitives | [진입점 지도](./library-entrypoints.md), [API index](../internal/api-index.md) |
| 실행 중 파일·공유 상태 다루기 | `@oa-sdk/collab-workspace`의 인메모리 Tree-Lattice, presence, 범위가 있는 intent lock | [collab-workspace](../../packages/collab-workspace/README.md), [협업 개념](../concepts/webmcp-peering-mesh-and-collab.md) |
| 설계 단계에서 telemetry 연결 | `@oa-sdk/telemetry`의 추적 심볼, XState v5 inspector, dispatcher, HMAC sanitizer. `@oa-sdk/dpm` 설치·실행에 의존하지 않음 | [telemetry](../../packages/telemetry/README.md) |

핸들러·클라이언트·mock을 CLI로 생성/실행할 때는
[동반 패키지 설치](./cli-setup.md#동반-패키지-companion-packages)를 확인한다.
`@oa-sdk/codegen` 설치가 모든 Downstream을 함께 설치한다는 뜻은 아니다.
`webmcp-peer`·`telemetry` 등의 배포 후보 등록도 npm 설치 가능성을 보장하지 않는다.

## 빌드 설정의 세 용도

2단계에서 **코드를 생성할 대상**을 구성할 때는 `PipelinePurpose`의 세 값을 쓴다.
`TspConfig.purpose`와 `oa.config.ts`의 `specs[].purpose`에 적용한다. 도구 노출·변경 검사·관측을 위해
별도의 `purpose` 문자열을 추가하지 않는다.

| 설정 | 입력 조건 | 선택할 출력 | 대표 사용 목적 |
| --- | --- | --- | --- |
| `data` | 모델이 있고 HTTP operation이 없음 | 타입·가드·Pydantic DTO·데이터 변환 구성; client/router/query/RPC 플러그인은 거부 | 이벤트 payload, 설정·공유 모델 등 데이터 구조 |
| `api` | HTTP operation이 최소 1개 | 타입·핸들러·라우터·SDK 등 필요한 플러그인 명시 | API 서버 계약과 구현 준비 |
| `interface` | 모델 또는 operation이 있음 | 소비자 타입·핸들러·SDK·RPC 등 필요한 출력 명시 | 다른 서비스·앱이 사용할 인터페이스 |

미지정은 기존 혼합 동작과 호환된다. 모델 전용 `.tsp`도 현재 OpenAPI emitter 경로에서는
`@service` namespace가 필요하다. 이 구성은 [파이프라인 가이드](./pipeline-configuration.md)와
실제 [입력 검사](../../packages/codegen/src/pipeline-purpose.ts)를 따른다.

### 자주 쓰는 조합

| 작업 | 조합 |
| --- | --- |
| HTTP 없는 데이터 모델 공유 | 모델 원본 → `data` 타입·guard 생성 → 생산자·소비자에서 검증 |
| 백엔드 API 만들기 | 계약 작성 → 검증 → `api` 타입·핸들러·라우터 생성 → 비즈니스 핸들러 구현 → mock·diff 검사 |
| 프론트엔드 API 붙이기 | 관리 중인 계약 입력 → `interface` 클라이언트·Query 생성 → 앱에서 소비 |
| 에이전트 도구 제공 | 입력 schema와 handler 정의 → tools MCP/CLI/HTTP adapter → 필요 시 peer 연결 |

## 주목적별 패키지 배치

현재 workspace **39개(`packages/` 35개·앱 4개)**를 위와 같은 순서로 주목적 한 곳에 배치했다.
같은 패키지가 여러 단계에서 쓰일 수 있다. 패키지 이름은 `@oa-sdk/` 접두사를 생략한다.
`†`는 Maintenance 범위이며, 목적에 포함해도 신규 기능 활성화를 뜻하지 않는다.
private·배포 후보·배포 기록은 [진입점 지도](./library-entrypoints.md)에서 확인한다.

| 순서·주목적 | `packages/` | 앱 |
| --- | --- | --- |
| 1. 계약 입력·해석 기반 | `core`, `openapi-projection-contract`, `typespec-decorators`, `schemas`, `parser`, `typespec-tooling`† | — |
| 2. 코드 생성·투영 | `codegen`, `ast-sync`, `surface-ir`, `router`, `client` | — |
| 3. 실행·도구 연결 | `rpc`, `tools`, `peer-transport`, `peer-server`, `webmcp-peer`, `mcp-mesh`, `popup-bridge` | — |
| 4. 검증·검토·개발 도구 | `mock-server`, `ftp-contract`, `spec-lens`, `spec-lens-contract`, `typia-mock`†, `ttsc-compile-fixture`† | `@oa-sdk/nestjs-ref`, `@oa-sdk/playground`, `@oa-sdk/preview`, `@oa-sdk/spec-lens-ui` |
| 5. 런타임 데이터·공유·관측 | `chunk-stream`, `chunk-stream-crdt`, `chunk-stream-ui`, `chunk-stream-timeseries`, `chunk-stream-react`, `collab-workspace`, `telemetry` | — |
| 별도 유지 범위 | `dpm`†, `personas`†, `logical-erd-contract`†, `typespec-erd`† | — |

`apps/fastapi-ref`는 추가 reference 소스이며 pnpm workspace 수에는 포함하지 않는다.
문서·CLI·API index·릴리스·타입 검사 명령은 [거버넌스/범위](../internal/platform-scope.md)와
저장소 `package.json`을 따르는 기여자용 유지 작업이다.

## 현재 작업트리에서 추가·보강 중인 기능

아래는 **2026-10-26 작업트리의 미커밋 변경**이다. 소스와 export·테스트 파일의 존재를 확인한
목록이며, 이 정리에서 해당 기능의 테스트 통과·서비스 상호운용·npm 배포를 검증하지 않았다.
기존 공개 package의 동작 설명과 이 추가 소스를 분리해 읽는다.

| 목적 | 추가·보강 내용 | 소스 위치 |
| --- | --- | --- |
| 1. 도구 계약 작성 | `@toolGroup`, `@oaTool`, inspect/plan/apply/verify/handoff 및 CLI/MCP/table metadata | `packages/typespec-decorators/lib/tool-pipeline.tsp`, `packages/typespec-decorators/src/tool-pipeline.ts` |
| 2. 타입·검증기 생성 | AST guard 렌더링 및 플러그인의 공통 guard 생성 경로 보강, OAS 3.2 schema·operation 기반 Pydantic v2 타입 생성 | `packages/ast-sync/src/guards/generator.ts`, `packages/codegen/src/plugin/plugins/typescript.ts`, `packages/codegen/src/pydantic/`, `packages/codegen/src/cli/commands/generate-pydantic.ts` |
| 2. 도구 구성 생성 | `hydrateToolsFromOpenApi`, skill·harness 문서 생성, Standard Schema bridge | `packages/tools/src/openapi-hydrator.ts`, `standard-schema.ts` |
| 3. 도구 실행·인계 | CLI-Anything·mcp-use adapter, session·preview·handoff 저장 계약 | `packages/tools/src/cli-anything.ts`, `mcp-use.ts`, `reserved-interfaces.ts` |
| 5. 표 데이터 지원 | 여섯 adapter 계열의 공통 Table IR, patch 계획과 로컬 파일 I/O 소스 | `packages/tools/src/table-ir.ts`, `table-file-io.ts` |

기존 tools 진입점은 직접 정의한 도구/schema를 adapter로 노출하는 API다. OpenAPI hydrator는 위의
추가 소스로 구분한다. 표 adapter 계열 이름은 각 오피스 앱·클라우드 서비스의 완전한 직접 연동을
검증했다는 뜻이 아니다. 구체적인 파일 형식·범위는 해당 소스와 테스트를 확인한다.

## 상태를 읽는 기준

- **Core**: 계약 작성·해석·검증·생성·관측의 제품 중심이다. Core라도 저장소 전용일 수 있다.
- **Downstream**: Core 계약을 소비하는 연동 라이브러리다. Core의 필수 설치 항목은 아니다.
- **저장소 전용**: 이 checkout의 private workspace다. public export가 있어도 npm 배포를 뜻하지 않는다.
- **Maintenance**: 기존 호환성·보안·이전 경계를 유지한다. 구현이 있다고 신규 기능을 자동 재개하지 않는다.
- **외부 제품 / TODO**: 다른 저장소가 소유하거나 아직 활성화하지 않은 범위다.

분류의 정본은 [Platform Scope](../internal/platform-scope.md)와
[release policy](../internal/release-policy.json)다. 현재 workspace는 Core 11 / Downstream 17 /
Maintenance 7 / Apps 4개다. 구현 여부, 공개 import, 배포 후보, 실제 npm 배포, 운영 준비는 서로 다르다.
이 지도는 2026-10-31의 현재 작업트리 기준이다. 미커밋 확장은 위에 따로 표시하며, npm registry의 현재 버전을 조회한 결과가 아니다.

API·데이터 구조·소비자 인터페이스를 독립적으로 구성하는 방법은
[용도별 파이프라인 구성](./pipeline-configuration.md)을 따른다.

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
| 현재 보장 범위·검증 수준·결함 상태 | [검증·리뷰 현황](../internal/verification/status.md), [관리 규칙](../internal/verification/README.md) — 직접 실행·cache·미평가·결함 분리 |
| 과거 실행 리뷰·발견 경위 | [2026-10-26 기능 리뷰](../reports/feature-review-2026-10-26.md) — 당시 관측 기록 |
| 현재 작업과 미래 과제 | [Plan](../internal/plan.md), [Todo](../internal/todo.md) — 완료 이력과 active task를 구분 |

`✅`나 테스트 통과는 해당 구현의 검증 기록이다. npm 배포 완료, 모든 입력 지원 또는 운영 준비 완료의 표시는 아니다.
