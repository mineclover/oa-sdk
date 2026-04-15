# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.
> 정렬 기준: ref correctness → 증분 workspace index → 코드 생성 정책 → 진단 UX → 공개 API → 런타임 활용 → 남은 OAS 스펙 순.
> 증분 설계: [ADR-006 — SQLite 기반 증분 Workspace Index](./architecture/006-incremental-workspace-index.md)

---

## 다음 세션 실행 순서

### 1. [ ] diagnostics: YAML line/column source map
배경: 현재 diagnostic source는 `filePath#pointer` 수준이라 큰 YAML에서 작성자 UX가 제한됨.
작업: YAML AST 기반 line/column 매핑 가능성을 확인하고, parser/ref graph/schema validation diagnostic에 단계적으로 연결.
완료 기준: 대표 YAML 입력에서 diagnostic이 file, pointer, line, column을 함께 노출하고 JSON 입력 동작은 유지됨.

### 2. [ ] codegen: TypegenOptions/SchemaToTsOptions 공개 API 정리
배경: `TypegenOptions`는 `codegen/typegen` 서브 엔트리에만 export되고, `SchemaToTsOptions`는 미노출 상태.
작업: 메인 index에서 재export할지, 서브 엔트리 전용 API로 유지할지 결정하고 API index를 갱신.
완료 기준: 공개 surface가 문서와 export 테스트에 반영되고, 내부 옵션 타입이 의도치 않게 노출되지 않음.

### 3. [ ] router/client: ResponseHeaders 활용
배경: typegen은 `XxxResponseHeaders`를 생성하지만 router/client 런타임 API는 아직 타입을 적극 활용하지 않음.
작업: router에서 응답 header 삽입 helper 또는 stub 힌트를 강화하고, client에서 `res.headers` 타입 안전 접근 경로를 제공.
완료 기준: 생성된 Op 타입의 `headers`가 router/client 사용 예제와 테스트에서 실제로 소비됨.

---

## 단기 미구현 스펙

### 7. [ ] Encoding — multipart 필드별 인코딩
배경: 타입은 준비됐지만 request-validator multipart 파싱과 필드별 `contentType`/`style` 처리는 남아 있음.
작업: multipart part 단위 decoding과 OpenAPI Encoding Object 규칙을 request validation에 연결.
완료 기준: 필드별 content type, style/explode, 잘못된 part encoding 실패 케이스가 테스트됨.

### 8. [ ] Links — 응답 관계 정보
배경: Links는 타입과 파싱은 완료됐지만 mock 응답과 typegen 소비는 아직 얕음.
작업: Operation Object의 Link 정보를 mock 응답 메타데이터와 typegen Link 타입으로 연결.
완료 기준: 응답에서 다음 operation 관계를 추적할 수 있고, Link 타입 생성 테스트가 있음.

### 9. [ ] Callbacks — 아웃바운드 웹훅
배경: Callbacks는 타입과 파싱은 완료됐지만 mock-server에서 outbound 호출 시뮬레이션이 없음.
작업: callback URL expression 평가와 mock outbound POST 흐름을 설계하고 테스트 헬퍼로 노출.
완료 기준: 요청 처리 후 callback route로 payload를 보내는 성공/실패 시나리오가 테스트됨.

### 10. [ ] XML 직렬화
배경: XML 타입은 준비됐지만 `application/xml` body parsing/serialization은 미지원.
작업: XML Object 규칙, request body parsing, response serialization 범위를 최소 지원부터 정함.
완료 기준: 기본 object/array XML 직렬화와 content-type negotiation 테스트가 있음.

---

## 최근 완료

### [x] codegen: 외부 `$defs` / 비 components schema alias 정책
외부 YAML/JSON schema-position `$ref` alias 정책을 components-only에서 schema object target으로 확장.
`#/components/schemas/*`, `#/$defs/*`, `#/schemas/*`, `#/models/*` 같은 비 components schema root는 generated alias로 정규화한다.
alias 이름은 JSON Pointer 마지막 segment를 사용하고, 기존 file-stem 기반 deterministic rename과 resolver diagnostic/source metadata 보존 규칙을 유지한다.
`$defs`와 비 components root의 nested internal ref도 absolute file+pointer identity로 rewrite해 source 외부 문서 기준 alias를 가리키도록 테스트로 고정.

### [x] codegen CLI: 증분 validate/typegen 연결
`oa-gen validate`와 `oa-gen typegen`에 opt-in `--incremental --cache-dir` 옵션을 추가.
두 커맨드와 `oa-gen dev` watch mode가 공통 CLI incremental helper를 통해 scan → dirty detect → refs.to_file reverse invalidation → output generation → index refresh 순서를 공유.
단발 validate/typegen 기본 실행은 SQLite를 사용하지 않는 full rebuild 출력 경로로 유지하며, 증분 CLI 테스트에서 full rebuild 출력과 일치함을 검증.

### [x] codegen CLI: dirty detection and dependency invalidation primitive
entry spec, domain spec, profile spec, external ref 파일을 absolute path + realpath + size + mtime + sha256으로 scan하는 helper를 추가.
WorkspaceIndex와 비교해 new/modified/deleted/unchanged를 분류하고, changed/deleted target의 `refs.to_file` 역방향 source file을 dirty로 전파한 뒤 stale index row invalidation 입력으로 사용.
외부 ref 파일 변경이 참조 spec을 dirty 처리하는 사례와 deleted file diagnostic 제거 사례를 테스트로 고정.

### [x] codegen CLI: SQLiteWorkspaceIndex 구현
`.oa-cache/state.sqlite` 기본 경로에 `meta`, `files`, `components`, `refs`, `source_locations`, `diagnostics`, `type_aliases` 테이블을 생성하는 `SQLiteWorkspaceIndex`를 추가.
WAL, busy timeout, foreign key, transaction-wrapped write를 적용하고 `schema_version`/option compatibility metadata mismatch 또는 DB 오류 시 full rebuild fallback으로 전환.
schema init, version/options mismatch, rollback, fallback 테스트를 추가.

### [x] codegen CLI: WorkspaceIndex 인터페이스 도입
parser correctness와 분리된 `WorkspaceIndex` 경계를 `@oa-sdk/codegen`에 추가.
file hash/component/ref/source location/diagnostic/type alias metadata 모델과 noop/memory 구현을 제공.
기본 noop index는 scan 입력 전체를 changed로 반환해 기존 full rebuild 동작을 유지하며, parser 패키지는 SQLite 의존성을 갖지 않음.

### [x] codegen: external ref source identity 정규화
`analyzeExternalSchemaRefs()`가 shared `resolveRefGraph()` 결과만 사용하고 별도 `derefSpec()` fallback을 제거.
entry 문서 raw ref는 기존 override로 유지하되, 외부 schema 내부 nested ref는 absolute file+pointer identity로 정규화해
같은 raw relative ref 문자열이 서로 다른 source document에서 다른 파일을 가리키는 경우에도 안정적으로 타입 alias에 연결.
missing/read/pointer 실패 diagnostic은 resolver code와 sourceFilePath/sourcePointer/filePath/pointer를 유지.
이름 충돌/로컬 shadow rename warning은 resolved file+pointer와 생성 타입명을 포함.

### [x] parser/codegen: ref resolver 단일화 심화
`resolveRefGraph()`와 `derefSpec()`가 parser 내부 `RefResolver` contract를 공유하도록 정리.
외부 YAML/JSON 문서 로딩, JSON Pointer 해소, cache key/document cache key, source pointer, file/pointer metadata,
missing/circular/read-failed diagnostic을 `RefResolution` 결과 객체에서 일관되게 제공. public parser index export는 변경하지 않음.

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
로컬 `pnpm schema:validate`와 CI `oa-gen validate`가 같은 표준 파이프라인을 타도록 정리.

### [x] schemas: component overwrite 기본 차단
도메인 병합 시 중복 component key는 기본 오류. `ALLOW_COMPONENT_OVERRIDES=1` 또는 `ALLOW_COMPONENT_OVERRIDE_KEYS`로 명시 허용.

### [x] codegen: operation 묶음 타입 생성
`typegen/generate-types.ts`에서 Operation 묶음 타입 생성 완료.
`type XxxOp = { method, path, params, query, body, response, headers }`.

### [x] mock-server: Server variables 적용
`resolveServerUrl()` client에서 연결 완료. 서버 변수 해소로 동적 baseUrl 지원.

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
- [x] 1594 테스트 (core 51, parser 196, codegen 473, mock-server 561, playground 114, router 35, client 36, schemas 75, typia-mock 53)

</details>
