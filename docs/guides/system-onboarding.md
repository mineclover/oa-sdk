# oa-sdk 시스템 온보딩

이 문서는 신규 작업자가 저장소의 목적, 정본, 변경 경로와 검증 게이트를 빠르게 파악하기
위한 안내서다. 세부 규칙은 [문서·스펙 거버넌스](../spec-governance/README.md)가 소유하며,
이 문서는 그 규칙을 반복하지 않는다.

## 1. 시작 전 확인

```bash
corepack enable
pnpm install
pnpm check:spec-governance
```

작업 시작 시 루트의 [`.ai/spec-loader.yaml`](../../.ai/spec-loader.yaml)을 읽는다. 이어서
[거버넌스 진입점](../spec-governance/README.md)과 [프로젝트 프로필](../spec-governance/project-profile.md)을
읽어 작업 범위·위험도·조건부 자료를 선택한다.

## 2. 무엇을 어디서 바꾸는가

| 바꾸려는 것 | 먼저 읽을 정본 | 일반 변경 위치 |
|---|---|---|
| 제품 범위/패키지 경계 | [`platform-scope.md`](../internal/platform-scope.md) | scope 문서와 결정 기록 |
| 구현된 기능 | [`spec.md`](../internal/spec.md) | package source/test, 완료 후 SSOT |
| API 타입·함수 export | [`api-index.md`](../internal/api-index.md) | owning package source |
| TypeSpec API 계약 | [authoring conventions](./typespec-authoring-conventions.md) | `packages/schemas/typespec/**/*.tsp` |
| 사용자 명령/운영 흐름 | 이 문서와 [CLI setup](./cli-setup.md) | 가이드 또는 운영 runbook |
| 아직 결정되지 않은 일 | [`plan.md`](../internal/plan.md) | `*.plan.md`, `goals/`, ADR |

TypeSpec 계약은 `.tsp`를 수정한다. `approved.openapi.yaml`, `.merged*.yaml`, `dist/`는
생성·검토 artifact이므로 직접 수정하지 않는다.

## 3. TypeSpec 계약 변경의 기본 경로

```bash
pnpm schema:approve-typespec-reference
# candidate diff를 검토한 뒤
pnpm schema:approve-typespec-reference -- --write
pnpm schema:typespec-check
pnpm schema:validate
```

parser, codegen, router, client, mock 동작에 영향이 있으면 추가로 다음을 실행한다.

```bash
pnpm schema:downstream-check
```

`--manifest`를 사용할 때 snapshot은 선택한 manifest가 선언한 파일에만 귀속된다. 후보
파일은 `.oa-sdk/typespec-candidates/`에 남는 작업 중 artifact이고, committed snapshot은
검토 기준이다. accepted drift를 함께 폐기하는 경우에는 도구가 요구하는 명시적 옵션과
변경 기록을 사용한다.

## 4. 문서와 코드 변경을 함께 완료하기

변경 유형에 따라 다음을 갱신한다.

- 기능 추가/삭제: `docs/internal/spec.md`, 관련 API index와 feature-test matrix
- 계약 변경: owning `.tsp`, approved snapshot, 버전 변경 여부와 diff 요약
- 계획 완료: 계획 문서의 상태를 갱신하고 검증된 내용을 `spec.md`로 승격
- 공식 기준 변경: `docs/spec-governance/decision-log.md`에 내용·이유·영향·저장 위치 기록
- 사용자 흐름 변경: 관련 가이드의 명령과 링크 확인

## 5. 최소 완료 확인

```bash
pnpm check:spec-governance
pnpm check:docs
git diff --check
```

계약 변경이면 [문서 유형과 품질 기준](../spec-governance/document-policy.md)의 계약
게이트를, release/version 변경이면 release policy 게이트를 추가한다. 검증을 생략할 때는
이유와 대체 증거를 변경 기록에 남긴다.

## 다음 읽을 자료

- [Quick Start](./quick-start.md) — 전체 파이프라인을 직접 실행
- [기본 스펙 사용 기준](./basic-spec-usage.md) — source와 artifact 소유권
- [TypeSpec Authoring Conventions](./typespec-authoring-conventions.md) — 계약 세부 규칙
- [Production operations](../internal/typespec-roundtrip/production-operations.md) — snapshot/drift 복구
- [Change control](../spec-governance/change-control.md) — 예외와 충돌 처리
