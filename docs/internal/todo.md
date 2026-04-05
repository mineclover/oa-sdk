# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), 중장기 방향은 [plan.md](./plan.md)를 참조하세요.

---

## 현재 없음

Phase 1~6 전부 완료. 819 테스트 통과. 프로덕트 운용 가능 상태.

---

## 완료 항목

<details>
<summary>접기 (60+개)</summary>

**안정화 (최근)**
- [x] dataValue: null 버그 수정 (response-picker ?? → in 체크)
- [x] api-index.md toMswPath 문서 drift 수정
- [x] validateDocument YAML 시그니처 정직하게 수정
- [x] parse.ts `as never` 캐스트 제거
- [x] lint.ts isRef() 타입 가드로 캐스트 제거
- [x] stream.ts OasMediaType 유니온 타입으로 캐스트 제거
- [x] OAuth2/OIDC/mTLS/AND 의미론 security 테스트 확장 (30개)
- [x] format.ts 테스트 7개
- [x] 다운그레이드 라운드트립 테스트 10개
- [x] SSE 클라이언트 테스트 5개
- [x] dataValue: null + schema default 조합 테스트
- [x] 주제별 커밋 13개
- [x] 3.2→3.1 사이드카 방식 전환 (x-oas32 → .meta.json)
- [x] 3.1→3.2 업그레이드 스크립트
- [x] 문서 internal/guides 분리 (SSOT 참조 패턴)
- [x] 유저 가이드 4개 (quick-start, mock-testing, codegen-workflow, test-feedback)

**테스트 갭 보강**
- [x] parser 직접 테스트: deref, fold, pipeline, server, tags, validate, lint, query
- [x] MediaType 전용 테스트 (itemSchema, content-type, dataValue 우선순위)
- [x] Security 검증 전용 테스트 (bearer/apiKey/oauth2/oidc/mTLS/AND/OR)
- [x] spec-mediatype.test.ts (SSE 스트리밍, JSON body, text/plain)

**Phase 1~6 구현**
- [x] Phase 1: 스키마 관리 (schemas)
- [x] Phase 2: 수집 코드젠 + Mock 서버 (codegen + mock-server)
- [x] Phase 3: OAS 파서 / IR (parser)
- [x] Phase 4: TypeScript 타입 생성 (codegen/typegen)
- [x] Phase 5: 라우터 스텁 (router)
- [x] Phase 6: 클라이언트 SDK (client)

**인프라/안정화**
- [x] @oa-sdk/core 패키지 + 중복 함수 통합
- [x] openapi3-ts 완전 제거
- [x] 자체 OAS 3.2 린터 + validateDocument
- [x] createTestClient + createCoverageTracker
- [x] Query API + describeApi
- [x] CLI 7개 커맨드
- [x] 데모 스크립트 (pnpm demo)
- [x] 추적 매핑 (traceability.md)

</details>
