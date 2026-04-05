# ADR-005 — Spectral(스타일) / Redocly(구조) 역할 분리

## 상태

채택됨

## 컨텍스트

Spectral은 OAS 3.2를 미지원 (2026-04 기준):
- `oas3-schema` — `$ref` 해석 전 소스를 검사하므로 path item `$ref` 거부
- `oas3-valid-media-example` — `dataValue`/`serializedValue`를 `value` 부재로 오탐
- `oas3-valid-schema-example` — 동일 이유 오탐
- `oas3-examples-value-or-externalValue` — `dataValue`/`serializedValue` 오탐

Redocly는 `$ref`를 resolve한 뒤 검증하므로 구조 오류를 더 정확히 잡음.

## 결정

```yaml
# .spectral.yaml
oas3-schema: off
oas3-valid-media-example: off
oas3-valid-schema-example: off
oas3-examples-value-or-externalValue: off
```

Spectral 담당: **스타일 규칙만** (operationId 필수, camelCase, 응답 예제 권고)  
Redocly 담당: **구조 검증** ($ref 유효성, 스펙 준수)

## 결과

- Spectral 오탐 없음
- Redocly가 실질적인 구조 오류 잡음
- `pnpm validate` = merge → spectral → redocly 순서
