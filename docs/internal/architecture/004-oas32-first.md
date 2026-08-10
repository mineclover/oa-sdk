# ADR-004 — OAS 3.2 canonical authoring, no 3.1 source compatibility

## 상태

채택됨

## 컨텍스트

OAS 3.2.0 (2025년 9월 릴리스)은 3.1에서 다음을 변경/추가:
- `examples` 필드: `value` → `dataValue` / `serializedValue` 분리
- SSE: `text/event-stream` + `itemSchema` 공식 지원
- OAuth: `deviceAuthorization` flow (RFC 8628), `oauth2MetadataUrl` (RFC 8414)
- HTTP `QUERY` 메서드 공식 추가

3.1 호환 레이어를 유지하면 3.2 문법을 제약해야 하고 Spectral 오탐이 증가.

## 결정

`openapi: 3.2.0` canonical contract 단독 사용. 사람이 작성하거나 관리하는 OpenAPI source에는
3.1 문법(`examples[].value` 등)을 사용하지 않는다.
3.1 전용 consumer를 위한 generated downgrade artifact는 authoring source나 동등한 compatibility
layer가 아니며, canonical 3.2 contract에서만 파생한다.
Spectral 3.2 미지원 규칙은 전부 off → [ADR-005](./005-spectral-redocly-split.md).

## 결과

- OAS 3.2 전용 문법 자유롭게 사용
- Swagger UI 등 3.1 consumer는 generated compatibility artifact만 사용
- Spectral 오탐 최소화
- 공식 스펙 원문을 `references/OpenAPI-Specification/` 서브모듈로 관리
