# ADR-001 — Prism 미사용, 자체 AJV 엔진 채택

## 상태

채택됨

## 컨텍스트

Mock 서버로 Prism을 초기 검토했으나:
- 요청 검증 에러 메시지 포맷 커스텀 불가
- `received` / `expected` 같은 상세 필드 없음
- OAS 3.2 미지원

UI 유닛 테스트에서 검증 실패 원인을 즉시 파악하려면 상세 에러가 필수.

## 결정

AJV v8 (`verbose: true`, `allErrors: true`) 기반 자체 검증 엔진 구현.  
AJV keyword → `MockErrorCode` 8종으로 분류하는 `classifier.ts` 작성.

## 결과

- Prism 의존성 없음
- `MockErrorDetail.received` 필드로 실제 수신값 확인 가능
- OAS 3.2 문법(`dataValue`/`serializedValue`) 직접 처리 가능
