# 라이브러리 진입점 지도

oa-sdk는 하나의 runtime SDK가 아니라 OpenAPI 계약을 작성·검증·소비·관찰하는 workspace다.
아래 표는 신규 사용자가 import 또는 변경을 시작할 때의 첫 경계다. 전체 export symbol은
[API index](../internal/api-index.md)가 정본이며, 이 문서는 기능 선택과 공개 entrypoint를
안내한다.

## 계약과 변환

| 패키지 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- |
| `@oa-sdk/schemas` | production TypeSpec source와 generated OpenAPI artifact | package root, `./openapi.yaml`, `./openapi.json` | [기본 스펙 사용 기준](./basic-spec-usage.md) |
| `@oa-sdk/typespec-decorators` | versioned OA SDK TypeSpec helper | package root | [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| `@oa-sdk/typespec-erd` | private logical ERD TypeSpec prototype와 `oa-erd` artifact CLI | package root, `oa-erd` | [논리 ERD authoring](./typespec-logical-erd-authoring.md) |
| `@oa-sdk/typespec-tooling` | TypeSpec IDE 설정 템플릿, 생산성 스니펫, 커스텀 linter 규칙 모음 | package root, `./snippets`, `./linter` | [TypeSpec IDE 설정](./typespec-ide-setup.md) |
| `@oa-sdk/logical-erd-contract` | private logical ERD artifact·validation·semantic diff contract | package root | [논리 ERD authoring](./typespec-logical-erd-authoring.md) |
| `@oa-sdk/parser` | OpenAPI 3.2 → ParsedDocument IR | package root, `./browser` | [Quick Start](./quick-start.md) |
| `@oa-sdk/codegen` | typegen, Zod 4 코드 생성, Drizzle/Zod 변환, `oa-gen` governance CLI | package root, `./drizzle`, `./typegen`, `./typegen/browser`, `./zodgen`, `./spec-lens`, `./apitomy` | [CLI 명령 레퍼런스](./cli-command-reference.md) |
| `@oa-sdk/core` | package 공통 utility | package root, `./browser` | [API index](../internal/api-index.md) |
| `@oa-sdk/ast-sync` | V3 AST 무손실 양방향 동기화 엔진 및 Standalone Guard generator | package root, `./guards` | [API index](../internal/api-index.md) |
| `@oa-sdk/openapi-projection-contract` | source adapter가 공유하는 projection envelope wire contract | package root | [기본 스펙 사용 기준](./basic-spec-usage.md) |

## 계약 소비와 테스트

| 패키지 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- |
| `@oa-sdk/client` | fetch 기반 타입 안전 클라이언트 SDK 생성기, 런타임 클라이언트 타입/에러/인증 미들웨어, TanStack Query v5 3계층 코드 생성 | package root, `./browser` | [Quick Start](./quick-start.md) |
| `@oa-sdk/router` | OAS 기반 Hono/Express/Fastify/Elysia router 및 순수 핸들러 계약(contract) stub | package root, `./browser` | [Quick Start](./quick-start.md) |
| `@oa-sdk/mock-server` | Node HTTP/MSW mock과 request/response validation | package root, `./browser`, `./adapters/msw`, `./adapters/node-http` | [Mock testing](./use-cases/mock-testing.md) |
| `@oa-sdk/typia-mock` | typia LLM application 기반 mock validation | package root | [API index](../internal/api-index.md) |

## 거버넌스·관측·데이터 경계

| 패키지 | 시작 역할 | 공개 entrypoint | 먼저 볼 자료 |
| --- | --- | --- | --- |
| `@oa-sdk/spec-lens` | contract history, graph, provenance observation | package root | [TypeSpec provenance 계획](../internal/typespec-roundtrip/declaration-ref-provenance-validation-plan.md) |
| `@oa-sdk/spec-lens-contract` | Spec Lens HTTP API의 browser-safe wire contract | package root | [API index](../internal/api-index.md) |
| `@oa-sdk/dpm` | relationship-first DPM manifest, catalog, logical-data binding | package root, `./catalog`, `./data`, `./profile`, `./relationship`, `./gateway`, `./storage`, `./publishing`, `./execution` | [DPM roadmap](../internal/goals/dpm-master-roadmap.md) |
| `@oa-sdk/personas` | persona registry와 domain matrix validation | package root, registry/trait/domain subpaths | [API index](../internal/api-index.md) |
| `@oa-sdk/tools` | TypeSpec JSON Schema 기반 MCP 도구 및 Interactive CLI 브릿지 엔진 | package root | [TypeSpec 토폴로지 가이드](./typespec/06-generation-topologies-and-rules.md) |

## 내부 전용 fixture

| 패키지 | 용도 | 사용자 선택 |
| --- | --- | --- |
| `@oa-sdk/ttsc-compile-fixture` | generated TypeScript의 TypeScript-Go compile compatibility fixture | 일반 library import 대상으로 사용하지 않는다. |

## import와 artifact의 구분

- package root와 `package.json`의 `exports`에 있는 subpath만 public API로 본다. source deep import는
  지원 계약이 아니다.
- `.merged*.yaml`, `dist/`, TypeSpec candidate/provenance report는 생성·검토 artifact다. production
  contract를 바꿀 때는 [TypeSpec 규칙](./typespec-authoring-conventions.md)의 `.tsp` 경로를 따른다.
- 새 기능을 찾을 때는 이 표에서 package를 고른 뒤 API index의 symbol을 확인하고, 해당 package의
  test와 public export를 함께 변경한다.
