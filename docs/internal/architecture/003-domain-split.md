# ADR-003 — 도메인 단위 spec 분리 + merge.ts

## 상태

채택됨

## 컨텍스트

단일 `openapi.yaml`에 모든 경로/컴포넌트를 넣으면:
- 팀별 충돌 빈발
- 도메인 간 의존성 파악 어려움
- 파일 크기 비대화

파일 단위 `$ref` 포인터 방식(`paths: $ref: ./paths/users.yaml`)도 검토했으나  
OAS 3.1에서 `paths` 값으로 `$ref` 허용이 비표준 → Spectral `oas3-schema` 오류.

## 결정

각 도메인이 **완전한 부분 OpenAPI 스펙**(`paths` + `components`)을 `spec.yaml`로 관리.  
`merge.ts` 스크립트가 런타임에 병합하여 `.merged.yaml` 생성.

병합 규칙:
- `common` 도메인 항상 먼저 처리
- 나머지 알파벳 순
- 중복 path → 즉시 오류
- 중복 component → 기본 오류. 임시 호환이 필요한 경우에만 명시적 override allow-list 또는 `ALLOW_COMPONENT_OVERRIDES=1` 사용

## 결과

- 도메인별 독립 파일 관리
- 새 도메인 추가 = `src/domains/{name}/spec.yaml` 파일 하나
- `openapi.yaml`은 info + tags만 담당 (거의 변경 없음)
