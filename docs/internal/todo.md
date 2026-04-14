# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.

---

## 우선 (런타임 연결 확장)

### [x] parser: Schema Object 메타 검증 추가
`validateDocument()`에서 OpenAPI 문서 내 Schema Object를 수집하고 JSON Schema 2020-12 메타스키마로 검증.
잘못된 `type`, `minimum`, `items` 등 스키마 키워드 자체의 정합성을 `schema/meta-valid` 에러로 보고.

### [x] mock-server: AJV schema compile 실패를 검증 에러로 노출
요청 body/parameter 검증 시 미해결 `$ref` 또는 잘못된 Schema Object가 있으면 검증을 건너뛰지 않고
`SCHEMA_COMPILE_ERROR`로 반환.

### [x] parser: 손실 없는 $ref 정규화
JSON Schema 2020-12 기준으로 `$ref` sibling keyword 보존, 외부 YAML/JSON ref 해소, cycle diagnostic,
source pointer 추적을 포함하는 resolver로 확장. `resolveRefGraph()`와 `cycleStrategy`까지 구현 완료.

### [x] schemas: schema:validate와 oa-gen validate 검증 범위 통합
로컬 `pnpm schema:validate`와 CI `oa-gen validate`가 같은 canonical pipeline을 타도록 정리.

### [x] schemas: component overwrite 기본 차단
도메인 병합 시 중복 component key는 기본 오류. `ALLOW_COMPONENT_OVERRIDES=1` 또는 `ALLOW_COMPONENT_OVERRIDE_KEYS`로 명시 허용.

### [x] codegen: operation 묶음 타입 생성
`typegen/generate-types.ts`에서 Operation 묶음 타입 생성 완료.
`type XxxOp = { method, path, params, query, body, response, headers }`.

### [x] mock-server: Server variables 적용
`resolveServerUrl()` client에서 연결 완료. 서버 변수 해소로 동적 baseUrl 지원.

### [ ] codegen: TypegenOptions/SchemaToTsOptions 공개 API 정리
`TypegenOptions`는 `codegen/typegen` 서브 엔트리에만 export. `SchemaToTsOptions`는 미노출.
메인 index에서도 export할지, 서브 엔트리로 충분한지 결정 후 api-index 반영.

### [ ] router/client: ResponseHeaders 활용
typegen `XxxResponseHeaders` 생성됨. router에서 `c.header()` 자동 삽입,
client에서 `res.headers` 타입 안전 접근.

### [ ] parser/codegen: ref resolver 단일화 심화
`resolveRefGraph()`가 SSOT 역할을 시작했지만 `derefSpec()`는 아직 별도 traversal/cache를 가짐.
다음 세션에서 공통 `RefResolver`로 외부 문서 로딩/포인터 해소/cache/source를 더 줄일 것.

### [ ] codegen: 외부 `$defs` / 비 components schema alias 정책
외부 `$ref` type alias는 `#/components/schemas/*` 중심. `$defs` 또는 다른 schema root를 지원할지 정책화 필요.

### [ ] diagnostics: YAML line/column source map
현재 source는 `filePath#pointer` 수준. 작성자 UX 개선을 위해 YAML AST 기반 line/column 매핑 검토.

---

## 단기 (미구현 스펙)

### [ ] Encoding — multipart 필드별 인코딩
타입 완료. request-validator multipart 파싱 + contentType/style.

### [ ] Links — 응답 관계 정보
타입+파싱 완료. mock 응답에 Link 포함. typegen Link 타입.

### [ ] Callbacks — 아웃바운드 웹훅
타입+파싱 완료. mock에서 callback URL POST 시뮬레이션.

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
- [x] Webhooks — router/client/mock-server 웹훅 핸들러 스텁/타입/라우트 병합
- [x] additionalProperties → Record<string, T> + index signature (typegen)
- [x] Hono 타입드 라우터 — 응답/바디 타입 캐스팅 (as any 제거)
- [x] MSW override — createMswMockServer() + override/clearOverride/clearOverrides
- [x] Client middleware — onRequest/onResponse/onError 인터셉터
- [x] ZodLazy → $ref 재귀 스키마
- [x] Error body 타입 (4xx/5xx → ${baseName}Error + Op 번들 포함)
- [x] CLI dev watch 모드
- [x] External $ref 기본 지원 (상대 파일 경로)
- [x] matchRoute regex 캐시 (WeakMap)
- [x] if/then/else 스키마 (anyOf 시맨틱)
- [x] 브라우저 번들 (@oa-sdk/mock-server/browser)
- [x] 프리뷰 웹앱 (apps/preview) — Service Worker 기반 mock 서버 + 코드 생성 미리보기
- [x] 어댑터 중복 제거 (generateStreamChunks, mergeWebhookRoutes, parseQueryParams 공유화)
- [x] 테스트 픽스처 공유 (specs.ts)
- [x] schemas 스크립트 테스트 (merge/downgrade/upgrade)
- [x] 1141 테스트 (parser 128, codegen 218, mock-server 553, playground 114, router 28, client 27, schemas 73)
- [x] CI 자동화 (GitHub Actions: build/typecheck/test/validate/freshness/spec-diff/api-index)
- [x] CLI 커맨드 모듈 분리 (commands/*.ts + lib/ 공유 유틸)
- [x] typegen 개선 (제약→JSDoc, readOnly→readonly, deprecated→@deprecated, annotations 옵션, const 중첩 수정, schema/Op 중복 방지)
- [x] mock-server allOf merge 수정 (branches[0] → 전체 merge)
- [x] schema annotations 컨벤션 ($comment + annotations 객체)
- [x] 1487 테스트 (core 51, parser 171, codegen 454, mock-server 553, playground 114, router 35, client 36, schemas 73)
- [x] ref graph resolver + 외부 `$ref` source diagnostic + cycleStrategy
- [x] component overwrite 기본 오류 + external schema name collision warning
- [x] 1577 테스트 (core 51, parser 190, codegen 464, mock-server 561, playground 114, router 35, client 36, schemas 73, typia-mock 53)

</details>
