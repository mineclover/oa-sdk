# OpenAPI Projection

OpenAPI Projection은 외부 시스템이나 builder가 내보내는 OpenAPI-shaped artifact와 그
metadata envelope다.

Projection profile은 projection의 사용 범위를 나타낸다.

- `component-bundle`: reusable components 중심
- `operation-contract`: 특정 operation 계약 중심
- `full-api-document`: 전체 API document

Projection envelope과 validation boundary는 `@oa-sdk/openapi-projection-contract`가 담당한다.

구현 상세는 [OpenAPI Projection Contract](../../packages/openapi-projection-contract/README.md),
아키텍처 결정은 [ADR-007](../internal/architecture/007-shared-schema-engine-vocabulary.md)을
참조한다.

## DPM Catalog Input

[Data Pseudonymization Manifest](./data-pseudonymization-manifest.md)는 DB catalog snapshot을
필요로 한다. DB나 table schema producer가 OpenAPI projection envelope을 제공하면 DPM의
`catalog` 입력은 projection `sources`, `refs`, `diagnostics`, `versionHash`를 freshness와
검증 근거로 사용할 수 있다.

이때 projection은 DB 구조를 설명하는 snapshot이다. Logical relationship의 lifecycle source of
truth는 Relationship Registry이고, DPM은 approved relationship snapshot을 함께 고정해 namespace,
column transform, vault, publishing 정책을 선언한다. 가명처리 정책 본문을 projection OpenAPI
document 안에 인라인하지 않는다.
