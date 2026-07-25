# 문서 거버넌스 변경 이력

이 문서는 `docs/spec-governance/`의 공식 기준을 바꾼 기록이다. 구현 기능의 일반
changelog가 아니며, 항목을 삭제하거나 기존 결정을 조용히 덮어쓰지 않는다.

| 날짜 | 변경 내용 | 이유 | 영향 범위 | 정본·자료 저장 위치 |
|---|---|---|---|---|
| 2026-07-25 | TypeSpec 후속 경계 설계를 proposed 상태로 추가 | watch-path 재현성, semantic environment profile, typed helper 확장, 외부 agent skill 정합성의 다음 결정을 구현과 분리해 검토 가능하게 함 | 후속 설계·운영 판단; 현재 production contract와 runtime 동작은 변경하지 않음 | `docs/internal/typespec-roundtrip/feedback-followup-design.md` |
| 2026-07-24 | 기본 스펙·CLI·온보딩 가이드의 TypeSpec source, approved snapshot, 검증 게이트 설명을 현재 구현으로 정렬하고 완료 항목과 미결정 항목을 분리 | 과거형 계획 문구와 실제 운영 절차의 해석 편차 감소 | 사용자 가이드와 문서 인덱스; 구현·계약 artifact 자체는 변경하지 않음 | `docs/guides/basic-spec-usage.md`, `docs/guides/cli-setup.md`, `docs/guides/system-onboarding.md`, `docs/README.md` |
| 2026-07-24 | 문서 거버넌스 진입점, 문서 유형·품질 기준·변경 절차를 도입 | TypeSpec/OpenAPI, 내부 SSOT, 사용자 가이드에 흩어진 암묵적 기준으로 인한 해석 편차와 재작업 감소 | 저장소 문서·계약·계획 변경 전반; 기존 `docs/internal/` SSOT는 유지 | `.ai/spec-loader.yaml`, `docs/spec-governance/`, `docs/README.md`, `README.md` |

새 항목은 최신 항목을 위에 추가하되, 이전 항목의 의미를 변경하지 않는다.
