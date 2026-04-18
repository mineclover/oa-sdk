# System Capabilities

oa-sdk의 기본 기능은 OpenAPI contract를 중심으로 생산, 검증, 비교, 생성, 실행 테스트,
운영 guard를 연결하는 것이다. 상세 구현 현황은 [spec.md](../internal/spec.md), 기능별
테스트 소유권은 [feature-test-matrix.md](../internal/feature-test-matrix.md)를 따른다.

## Authoring

계약 원천을 만든다.

- TS/JS: domain OpenAPI fragments, Definition Builder fragments, Zod/Drizzle projection input
- Python template: Pydantic DTO + `ContractRegistry`, 또는 checked-in `ContractSpec`

관련 정의: [Source Of Truth](./contract-governance.md#source-of-truth)

## Validation

OpenAPI/contract 구조, refs, schema metadata, operation policy를 검증한다.

- TS/JS: `oa-gen validate`, `oa-gen lint`
- Python: `oa-contract validate`, pytest helper

관련 정의: [OpenAPI Contract](./contract-governance.md#openapi-contract)

## Comparison And Review

base/head 변경과 generated artifact freshness를 PR review surface로 만든다.

- TS/JS: `oa-gen diff`, `oa-gen check-artifact`, `oa-gen review`
- Python: `oa-contract diff`, `oa-contract check-artifact`, `oa-contract review`

관련 정의: [Diff](./contract-governance.md#diff), [Review Report](./contract-governance.md#review-report)

## Build And Targeting

source fragments를 target-specific OpenAPI document로 조립한다.

- TS/JS: Definition Builder, target selection, output naming, collision report
- Python: registry target emission for public/admin/internal slices

관련 정의: [Target](./contract-governance.md#target), [Definition Builder](./definition-builder.md)

## Parsing And Composition

서로 다른 schema/definition 입력을 읽고 조합해 완성된 OpenAPI artifact를 만든다.

- OpenAPI fragments are parsed into definition nodes and registry edges.
- Zod/Drizzle inputs can project reusable schemas into OpenAPI components.
- `$ref` graph, source metadata, and canonical ids preserve composition boundaries.
- duplicate ids, structural duplicates, and output collisions are explicit diagnostics.

관련 정의: [Definition Builder](./definition-builder.md), [OpenAPI Projection](./openapi-projection.md)

## Code Generation

OpenAPI contract에서 consumer code를 생성한다.

- TS types
- Hono/Express router stubs
- fetch client SDK
- Python OpenAPI output for FastAPI/client generation workflows

관련 정의: [Generated Artifact](./contract-governance.md#generated-artifact)

## Runtime And Test Consumption

generated contract를 mock/test/runtime check에 사용한다.

- mock server
- generated clients
- request/response validation
- coverage tracking
- runtime drift checks through `oa-gen drift` and `oa-contract drift`

관련 정의: [Runtime Adapter](./runtime-and-generation.md#runtime-adapter), [Drift](./contract-governance.md#drift)

## Governance Metadata

문서, CLI spec, feature-test matrix, API index가 코드와 어긋나지 않도록 guard를 둔다.

- `pnpm check:api-index`
- `pnpm check:cli-spec`
- `pnpm check:feature-tests`

관련 정의: [CLI Governance Manifest](./cli-governance.md#cli-governance-manifest)
