# ADR-004 — OAS 3.2 단독, 3.1 하위 호환 없음

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

`openapi: 3.2.0` 단독 사용.  
3.1 문법(`examples[].value` 등) 사용 금지.  
Spectral 3.2 미지원 규칙은 전부 off → [ADR-005](./005-spectral-redocly-split.md).

## 결과

- OAS 3.2 전용 문법 자유롭게 사용
- Spectral 오탐 최소화
- 공식 스펙 원문을 `references/OpenAPI-Specification/` 서브모듈로 관리
