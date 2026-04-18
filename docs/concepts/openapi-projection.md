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
