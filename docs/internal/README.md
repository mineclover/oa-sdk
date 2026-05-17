# 프로젝트 관리 SSOT

> 이 디렉터리의 문서가 단일 진실 소스(SSOT)입니다.
> 유저 가이드(`../guides/`)는 이 문서를 참조하며, 상세 정보를 직접 기술하지 않습니다.

## 문서 관계

```
spec.md (구현 현황 — 무엇이 작동하는가)
  ├─ 패키지별 기능 목록 + 테스트 수
  ├─ → feature-test-matrix.md (기능 ↔ 테스트 매핑)
  ├─ → user-scenario-tests.md (사용자 관점 E2E 시나리오)
  ├─ → api-index.md (각 함수/타입 상세)
  ├─ → oas32-coverage.md (OAS 기능별 커버리지)
  ├─ → definition-builder-compatibility-gates.md (builder parity validation gates)
  └─ → traceability.md (스펙↔코드 매핑)

plan.md (로드맵 — 어디를 향하는가)
  ├─ Phase 1~6 현황
  └─ → goals/ (목표별 상세)

*.plan.md / *.todo.md (계획 — 아직 구현 완료가 아님)
  ├─ 예상 CLI/API와 acceptance criteria
  ├─ 구현 전 설계와 phase 순서
  └─ 완료 후 spec.md/api-index.md/feature-test-matrix.md로 승격

architecture/ (설계 결정)
  ├─ packages.md (패키지 구조 + 파일별 역할)
  └─ ADR 001~007
```

## 문서별 역할

| 문서 | 역할 | 업데이트 시점 |
|------|------|-------------|
| [../vision.md](../vision.md) | 핵심 철학과 주 목표 | 제품 방향/경계 변경 시 |
| [../concepts.md](../concepts.md) | 공통 용어와 계약 경계 정의 | 새 개념 추가/의미 변경 시 |
| [spec.md](./spec.md) | 작동하는 기능 목록 | 기능 추가/제거 시 |
| [feature-test-matrix.md](./feature-test-matrix.md) | 기능별 테스트 파일·명령 매핑 | 기능/테스트 추가·이동·삭제 시 |
| [user-scenario-tests.md](./user-scenario-tests.md) | 사용자 관점 E2E 시나리오 테스트 목록 | 사용자 시나리오 테스트 추가·이동·삭제 시 |
| [api-index.md](./api-index.md) | 타입·함수 단일 소스 + 재구현 금지 | 함수/타입 추가 시 |
| [behavior-ecs.spec.md](./behavior-ecs.spec.md) | 행동 데이터 Entity/Component/System SSOT, representative use case, baseline/local verification | 행동 수집/로깅 모델 변경 시 |
| [oas32-coverage.md](./oas32-coverage.md) | OAS 3.2 기능별 지원 매트릭스 | 새 기능 구현 시 |
| [domain-merge-inventory.md](./domain-merge-inventory.md) | legacy domain merge input checklist | legacy source reference 확인 시 |
| [definition-builder-compatibility-gates.md](./definition-builder-compatibility-gates.md) | builder validation/downstream gates and accepted differences | builder workflow 변경 시 |
| [traceability.md](./traceability.md) | 공식 스펙 § → 타입 → 코드 매핑 | 파일 추가/이동 시 |
| [plan.md](./plan.md) | 로드맵 + 아키텍처 | Phase 완료/추가 시 |
| [architecture/packages.md](./architecture/packages.md) | 패키지 구조 + 파일 역할 | 패키지/파일 변경 시 |
| [goals/](./goals/) | 목표별 상세 스펙 | 목표 상태 변경 시 |

## 유저 가이드에서 참조하는 방법

```markdown
<!-- 유저 가이드에서 -->
→ [API 상세](../../internal/api-index.md)
→ [에러 코드 목록](../../internal/spec.md)
→ [OAS 커버리지](../../internal/oas32-coverage.md)
```

SSOT에 상세가 있으므로 유저 가이드에서 동일 정보를 반복하지 않습니다.

## 계획과 완료 구분

- `*.plan.md`, `*.todo.md`는 구현 전 또는 진행 중 계획이다.
- `spec.md`는 구현되어 검증된 기능만 담는다.
- 계획 문서의 예상 타입, CLI, report shape은 구현 완료 전까지 완료 기능처럼 인용하지 않는다.
- 구현 완료 시 테스트, `api-index.md`, `feature-test-matrix.md`를 갱신한 뒤 `spec.md`로 승격한다.
