# 아키텍처

## 패키지 구조

→ [packages.md](./packages.md)

## 설계 결정 기록 (ADR)

| ADR | 결정 |
|---|---|
| [001-no-prism.md](./001-no-prism.md) | Prism 미사용 — 자체 AJV 엔진 |
| [002-msw-node-http.md](./002-msw-node-http.md) | MSW + Node HTTP 듀얼 어댑터 |
| [003-domain-split.md](./003-domain-split.md) | 도메인 단위 spec 분리 + merge.ts |
| [004-oas32-first.md](./004-oas32-first.md) | OAS 3.2 단독 — 3.1 하위 호환 없음 |
| [005-spectral-redocly-split.md](./005-spectral-redocly-split.md) | Spectral(스타일) / Redocly(구조) 역할 분리 |
