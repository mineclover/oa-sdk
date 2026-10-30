# Contract Ownership Boundaries

이 문서는 oa-sdk의 계약 입력·artifact·소비자 경계를 한 곳에서 설명한다. 제품 범위는
[Platform Scope](./platform-scope.md), 구현 현황은 [Spec](./spec.md), 물리 package와
dependency 방향은 [package architecture](./architecture/packages.md)가 정본이다.

## 한 문장으로 보는 위치

oa-sdk는 **실행 가능한 API 계약과 그 계약의 정규화·검증·생성·변경 관측 계층**을 소유한다.
저장소가 소유한 production API의 저작 정본은 TypeSpec이고, OpenAPI 3.2는 TypeSpec에서
승격된 canonical interchange artifact이자 외부 producer가 들어오는 입력 경계다. Router,
client, mock, RPC, tools와 같은 runtime은 이 계약을 소비한다. 서비스의 DB·BFF·UI·ADR·운영
lifecycle 관계는 oa-sdk의 ownership이 아니다.

## 경계 매트릭스

| 경계 | 권위 입력/정본 | oa-sdk가 소유하는 것 | 생성·소비 결과 | 소유하지 않는 것 |
|---|---|---|---|---|
| Production TypeSpec API | `packages/schemas/typespec/**/*.tsp` | API 모델·operation·HTTP 의미, versioned decorators, provenance, bundle/approval 정책 | TypeSpec compiler output, approved snapshot, restored OpenAPI 3.2 | 생성된 YAML을 직접 저작하는 workflow |
| OpenAPI artifact/intake | TypeSpec가 생성한 OAS 3.2 또는 외부 producer의 YAML/JSON/projection envelope | `openapi-projection-contract`, parser IR/ref graph/lint/validate/query, normalize/diff/drift/review | `ParsedDocument`, typegen, Zod/guard, router/client/mock/RPC 입력 | 외부 문서를 repository production SSOT로 자동 승격하는 것 |
| External schema producer | NestJS/FastAPI/Drizzle/Zod/TS module/Apitomy 등 producer-owned output | collect/upgrade/projection envelope와 gate를 통한 수용 경계 | 검증된 외부 artifact와 derived declarations | producer의 source model·DB migration·framework runtime |
| Target-neutral projection | `ParsedDocument`와 schema IR | `surface-ir`의 target-neutral surface, Forge/OpenAPI Overlay/RPC projection | target-specific command·procedure metadata | TypeSpec source나 canonical OAS를 projection metadata로 수정하는 것 |
| TypeScript AST/source adapter | 명시적으로 구성된 TS/Zod/Typia/JSON Schema source | `ast-sync`, type registry, declaration/provenance observation, standalone guards | generated declaration·guard·AST patch | TypeScript declaration을 repository API contract SSOT로 암묵 승격하는 것 |
| Runtime consumers | OAS/ParsedDocument/Surface IR/JSON Schema | router/client/mock-server와 RPC runtime의 compatibility contract | HTTP handler/router, fetch SDK, mock response, procedure runtime | business logic, service hosting, auth policy, DB persistence |
| Tool bridge | caller-owned JSON Schema 또는 OpenAPI hydrator input | `@oa-sdk/tools`의 MCP/CLI/HTTP adapter, session/preview/handoff 경계 | tool descriptor, CLI/MCP surface, bridge runtime | API contract의 SSOT 또는 자동 API-to-tool 의미 결정 |
| Non-HTTP data/behavior | Behavior/FSM, logical ERD, DB catalog, DPM manifest | 각 package의 bounded contract와 validation | behavior IR, logical-erd artifact, DPM snapshot/plan | HTTP OpenAPI contract에 무리하게 합치기, physical migration/FK mutation |
| External architecture | `archi-adr`/`data-governance` owned artifacts | interchange/provenance artifacts와 CI handoff | SourceArtifactDefinition/implementation 소비, DPM mirror compatibility | API/BFF/UI/DB/ADR lifecycle graph, 신규 DPM feature/release |

## TypeSpec production boundary

저장소가 직접 관리하는 production API를 변경할 때는 `packages/schemas/typespec`의 TypeSpec를
먼저 수정한다. `@oa-sdk/typespec-decorators`는 response component, persona, pseudonymization,
trace/evidence 같은 확장과 provenance를 TypeSpec 선언에 붙인다. `schema:typespec-check`,
approval, rollback, downstream, `schema:validate` gate가 TypeSpec → OpenAPI promotion을
검증한다.

`packages/schemas/src/.merged.yaml`, `approved.openapi.yaml`, `dist/openapi.*`, generated
TypeScript/router/client는 derived artifact다. 이 파일을 직접 수정해 source drift를 해결하지
않는다.

## OpenAPI artifact boundary

OpenAPI 3.2는 downstream이 읽는 표준 artifact와 외부 producer intake의 공통 언어다.
`@oa-sdk/parser`는 이를 `ParsedDocument`와 route/ref metadata로 해석하고, `@oa-sdk/codegen`
은 validate/lint/normalize/diff/drift/review/typegen/generate를 수행한다. `surface-ir`는
ParsedDocument 위에서 target-neutral projection을 만들며, `router`, `client`, `mock-server`,
`rpc`는 이 결과를 소비한다.

외부 OpenAPI/Zod/TypeScript 입력은 일반 프로젝트에서 지원하지만 repository production
path의 TypeSpec SSOT를 대체하지 않는다. 외부 producer의 artifact는 projection envelope,
source provenance, validation, freshness gate를 거쳐야 한다.

## 그 외의 위치

- `ast-sync`는 TypeScript AST와 EntitySpec/type adapter를 동기화하는 adapter 계층이다.
- `spec-lens`는 source/artifact의 revision·diff·timeline·provenance를 관측하는 계층이다.
- `tools`는 caller-owned JSON Schema를 MCP/CLI/HTTP로 연결하며 API contract의 의미를 소유하지 않는다.
- `chunk-stream`, `collab-workspace`, `telemetry`, `webmcp-peer`, `peer-*`, `mcp-mesh`는 downstream integration runtime이다.
- `dpm`, `personas`, `logical-erd-contract`, `typespec-erd`, `typespec-tooling`, `typia-mock`,
  `ttsc-compile-fixture`는 maintenance/prototype 경계다. 신규 DPM 기능과 배포는 외부
  `data-governance`가 소유한다.
- `archi-adr`는 service architecture, BFF/UI/DB/ADR/rule/lifecycle 관계를 소유한다.

## 입력 선택 규칙

1. 저장소 production API를 수정하면 TypeSpec를 선택하고 bundle/promotion gate를 실행한다.
2. 외부 API를 연결하면 OpenAPI YAML/JSON 또는 projection envelope를 선택하고 validate/ref/provenance gate를 실행한다.
3. HTTP가 없는 데이터·behavior·logical ERD는 해당 bounded contract를 사용하며 OpenAPI operation으로 포장하지 않는다.
4. runtime package는 계약을 소비하고, 계약의 의미·source ownership을 재정의하지 않는다.

자세한 authoring 규칙은 [TypeSpec authoring conventions](../guides/typespec-authoring-conventions.md),
OpenAPI 구조와 artifact 규칙은 [schema architecture](../guides/schema-architecture-and-conventions.md),
projection envelope은 [OpenAPI Projection](../concepts/openapi-projection.md)을 따른다.
