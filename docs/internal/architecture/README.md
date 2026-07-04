# 아키텍처

## 패키지 구조

→ [packages.md](./packages.md)

## 설계 결정 기록 (ADR)

| ADR | 결정 |
|---|---|
| [001-no-prism.md](./001-no-prism.md) | Prism 미사용 — 자체 AJV 엔진 |
| [002-msw-node-http.md](./002-msw-node-http.md) | MSW + Node HTTP 듀얼 어댑터 |
| [003-domain-split.md](./003-domain-split.md) | 레거시 도메인 단위 spec 분리 |
| [004-oas32-first.md](./004-oas32-first.md) | OAS 3.2 단독 — 3.1 하위 호환 없음 |
| [005-spectral-redocly-split.md](./005-spectral-redocly-split.md) | Spectral(스타일) / Redocly(구조) 역할 분리 |
| [006-incremental-workspace-index.md](./006-incremental-workspace-index.md) | SQLite 기반 증분 Workspace Index |
| [007-shared-schema-engine-vocabulary.md](./007-shared-schema-engine-vocabulary.md) | OpenAPI Projection Contract 경계 |
| [008-browser-runtime-entrypoints.md](./008-browser-runtime-entrypoints.md) | 브라우저 런타임 엔트리포인트와 후속 재구조화 제안 |
| [009-typespec-first-authoring.md](./009-typespec-first-authoring.md) | TypeSpec-first authoring 수용 — production source switch + rollback 유지 |
| [010-dpm-relationship-first.md](./010-dpm-relationship-first.md) | Relationship-first DPM 구현 기준선 |
