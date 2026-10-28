# 라이브러리 진입점 지도

oa-sdk는 하나의 runtime SDK가 아니라 OpenAPI 계약을 작성·검증·소비·관찰하는 workspace다.
아래 표는 신규 사용자가 import 또는 변경을 시작할 때의 첫 경계이며, 각 패키지를 npm에서 설치할 수
있는지 판단할 배포 기록도 함께 보여 준다. 전체 export symbol은 [API index](../internal/api-index.md)가 정본이다.
목적별 기능 선택은 [기능 선택 지도](./feature-map.md), 구체적인 import 선택은 이 문서를 따른다.
구현 설명은 저장소의 `@oa-sdk/codegen` 0.10.0 기준이며 npm 현재 버전을 뜻하지 않는다.

`배포` 열은 저장소의 배포 기록·계획이며 실시간 registry 조회 결과가 아니다.
변경 내용은 [변경 이력](../changelog.md), 실제 설치 가능 버전은 `npm view <package> version`으로 확인한다.

- **npm**: 기존 npm 배포 기록이 있는 패키지다. checkout의 version과 현재 registry 버전이 같다는 뜻은 아니다.
- **0.9.0부터**: `@oa-sdk/codegen` 0.9.0 릴리스부터의 배포 대상으로 안내된 패키지다. 설치 시 registry에서 확인한다.
- **배포 후보**: 배포 후보(`distributionCandidates`)로 등록됐지만 이 문서에서 배포 완료를 확인하지 않은 패키지다. 후보 등록만으로 설치 가능성을 보장하지 않는다.
- **비공개**: 이 저장소의 `private: true` workspace다. 여기서 npm에 배포하지 않는다. 같은 이름의 외부 제품 배포 여부와는 별개다.

공개 패키지는 모두 Node.js 22 이상을 요구한다.

## 계약과 변환

| 패키지 | 배포 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- | --- |
| `@oa-sdk/typespec-decorators` | npm | OA SDK TypeSpec 데코레이터와 표준 계약(`Ok`, `ErrorResponse`, `StandardHttpErrors` 등, `OaSdkTypeSpec` namespace). 표준 계약은 0.3.0부터 | package root, `./api`, `./governance`, `./crdt`, `./behavior`, `./storage`, `./chunk-stream` | [TypeSpec 작성 의존성](./cli-setup.md#typespec-작성-의존성) |
| `@oa-sdk/parser` | npm | OpenAPI 3.2 → ParsedDocument IR, `$ref` 해석, lint/validate, RFC 6901 JSON Pointer helper(`parseJsonPointer`, `formatJsonPointer` 등) | package root, `./browser` | [parser README](../../packages/parser/README.md) |
| `@oa-sdk/surface-ir` | 0.9.0부터 | target-neutral API surface IR와 Forge SDK/CLI projection·Overlay 생성, operation을 RPC procedure로 투영하는 RPC contract(`buildRpcContract`). `@oa-sdk/codegen`의 런타임 의존성으로 함께 설치되며 `oa-gen surface`가 사용 | package root | [Cloudflare Forge 지원](./forge-support.md), [rpc README](../../packages/rpc/README.md) |
| `@oa-sdk/codegen` | npm | typegen, Zod 4 코드 생성, Drizzle/Zod 변환, `oa-gen` CLI(bin `oa-gen`), TypeSpec 플러그인 빌드 파이프라인(`./plugin`: `createTspBuilder`, `defineTspConfig`, `pluginTypescript`/`pluginClient`/`pluginTanstackQuery`/`pluginRouter`/`pluginWire`/`pluginRpc`) | package root, `./drizzle`, `./typegen`, `./typegen/browser`, `./zodgen`, `./spec-lens`, `./apitomy`, `./plugin` | [CLI 명령 레퍼런스](./cli-command-reference.md) |
| `@oa-sdk/core` | npm | package 공통 utility | package root, `./browser` | [API index](../internal/api-index.md) |
| `@oa-sdk/ast-sync` | npm | V3 AST 무손실 양방향 동기화 엔진 및 Standalone Guard generator | package root, `./guards` | [API index](../internal/api-index.md) |
| `@oa-sdk/openapi-projection-contract` | npm | source adapter가 공유하는 projection envelope wire contract | package root | [API index](../internal/api-index.md) |

## 계약 소비와 테스트

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `oa-gen`이 실행 중 불러오는 동반 패키지이기도 하다.
어떤 `oa-gen` 명령에 필요한지는 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 따른다.

| 패키지 | 배포 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- | --- |
| `@oa-sdk/client` | 0.9.0부터 | fetch 기반 타입 안전 클라이언트 SDK 생성기, 런타임 클라이언트 타입/에러/인증 미들웨어, TanStack Query v5 3계층 코드 생성 | package root, `./browser` | [프론트엔드 SDK 및 쿼리 소비](./client-and-query-consumption.md) |
| `@oa-sdk/router` | 0.9.0부터 | 빌드 타임 생성 함수: Hono/Express/Fastify/Elysia 라우터 코드(`generateRouter`)와 프레임워크와 무관한 핸들러 계약(`generateHandlerContract`). 문자열을 돌려주며 런타임 mount helper와 CLI는 없다 | package root, `./browser` | [router README](../../packages/router/README.md), [백엔드 핸들러 계약](./backend-handler-contracts.md) |
| `@oa-sdk/mock-server` | 0.9.0부터 | OpenAPI mock engine과 request/response validation. 패키지 루트와 `./adapters/node-http`는 Node HTTP 서버(`createNodeMockServer`)와 테스트 helper를 제공하며 `msw` 없이 동작한다. `./adapters/msw`와 `./browser`는 MSW adapter이며 선택적 peer `msw`가 필요하다. bin `oa-mock` | package root, `./adapters/node-http`, `./adapters/msw`, `./browser` | [Mock 서버 사용법](./mock-server-usage.md), [Mock testing](./use-cases/mock-testing.md) |
| `@oa-sdk/chunk-stream` | npm | 유니버설 Chunk Stream 런타임, 단일 와이어 스키마 v1 envelope, 메모리 상주 리스, 가상화 윈도우 엔진 | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/chunk-stream-crdt` | npm | CRDT Delta Join Semi-Lattice 머지 엔진, 벡터 시계, Compaction Horizon GC | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/chunk-stream-ui` | npm | UI Action 어댑터, ContentPort 원자적 배치 브리지, StoryboardDocument 스트림 변환 및 재생 브리지 | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/chunk-stream-timeseries` | npm | 다채널 시계열 텔레메트리 어댑터, LTTB 다운샘플링, 데시메이션 | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/chunk-stream-react` | npm | React 18/19 타임라인 재생 및 스크러빙 훅, 피어 상주 인식, 원격 측정 오버레이 | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/telemetry` | 배포 후보 | 추적 심볼 레지스트리, XState v5 비침습 인스펙터, HMAC sanitizer 및 다중 프로바이더(GTM/Sentry/OTel) 디스패처. `@oa-sdk/dpm`에 의존하지 않음 | package root | [telemetry README](../../packages/telemetry/README.md), [Design-Driven Telemetry](../concepts/design-driven-telemetry.md) |

## 도구·피어 통신

| 패키지 | 배포 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- | --- |
| `@oa-sdk/tools` | npm | JSON Schema로 정의한 도구를 MCP·CLI·HTTP로 노출하는 adapter(`defineTool`, `createSchemaTool`, `createMcpServer`, `createCli`). 계약에서 도구를 자동 생성하지는 않는다 | package root | [tools README](../../packages/tools/README.md) |
| `@oa-sdk/webmcp-peer` | 배포 후보 | 룸 기반 Streamable HTTP MCP 라우터·WebSocket 시그널링 데몬(`server`), 브라우저/호스트 Provider(`provider`), 외부 에이전트/CLI 세션 클라이언트(`client`), 초대 링크·프로필·헬스 프로브(`config`)를 아우르는 3-Tier 단일 통합 패키지 (런타임 의존성 0개) | package root, `./config`, `./client`, `./provider`, `./server` | [webmcp-peer README](../../packages/webmcp-peer/README.md), [WebMCP 프로젝션 가이드](./webmcp-projection-and-relay-guide.md) |
| `@oa-sdk/peer-transport` | 배포 후보 | 3채널(mcp-jsonrpc, crdt-delta, presence) 패킷 다중화, 우선순위 버퍼링, WebMcpBridgeClient, WebSocketTransportAdapter, CloudTransitClient (런타임 의존성 0개) | package root, `./adapters` | [WebMCP 프로젝션 가이드](./webmcp-projection-and-relay-guide.md) |
| `@oa-sdk/peer-server` | 배포 후보 | 기본 포트 8787의 HTTP 피어 레지스트리, 랑데부 디스크립터, WebSocket 시그널링/패킷 중계(`relay`), Cloud Transit Proxy(`cloud`, `/transit/:peer/mcp`) | package root, `./relay`, `./cloud` | [WebMCP 프로젝션 가이드](./webmcp-projection-and-relay-guide.md) |
| `@oa-sdk/collab-workspace` | 배포 후보 | path/line 검증을 포함한 in-memory Tree-Lattice와 scoped intent locks | package root | [WebMCP peering mesh](../concepts/webmcp-peering-mesh-and-collab.md) |
| `@oa-sdk/mcp-mesh` | 배포 후보 | canonical domain skill, runtime session, validated namespaced routing, peer session hydration 및 CLI(bin `oa-mesh`, `oa-tools`) | package root, `./cli` | [WebMCP 프로젝션 가이드](./webmcp-projection-and-relay-guide.md) |

## 저장소 전용 패키지 (비공개)

아래 패키지는 oa-sdk 저장소 안에서만 쓴다. `@oa-sdk/schemas`, `@oa-sdk/spec-lens`, `@oa-sdk/spec-lens-contract`는
Core Platform의 저장소 전용 패키지이고, `@oa-sdk/rpc`는 Downstream Integration의 저장소 전용 패키지이며, 나머지는
비공개 유지보수 패키지(maintenance-only, 저장소 전용)다
([Scope Tiers](../internal/platform-scope.md#scope-tiers)).

| 패키지 | 배포 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- | --- |
| `@oa-sdk/schemas` | 비공개 | production TypeSpec source와 generated OpenAPI artifact | package root, `./openapi.yaml`, `./openapi.json` | [기본 스펙 사용 기준](./basic-spec-usage.md) |
| `@oa-sdk/spec-lens` | 비공개 | 로컬 SQLite 캐시 기반 contract history, graph, provenance observation | package root | [Spec-Lens 사용법](../spec-lens/README.md) |
| `@oa-sdk/spec-lens-contract` | 비공개 | Spec Lens HTTP API의 browser-safe wire contract | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/rpc` | 비공개 | TypeSpec 계약의 operation을 typed RPC procedure로 호출·제공하는 runtime. JSON-RPC 2.0과 원래 REST route를 같은 handler로 처리(런타임 의존성 0개, `./ajv`만 선택적 peer `ajv`) | package root, `./ajv` | [rpc README](../../packages/rpc/README.md) |
| `@oa-sdk/typespec-tooling` | 비공개 | TypeSpec IDE 설정 템플릿, 생산성 스니펫, 커스텀 linter 규칙 모음 | package root, `./snippets`, `./linter` | [TypeSpec IDE 설정](./typespec-ide-setup.md) |
| `@oa-sdk/typespec-erd` | 비공개 | logical ERD TypeSpec prototype와 artifact CLI(bin `oa-erd`) | package root | [논리 ERD authoring](./typespec-logical-erd-authoring.md) |
| `@oa-sdk/logical-erd-contract` | 비공개 | logical ERD artifact·validation·semantic diff contract | package root | [논리 ERD authoring](./typespec-logical-erd-authoring.md) |
| `@oa-sdk/ftp-contract` | 비공개 | Functional Test Platform이 소비하는 정본 교환 선언(RunEvidence v1 JSON Schema·ExactRef·validator·semantic mapping·fixture) | package root, `./schema/*`, `./fixtures/*` | [ftp-contract README](../../packages/ftp-contract/README.md) |
| `@oa-sdk/typia-mock` | 비공개 | typia LLM application 기반 mock validation | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/dpm` | 비공개 | relationship-first DPM manifest, catalog, logical-data binding(bin `oa-dpm`)의 maintenance/source compatibility mirror. npm의 같은 이름 패키지는 외부 owner가 배포하며 mirror와 버전·기능을 동일시하지 않음 | package root, `./package`, `./catalog`, `./data`, `./profile`, `./relationship`, `./gateway`, `./storage`, `./publishing`, `./execution` | [mirror README](../../packages/dpm/README.md), [canonical data-governance](https://github.com/mineclover/data-governance) |
| `@oa-sdk/personas` | 비공개 | persona registry와 domain matrix validation | package root, `./registry.yaml`, `./traits/*`, `./domains/*` | [API index](../internal/api-index.md) |
| `@oa-sdk/ttsc-compile-fixture` | 비공개 | generated TypeScript의 TypeScript-Go compile compatibility fixture. 일반 library import 대상으로 사용하지 않는다 | 없음 | [TypeScript 호환성](./typescript-compatibility.md) |

## import와 artifact의 구분

- package root와 `package.json`의 `exports`에 있는 subpath만 public API로 본다. source deep import는
  지원 계약이 아니다.
- `.merged*.yaml`, `dist/`, TypeSpec candidate/provenance report는 생성·검토 artifact다. 이 저장소의 production
  contract를 바꿀 때는 [TypeSpec 규칙](./typespec-authoring-conventions.md)의 `.tsp` 경로를 따른다.
- 새 기능을 찾을 때는 이 표에서 package를 고른 뒤 API index의 symbol을 확인하고, 해당 package의
  test와 public export를 함께 변경한다.
