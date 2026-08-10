# 프로젝트 프로필

이 문서는 문서 거버넌스의 적용 강도를 결정하는 프로젝트 사실을 기록한다. 수치가
바뀌면 코드나 문서 개편 때 함께 갱신한다.

## 목적과 경계

oa-sdk의 핵심 임무는 schema와 OpenAPI 계약의 source of truth를 정의하고, 외부 schema
projection을 수용하며, 파싱·검증·생성·mock·변경 이력 관측을 하나의 계약 관리 계층으로
연결하는 것이다. 제품 범위와 비범위는 [`platform-scope.md`](../internal/platform-scope.md)가
소유한다.

## 규모

현재 저장소는 다음 특성을 가진 monorepo다.

| 항목 | 관찰값 | 의미 |
|---|---:|---|
| package workspace | package 17개 + pnpm app 4개, 총 21개 manifest | Core·Downstream·Maintenance·앱 경계가 필요 |
| app workspace | 5개(이 중 FastAPI reference 1개는 pnpm 밖) | 제품 코드와 검증/reference surface를 구분해야 함 |
| Markdown 문서 | 현재 docs gate 216개 | 링크·중복·상태 표기가 품질 위험 |
| root script | 75개 | 변경 유형별 검증 선택이 필요 |
| 계약 artifact | TypeSpec source + approved OpenAPI snapshot + downstream 생성물 | source와 파생물의 소유권을 분리해야 함 |

## 위험도

| 영역 | 위험도 | 이유 | 최소 보호 장치 |
|---|---|---|---|
| TypeSpec/OpenAPI 계약 | 높음 | consumer 생성물·라우터·client·mock에 연쇄 영향 | candidate diff, `schema:typespec-check`, `schema:validate` |
| parser/codegen/downstream | 높음 | 하나의 계약 변경이 여러 package 표면을 변경 | 관련 package test/typecheck와 `schema:downstream-check` |
| release/versioning | 높음 | package version, API contract version, snapshot schema version이 다름 | release policy와 변경 이력 검토 |
| 내부 구현 문서 | 중간 | stale 문서가 재작업·잘못된 판단을 유발 | `spec.md`, API index, feature matrix 동시 갱신 |
| 사용자 가이드 | 중간 | 사용 경로와 실제 명령 불일치 가능 | `pnpm check:docs`와 명령 예제 검토 |

## 협업 방식

- 여러 package와 문서가 하나의 workspace에서 함께 변경될 수 있으므로, 변경자는 먼저
  소유 파일과 영향 범위를 선언하고 다른 변경을 되돌리지 않는다.
- 계획 문서(`*.plan.md`, `*.todo.md`)는 의도와 미완료 작업을 담고, 구현 완료 주장은
  `spec.md`·API index·feature matrix와 검증 결과로 승격한다.
- 생성 artifact는 수동 수정하지 않고 원천을 수정한 뒤 생성 명령과 diff를 남긴다.
- 문서만 바꾼 경우에도 링크·명령 예제가 깨지지 않았는지 검증한다.

## 신규 작업자의 기본 읽기 경로

1. [README](../../README.md)
2. [Quick Start](../guides/quick-start.md)
3. [문서 거버넌스](./README.md)
4. [기본 스펙 사용 기준](../guides/basic-spec-usage.md)
5. 작업 영역의 SSOT와 조건부 자료
