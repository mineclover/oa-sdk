# 문서·스펙 거버넌스

상태: active
최초 명문화: 2026-07-24

이 디렉터리는 oa-sdk의 암묵적인 문서·스펙 판단 기준을 명문화한다. 구현 현황이나
API 세부사항을 복제하는 곳이 아니다. 기존 `docs/internal/` SSOT와 사용자 가이드를
어떻게 읽고, 언제 갱신하고, 어떤 증거로 완료를 판단하는지를 이곳에서 정한다.

## 적용 범위

- 이 저장소의 Markdown, YAML/JSON 스펙, TypeSpec, 생성 OpenAPI snapshot, CLI manifest,
  계획·결정 기록에 적용한다.
- `references/`의 외부 저장소와 `apps/`의 독립적인 제품 문서는 해당 문서의 원래
  규칙을 우선하되, oa-sdk와 계약을 교환하는 지점은 이 거버넌스를 따른다.
- 새 규칙을 만들기 전에 기존 SSOT나 가이드를 보완할 수 있는지 먼저 확인한다.

## 기준의 우선순위

의미가 충돌하면 다음 순서로 판단한다.

1. 적용되는 외부 표준·보안·법적 제약
2. 이 디렉터리의 문서 거버넌스와 예외 기록
3. 해당 영역의 정본 SSOT (`platform-scope`, `spec`, `api-index`, 계약 TypeSpec 등)
4. 실행 코드와 테스트 — 현재 동작을 입증하는 증거
5. 사용자 가이드·예제·생성 artifact — 정본을 설명하거나 파생된 자료

충돌을 발견했다고 해서 하위 자료를 임의로 정본으로 승격하지 않는다. 충돌 내용을
`change-control.md` 절차로 기록하고, 정본·코드·테스트·파생 문서를 함께 정렬한다.

TypeSpec 계약에서는 `packages/schemas/typespec/**/*.tsp`가 사람이 작성하는 계약 정본이다.
`approved.openapi.yaml`은 검토 가능한 생성 snapshot이며 직접 작성하지 않는다.

## 현재 유효한 정본

| 판단 영역 | 현재 정본 | 역할 |
|---|---|---|
| 제품 범위 | [`docs/internal/platform-scope.md`](../internal/platform-scope.md) | Core/Downstream/Maintenance/Apps 경계 |
| 구현 현황 | [`docs/internal/spec.md`](../internal/spec.md) | 검증된 기능만 기록 |
| 로드맵 | [`docs/internal/plan.md`](../internal/plan.md) | 앞으로 할 일; 완료 기능의 증거가 아님 |
| API 표면 | [`docs/internal/api-index.md`](../internal/api-index.md) | 타입·함수·export 상세 |
| 기능과 테스트 | [`docs/internal/feature-test-matrix.md`](../internal/feature-test-matrix.md) | 기능별 검증 경로 |
| 릴리스 분류·버전 정책 | [`docs/internal/release-policy.json`](../internal/release-policy.json) | workspace track, publish, Changesets 기준 |
| 계약 작성 | [`packages/schemas/typespec/`](../../packages/schemas/typespec/) | TypeSpec source와 bundle manifest |
| 계약 검토 baseline | [`approved.openapi.yaml`](../../packages/schemas/typespec/approved.openapi.yaml) | TypeSpec에서 생성된 승인 snapshot |
| 계약 규칙 | [`typespec-authoring-conventions.md`](../guides/typespec-authoring-conventions.md) | 변경·버전·drift 규칙 |
| 에이전트 스킬 거버넌스 | [`agent-skill-governance-proposal.md`](./agent-skill-governance-proposal.md) | 글로벌 기본 닫힘 및 프로젝트별 스킬 활성화 규격 |
| 협업 하네스 계약 평가 | [`shared-context-harness-contract-evaluation.md`](./shared-context-harness-contract-evaluation.md) | 공유 컨텍스트 협업 하네스 도구 계약 및 fail-closed 보안 경계 평가 |
| 런타임 행위 스키마 연구 | [`typespec-behavior-schema-authoring-research.md`](./typespec-behavior-schema-authoring-research.md) | TypeSpec 기반 Behavior / Runtime Schema 작성 및 XState 프로젝션 연구 (Partial adopt) |
| 문서 기준 이력 | [`decision-log.md`](./decision-log.md) | 공식 기준 변경 기록 |


정본의 상태가 바뀌면 이 표와 변경 이력을 같은 변경 단위에서 갱신한다.

## 작업 시작 순서

1. 저장소 루트의 [`.ai/spec-loader.yaml`](../../.ai/spec-loader.yaml)을 읽는다.
2. 이 문서와 [`project-profile.md`](./project-profile.md)를 읽어 범위·위험도·소유권을
   확인한다.
3. [`document-policy.md`](./document-policy.md)에서 문서 유형과 완료 기준을 선택한다.
4. 작업 영역에 해당하는 조건부 자료만 추가로 읽는다.
5. 변경 후 [`change-control.md`](./change-control.md)의 기록·검증 절차를 수행한다.

## 이 체계가 다루지 않는 것

패키지별 API 설명, 모든 기능의 상세 설계, 중복된 튜토리얼을 새로 만들지 않는다. 그런
내용은 기존 SSOT·가이드·ADR의 소유 위치에 두고, 필요한 경우 이 디렉터리에서 링크만
추가한다.
