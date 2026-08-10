# 문서 거버넌스 변경 이력

이 문서는 `docs/spec-governance/`의 공식 기준을 바꾼 기록이다. 구현 기능의 일반
changelog가 아니며, 항목을 삭제하거나 기존 결정을 조용히 덮어쓰지 않는다.

| 날짜 | 변경 내용 | 이유 | 영향 범위 | 정본·자료 저장 위치 |
|---|---|---|---|---|
| 2026-08-10 | sidecar-less OA SDK TypeSpec extension vocabulary를 v5로 단일화하고, 완료된 roundtrip 평가·이관·버전별 roadmap 문서를 제거 | 현재 production TypeSpec source와 호환되지 않는 과거 vocabulary/계획이 새 authoring과 release 판단에 섞이는 것을 방지 | bundle manifest validation, fixtures, authoring guide, internal documentation; compatibility sidecar와 rollback procedure는 현행 운영 경계로 유지 | `packages/codegen/src/cli/lib/typespec-extension-schema-version.ts`, `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v5.md`, `docs/internal/typespec-roundtrip/authoring-ownership-guide.md`, `docs/internal/typespec-roundtrip/production-operations.md` |
| 2026-08-10 | Core Platform과 release policy의 현행 구성을 8/3/11/10으로 정렬하고 policy version을 v4로 승격; release 문서의 machine-checked snapshot과 OAS reference link gate를 추가하고 schema package export bundle freshness를 CI로 보강 | public distribution 준비와 logical-ERD prototype 추가 뒤에 남은 7·4·10 표기, 검증 제외였던 OAS 분할본의 링크 오류, canonical contract보다 오래된 package bundle이 release·문서 판단을 흔드는 문제를 제거 | README, scope/goal/release SSOT, release-policy·docs·CI gate; package API·배포 상태는 변경하지 않음 | `docs/internal/release-policy.json`, `docs/internal/release-management.md`, `scripts/check-release-policy.ts`, `scripts/check-docs.ts`, `.github/workflows/ci.yml`, `packages/schemas/package.json`, `docs/internal/platform-scope.md` |
| 2026-07-25 | TypeSpec 후속 경계 설계를 proposed 상태로 추가 | watch-path 재현성, semantic environment profile, typed helper 확장, 외부 agent skill 정합성의 다음 결정을 구현과 분리해 검토 가능하게 함 | 후속 설계·운영 판단; 현재 production contract와 runtime 동작은 변경하지 않음 | `docs/internal/typespec-roundtrip/feedback-followup-design.md` |
| 2026-07-24 | 기본 스펙·CLI·온보딩 가이드의 TypeSpec source, approved snapshot, 검증 게이트 설명을 현재 구현으로 정렬하고 완료 항목과 미결정 항목을 분리 | 과거형 계획 문구와 실제 운영 절차의 해석 편차 감소 | 사용자 가이드와 문서 인덱스; 구현·계약 artifact 자체는 변경하지 않음 | `docs/guides/basic-spec-usage.md`, `docs/guides/cli-setup.md`, `docs/guides/system-onboarding.md`, `docs/README.md` |
| 2026-07-24 | 문서 거버넌스 진입점, 문서 유형·품질 기준·변경 절차를 도입 | TypeSpec/OpenAPI, 내부 SSOT, 사용자 가이드에 흩어진 암묵적 기준으로 인한 해석 편차와 재작업 감소 | 저장소 문서·계약·계획 변경 전반; 기존 `docs/internal/` SSOT는 유지 | `.ai/spec-loader.yaml`, `docs/spec-governance/`, `docs/README.md`, `README.md` |

새 항목은 최신 항목을 위에 추가하되, 이전 항목의 의미를 변경하지 않는다.
