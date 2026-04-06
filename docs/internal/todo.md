# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.

---

## 우선 (런타임 연결 확장)

### [x] codegen: operation 묶음 타입 생성
`typegen/generate-types.ts`에서 Operation 묶음 타입 생성 완료.
`type XxxOp = { method, path, params, query, body, response, headers }`.

### [x] mock-server: Server variables 적용
`resolveServerUrl()` client에서 연결 완료. 서버 변수 해소로 동적 baseUrl 지원.

### [ ] router/client: ResponseHeaders 활용
typegen `XxxResponseHeaders` 생성됨. router에서 `c.header()` 자동 삽입,
client에서 `res.headers` 타입 안전 접근.

---

## 단기 (미구현 스펙)

### [ ] Encoding — multipart 필드별 인코딩
타입 완료. request-validator multipart 파싱 + contentType/style.

### [ ] Links — 응답 관계 정보
타입+파싱 완료. mock 응답에 Link 포함. typegen Link 타입.

### [ ] Callbacks — 아웃바운드 웹훅
타입+파싱 완료. mock에서 callback URL POST 시뮬레이션.

### [ ] Webhooks — 인바운드 핸들러
타입+파싱 완료. router에서 webhook 스텁.

### [ ] XML 직렬화
타입 완료. application/xml content-type. 최하 우선순위.

---

## 완료 항목

<details>
<summary>접기 (65+개)</summary>

- [x] Phase 1~6 전체 구현 (schemas/parser/mock-server/codegen/router/client)
- [x] Tags 계층 describeApi + resolveServerUrl + ResponseHeaders typegen + Discriminator AJV
- [x] Security 검증 (bearer/apiKey/oauth2/oidc/mTLS/AND/OR)
- [x] 자체 린터 + validateDocument + 3.2↔3.1 변환 (사이드카)
- [x] createTestClient + createCoverageTracker + Query API
- [x] @oa-sdk/core + 중복 함수 통합 + 타입 캐스트 정리
- [x] dataValue: null 버그 수정 + 문서 drift 수정
- [x] 819 테스트 + 16 커밋 + 문서 SSOT/가이드 분리 + traceability
- [x] Operation 묶음 타입 (codegen typegen)
- [x] Server variables 해소 (client resolveServerUrl 연결)
- [x] RouteFilter (mock-server filterRouteIndex)
- [x] Content-type aware router 스텁 + security requirement hints
- [x] NDJSON vs SSE 스트림 분리 (client)
- [x] 899 테스트 (parser 120, codegen 197, mock-server 508, playground 38, router 18, client 18)

</details>
