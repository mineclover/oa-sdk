# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), 중장기 방향은 [plan.md](./plan.md)를 참조하세요.

---

## 현재 없음

모든 태스크 완료. 안정화 상태.

---

## 완료 항목

<details>
<summary>접기 (50+개)</summary>

**테스트 갭 보강 (최근)**
- [x] parser 직접 테스트: deref(7), fold(15), pipeline(5) — 27개
- [x] Server Object 전용 테스트 (8개) — server 상속, variables
- [x] Tags 전용 테스트 (10개) — parent/kind, groupByTag, describeApi
- [x] MediaType 전용 테스트 (9개) — itemSchema SSE, JSON body, text/plain, dataValue 우선순위
- [x] Security 검증 전용 테스트 — bearer/apiKey(header/query/cookie)/oauth2, OR 의미론, 빈 security

**이전 완료 (45+개)**
- [x] Phase 1~6 전체 구현
- [x] @oa-sdk/core 패키지 + 중복 함수 통합
- [x] openapi3-ts 완전 제거
- [x] 자체 OAS 3.2 린터 (7카테고리)
- [x] 3.2→3.1 다운그레이드 스크립트
- [x] createTestClient + createCoverageTracker
- [x] Query API (findOperation, findByTag, describeApi)
- [x] typegen 포매터 (formatGeneratedTs)
- [x] SSE 클라이언트 (async generator)
- [x] 추적 매핑 (traceability.md)
- [x] 데모 스크립트 (pnpm demo)

</details>
