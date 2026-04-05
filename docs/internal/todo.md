# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.

---

## 우선 (런타임 연결 확장)

### [ ] codegen: operation 묶음 타입 생성
현재 PathParams/QueryParams/Body/Response/ResponseHeaders 개별 생성.
묶음 타입 (`type ListUsersOp = { params, query, body, response, headers }`) →
router/client 제네릭 활용 기반.

### [ ] mock-server: Server variables 적용
`resolveServerUrl()` 존재하나 어댑터 미연결.
`createNodeMockServer(spec, { serverIndex: 0 })` → 동적 baseUrl.

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

</details>
