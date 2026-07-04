# System Capabilities

oa-sdk의 기본 기능은 OpenAPI/JSON Schema 호환 입력을 수집해 하나의 OpenAPI contract로
통합하고, path/component surface와 metadata를 관리하며, 검증, 비교, 생성, 실행 테스트,
운영 guard를 연결하는 것이다. 상세 구현 현황은 [spec.md](../internal/spec.md), 기능별
테스트 소유권은 [feature-test-matrix.md](../internal/feature-test-matrix.md)를 따른다.

## Authoring

계약 원천을 만든다.

- TS/JS: domain OpenAPI fragments, Definition Builder fragments, Zod/Drizzle projection input
- Python template: Pydantic DTO + `ContractRegistry`, 또는 checked-in `ContractSpec`

관련 정의: [Source Of Truth](./contract-governance.md#source-of-truth)

## Collection And Normalization

여러 라이브러리와 시스템에서 나온 OpenAPI/JSON Schema 호환 입력을 수집하고 정규화한다.

- Zod and Drizzle inputs become OpenAPI schema components.
- OpenAPI fragments become parser-visible source documents.
- Definition Builder fragments become canonical definition nodes.
- Python Pydantic DTOs become `ContractSpec.schemas`.
- Projection producers can provide component bundles or operation contracts.
- Pseudonymization workflows can consume DB catalog snapshots or OpenAPI projection envelopes as DPM catalog input, then bind approved relationships from a Relationship Registry.

관련 정의: [OpenAPI Projection](./openapi-projection.md), [Data Pseudonymization Manifest](./data-pseudonymization-manifest.md), [OpenAPI Contract](./contract-governance.md#openapi-contract)

## Path Surface Management

전체 API path surface를 하나의 관리 가능한 OpenAPI document로 조립하고 추적한다.

- Domain merge keeps path/component keys deterministic.
- Definition Builder target selection chooses path definitions and transitive components.
- Runtime drift checks compare managed paths against runtime OpenAPI paths.
- Review reports expose endpoint additions, removals, and schema changes before merge.

관련 정의: [Target](./contract-governance.md#target), [Drift](./contract-governance.md#drift)

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

## Privacy And Pseudonymization

DB 원본을 AI/분석용 target output으로 내보낼 때 source DB 범위, catalog snapshot,
Relationship Registry snapshot, logical entity, relationship namespace binding, column transform,
vault, validation, publishing 정책을 별도 manifest로 관리한다. OpenAPI는 이 manifest를
등록/검증/실행하는 gateway API 계약에 머문다.

관련 정의: [Data Pseudonymization Manifest](./data-pseudonymization-manifest.md), [Data Persona](./data-persona.md)

## Governance Metadata

문서, CLI spec, feature-test matrix, API index가 코드와 어긋나지 않도록 guard를 둔다.

- `pnpm check:api-index`
- `pnpm check:cli-spec`
- `pnpm check:feature-tests`

관련 정의: [CLI Governance Manifest](./cli-governance.md#cli-governance-manifest)
