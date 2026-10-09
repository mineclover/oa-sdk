# 아키텍처

## 패키지 구조

→ [packages.md](./packages.md)

## 설계 결정 기록 (ADR)

### 1. 활성 정본 ADR (Active Canonical ADRs)

| ADR | 결정 | 핵심 정본 역할 |
|---|---|---|
| [001-no-prism.md](./001-no-prism.md) | Prism 미사용 — 자체 AJV/독립형 가드 엔진 | 런타임 제로-eval 독립 가드 및 빠른 검증 |
| [002-msw-node-http.md](./002-msw-node-http.md) | MSW + Node HTTP 듀얼 어댑터 | 프론트엔드/백엔드 격리 Mock 아키텍처 |
| [005-spectral-redocly-split.md](./005-spectral-redocly-split.md) | Spectral(스타일) / Redocly(구조) 역할 분리 | OpenAPI 계약 린팅 2원화 |
| [006-incremental-workspace-index.md](./006-incremental-workspace-index.md) | SQLite 기반 증분 Workspace Index | Spec-Lens 및 변경 감지 인프라 |
| [007-shared-schema-engine-vocabulary.md](./007-shared-schema-engine-vocabulary.md) | OpenAPI Projection Contract 경계 | 프로젝션 교환 형식 및 도구 중립 계약 |
| [008-browser-runtime-entrypoints.md](./008-browser-runtime-entrypoints.md) | 브라우저 런타임 엔트리포인트 경계 | 클라이언트 번들 격리 및 CSP 준수 |
| [009-typespec-first-authoring.md](./009-typespec-first-authoring.md) | TypeSpec-first authoring 수용 | API 계약 정본(SSOT)을 TypeSpec으로 확정 |
| [010-dpm-relationship-first.md](./010-dpm-relationship-first.md) | Relationship-first DPM 구현 기준선 | 관계성 중심 데이터 가명화 및 거버넌스 |
| [011-apitomy-compatibility-boundary.md](./011-apitomy-compatibility-boundary.md) | Apitomy Data Models 비권위적 reference 경계 | 외부 데이터 모델 수집 및 참조 경계 |
| [012-multi-tier-schema-separation-and-ttsc-boundary.md](./012-multi-tier-schema-separation-and-ttsc-boundary.md) | 멀티 티어 스키마 분리 및 ttsc·Atlas 역할 경계 | 4계층(Storage, Logical, API, Behavior) 엄격 분리 및 DDL 비소유 원칙 |

### 2. 대체 및 격리된 레거시 ADR (Superseded & Isolated Legacy ADRs)

> [!NOTE]
> 아래 ADR은 초기 설계 단계의 의사결정이었으나 상위 ADR에 의해 완전 대체되었거나 롤백/히스토리 보존 목적으로만 격리 유지됩니다. 신규 아키텍처는 위 활성 정본 ADR을 따릅니다.

| ADR | 과거 결정 | 현재 상태 및 대체 근거 |
|---|---|---|
| [003-domain-split.md](./003-domain-split.md) | 레거시 도메인 단위 spec 분리 (`merge.ts`) | **대체됨**: ADR-009(TypeSpec-first) 및 ADR-012에 의해 완전 대체. `merge.ts`는 제거되었으며 YAML fragments는 롤백/참조 전용으로 격리됨 |
| [004-oas32-first.md](./004-oas32-first.md) | OAS 3.2 단독 — 3.1 하위 호환 없음 | **보완 대체됨**: OAS 3.2 정본 유지를 원칙으로 하되, 에코시스템 호환을 위한 3.1 다운그레이드 사이드카(`.merged.3.1.yaml`) 및 메타데이터 복원 계약으로 고도화됨 |

