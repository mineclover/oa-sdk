# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.
> 정렬 기준: definition builder → ref correctness → 증분 workspace index → 코드 생성 정책 → 진단 UX → 공개 API → 런타임 활용 → 남은 OAS 스펙 순.
> 증분 설계: [ADR-006 — SQLite 기반 증분 Workspace Index](./architecture/006-incremental-workspace-index.md)
> 다음 PRD: [OpenAPI Definition Builder](../../tasks/prd-openapi-definition-builder.md)

---

## 다음 세션 실행 순서

현재 ralph PRD 기준 US-001~US-022는 모두 완료됨. OpenAPI definition builder의 canonical ID grammar/parser(US-001), fragment definition node model(US-002), registry graph/ref edge collection(US-003), source canonical/file ref resolution(US-004), output `$ref` rewrite(US-005)는 완료되었고, 다음 blocking 목표는 output naming/collision simulation이다.

### [ ] OpenAPI definition builder: output naming and collision simulation
배경: 같은 local name `Note`라도 book note와 notebook note는 의미가 다를 수 있어 source 정의를 바꾸지 않고 output naming으로 충돌을 해결해야 함.
작업: target server → domain → local name 순서의 namespace allocation, `preserve-if-unique`, `domain-prefix`, explicit alias naming policy, alias metadata, collision report 구현. `schema:public/a/Name`과 `schema:public/aname/Name`처럼 flatten 결과가 같을 수 있는 canonical identity는 동치로 보지 않고 output-name collision으로 보고. structural hash 동일성은 warning/info만 내고 자동 병합하지 않음.
완료 기준: public/admin target fixture에서 `book.Note`와 `notebook.Note`가 각각 `BookNote`/`NotebookNote`로 deterministic emit되고, `schema:public/a/Name` vs `schema:public/aname/Name` collision이 report되며, duplicate canonical id는 error, structural duplicate는 warning/info report로 검증됨.

### [ ] OpenAPI definition builder: target bundle emit
배경: 여러 서버와 특정 path 하위 조합을 지원하려면 target별 servers/domains/paths include 규칙이 필요함.
작업: target config format, public/admin/internal fixture, selected paths + recursive refs emit, OpenAPI 3.2 document generation.
완료 기준: target output이 `validateDocument()`를 통과하고 기존 schema validate pipeline과 병렬로 실행 가능함.

### [ ] OpenAPI definition builder: CLI and migration plan
배경: 현재 `packages/schemas/scripts/merge.ts`를 즉시 제거하지 않고 새 builder를 병렬 검증해야 함.
작업: `oa-gen build-spec --target ...` 또는 동등 script 추가, diagnostics/output path 지원, 현재 domain merge에서 fragment builder로 가는 migration 문서화.
완료 기준: 기존 `.merged.yaml` path는 유지하면서 builder output을 별도 artifact로 검증 가능함.

### [ ] 운영 관찰: SQLite optional native dependency 설치성
배경: `better-sqlite3`는 증분 WorkspaceIndex의 primary driver지만 native optional dependency라 환경별 설치 실패 가능성이 있음.
현재 처리: 설치 성공 시 `better-sqlite3` 사용, 실패 시 `node:sqlite`, 둘 다 실패하거나 DB 오류가 나면 full rebuild fallback + CLI warning.
관찰 기준: CI/개발자 환경에서 optional install 실패가 잦거나 fallback warning이 반복되면 prebuilt 지원 범위 또는 driver 정책을 재검토.

### [ ] 운영 관찰: Spectral response-example 힌트 4건
배경: `pnpm schema:validate`는 통과하지만 Spectral `response-example-recommended` hint가 4건 남아 있음.
현재 처리: 0 error / 0 warning / 4 hint로 문서화. schema correctness에는 영향 없음.
후속 기준: Prism/mock 예제 품질을 더 강화하기로 하면 `paths./users.get.responses[200]`, `components.schemas.Error`, `HealthStatus`, `User` 예제를 보강.

### [ ] 운영 관찰: node:sqlite experimental warning in tests
배경: 실제 `SQLiteWorkspaceIndex`는 `better-sqlite3`를 primary로 잡지만, 일부 테스트 헬퍼가 DB meta 확인용으로 `node:sqlite`를 직접 열어 warning이 출력됨.
현재 처리: 기능 실패는 아니며 `better-sqlite3` driver 사용은 수동 검증 완료.
후속 기준: 테스트 로그 소음을 줄여야 하면 테스트 헬퍼도 selected driver adapter를 재사용하도록 정리.

---

## 완료된 실행 항목

### [x] OpenAPI definition builder: output ref rewrite
배경: registry graph는 source `$ref`를 canonical id로 정규화하지만, 실제 build output은 canonical id를 target-local OpenAPI `$ref`로 rewrite해야 함.
완료: `rewriteDefinitionOutputRefs()`가 registry의 resolved `targetId`를 사용해 nested fragment content와 refs의 source `$ref`를 OpenAPI component `$ref`로 변환함. Schema/response/parameter/requestBody/header/link/callback/securityScheme은 각각 `#/components/schemas`, `#/components/responses`, `#/components/parameters`, `#/components/requestBodies`, `#/components/headers`, `#/components/links`, `#/components/callbacks`, `#/components/securitySchemes`로 매핑하며, output name map/callback으로 target-local alias를 주입할 수 있음.
완료 기준: nested canonical/file ref rewrite, 모든 component-like kind 위치, `oa://` 미포함 output refs, diagnostic source path/pointer 보존이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: canonical/file source ref resolution
배경: fragment source는 emitted OpenAPI component name이 아니라 canonical concept identity를 참조해야 함.
완료: registry가 `oa://{kind}/{scope}/{domain}/{name}` source ref를 `kind:scope/domain/name` canonical id로 정규화하고, registered definition source와 일치하는 상대 file ref도 canonical id로 해소함. Missing target은 `definition-registry/missing-ref`, legacy/internal/invalid canonical ref는 `definition-registry/unsupported-ref` diagnostic으로 보고하며 raw ref와 source path/pointer, optional line/column을 보존함.
완료 기준: canonical ref, relative file ref, missing ref, unsupported ref, nested transitive ref resolution이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: registry graph + ref edge collection
배경: `$ref`는 구성요소 정의를 연결하는 그래프 edge이므로 build 전에 fragment registry에서 raw source refs와 duplicate id를 분석해야 함.
완료: `@oa-sdk/parser`에 public `DefinitionRegistry`, `DefinitionRegistryRefEdge`, `DefinitionRegistryDiagnostic` 모델과 `createDefinitionRegistry()` / `collectDefinitionRefs()`를 추가함. Registry는 unique canonical id node map을 만들고 duplicate canonical id를 error diagnostic으로 보고하며, fragment content를 JSON Pointer-aware traversal로 순회해 `$ref` edge와 canonical `oa://...` target id를 수집함.
완료 기준: node registration, ref edge collection, duplicate canonical id rejection이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: fragment definition node model
배경: Canonical ID가 확정되었으므로 각 fragment가 source metadata, refs, content hash, classification metadata를 운반할 node 모델이 필요함.
완료: `@oa-sdk/parser`에 public `DefinitionNode`, `DefinitionRef`, `DefinitionMetadata` 타입과 `createDefinitionNode()` / `createDefinitionRef()` 생성 helper를 추가함. node 생성은 canonical id에서 kind/scope/domain/localName을 파생하고 source path/pointer, content hash, optional metadata, refs를 보존함.
완료 기준: definition node construction과 source metadata preservation이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: canonical ID grammar
배경: OpenAPI fragment source identity를 output component name과 분리하려면 고정 canonical id 문법이 필요함.
완료: `@oa-sdk/parser`에 `kind:scope/domain/name` parser/validator를 추가하고 supported kind, lower-case scope/domain, component-like PascalCase name, malformed/nested id, duplicate canonical id diagnostic을 테스트함. `@oa-sdk/schemas`에 `schema:public/book/Note`, `schema:public/notebook/Note`, `schema:shared/common/Error` fixture를 추가함.
완료 기준: source identity와 output component name 분리가 문서화되고 malformed/nested/duplicate canonical id가 error로 검출됨.

### [x] router/client: ResponseHeaders 활용
배경: typegen은 `XxxResponseHeaders`를 생성하지만 router/client 런타임 API는 아직 타입을 적극 활용하지 않음.
진행: router는 문서화된 응답 헤더가 있으면 `Partial<XxxResponseHeaders>` placeholder와 Hono/Express 공용 header setter helper를 생성해 handler stub에서 타입 힌트를 제공함.
완료: client는 문서화된 응답 헤더가 있는 non-streaming operation에 `withResponse.<operation>()`을 생성해 기존 body 반환 메서드는 유지하고 `{ body, headers, response }` 형태로 typed `XxxResponseHeaders` 접근을 제공함. Header lookup은 Fetch `Headers` 기반 case-insensitive 조회와 fallback 순회를 사용하며, 누락된 optional header는 결과에서 생략됨.
완료 기준: 생성된 Op 타입의 `headers`가 router/client 사용 예제와 테스트에서 실제로 소비됨.

### [x] 리뷰 보완: lint source pointer escaping
문제: `paths` 아래 lint path가 JSON Pointer escape 되지 않아 `/bad`가 `#/paths//bad/get`처럼 기록되고 YAML line/column lookup이 실패함.
완료: lint path 생성에 JSON Pointer escaping helper를 적용해 `#/paths/~1bad/get`로 source lookup되며, CLI validate/lint가 `file:line:column`을 출력함.

### [x] 리뷰 보완: SQLite fallback visibility
문제: `--incremental` 사용 시 SQLite open 실패가 조용히 full rebuild로 fallback되어 사용자가 persistent cache 사용 여부를 알기 어려움.
완료: SQLite fallback reason을 CLI warning으로 출력.

### [x] 리뷰 보완: type alias metadata persistence
문제: `type_aliases` table/schema는 있었지만 CLI typegen 경로에서 external alias metadata를 기록하지 않음.
완료: `ExternalSchemaTypeAlias` metadata를 `analyzeExternalSchemaRefs()`에서 생성하고, `oa-gen typegen --incremental`이 WorkspaceIndex `type_aliases`에 기록.

### [x] 리뷰 보완: SQLite driver policy
문제: `node:sqlite`와 `better-sqlite3`가 같은 DB 파일을 번갈아 열 때 cache 안정성 정책이 명시되지 않음.
완료: `better-sqlite3`를 primary optional driver로 추가하고, `node:sqlite` fallback을 유지. `meta.driver_name`을 저장해 driver 변경 시 index row를 비우고 한 번 full rebuild diff를 강제.

---

## 단기 미구현 스펙

### 7. [x] Encoding — multipart 필드별 인코딩
배경: 타입은 준비됐지만 request-validator multipart 파싱과 필드별 `contentType`/`style` 처리는 남아 있음.
작업: multipart part 단위 decoding과 OpenAPI Encoding Object 규칙을 request validation에 연결.
완료: mock-server multipart 파서가 part별 Content-Type/header metadata를 보존하고, request validator가 Encoding Object의 필드별 `contentType` 검증, JSON part decoding, `form` style `explode=false` 배열/객체와 배열 `explode=true` 처리를 수행함. 지원하지 않는 object style/explode 조합은 `PROTOCOL_MISMATCH` diagnostic으로 명시적으로 실패한다.
완료 기준: 필드별 content type, style/explode, 잘못된 part encoding 실패 케이스가 테스트됨.

### 8. [x] Links — 응답 관계 정보
배경: Links는 타입과 파싱은 완료됐지만 mock 응답과 typegen 소비는 아직 얕음.
작업: Operation Object의 Link 정보를 mock 응답 메타데이터와 typegen Link 타입으로 연결.
완료: typegen이 성공 응답 Link Object를 `XxxResponseLinks` 타입으로 생성하고 Op bundle에 `responseLinks` 메타데이터 필드를 포함한다. mock-server `pickResponse()`는 선택된 응답의 resolved Link Object를 `PickedResponse.links`로 노출하며, HTTP 어댑터는 link metadata를 body payload에 주입하지 않는다.
완료 기준: 응답에서 다음 operation 관계를 추적할 수 있고, Link 타입 생성 테스트가 있음.

### 9. [x] Callbacks — 아웃바운드 웹훅
배경: Callbacks는 타입과 파싱은 완료됐지만 mock-server에서 outbound 호출 시뮬레이션이 없음.
작업: callback URL expression 평가와 mock outbound POST 흐름을 설계하고 테스트 헬퍼로 노출.
완료: mock-server 성공 응답에서 Operation callbacks를 읽어 지원 runtime expression(`$url`, `$method`, `$statusCode`, `$request.path/query/header/body`, `$response.header/body`)을 평가하고, callback Path Item의 `post` requestBody를 기존 mock body 생성 우선순위로 payload화해 simulated outbound POST attempt로 노출한다. MSW/Node 옵션의 `onCallback` hook과 `createCallbackTracker()` 테스트 헬퍼로 성공/실패 attempt를 관찰할 수 있으며, URL 미해결/invalid 표현은 inbound 응답을 실패시키지 않고 attempt error metadata로 기록한다.
완료 기준: 요청 처리 후 callback route로 payload를 보내는 성공/실패 시나리오가 테스트됨.

### 10. [x] XML 직렬화
배경: XML 타입은 준비됐지만 `application/xml` body parsing/serialization은 미지원.
작업: XML Object 규칙, request body parsing, response serialization 범위를 최소 지원부터 정함.
완료: mock-server가 `application/xml` 요청을 element-only XML로 파싱하고 schema-aware primitive coercion/object/array 검증을 수행한다. 응답은 같은 최소 범위로 XML 문자열을 직렬화하며 MSW/Node adapters의 content-type별 응답 serialization에 연결했다. 지원 범위는 object child elements, repeated element arrays, primitive text, `xml.name` element rename이며 attributes, namespaces/prefixes, CDATA/text node modeling, non-element `nodeType`, wrapped array semantics는 non-goal로 두고 request validation/preflight에서 명확한 diagnostic을 반환한다.
완료 기준: 기본 object/array XML 직렬화와 content-type negotiation 테스트가 있음.

---

## 최근 완료

### [x] Links 응답 관계 메타데이터
성공 응답의 Link Object를 typegen `XxxResponseLinks` 타입과 Op bundle `responseLinks` 필드로 생성한다.
`parameters`와 `requestBody` runtime expression 문자열은 literal metadata type으로 보존한다.
mock-server 응답 선택 결과는 `links` 메타데이터를 노출하되, HTTP 응답 body semantics는 그대로 유지한다.

### [x] Callbacks outbound simulation
Operation callbacks의 URL runtime expression을 요청/응답 컨텍스트에서 평가하고 callback `post` requestBody를 mock payload로 생성한다.
실제 네트워크 호출 대신 `CallbackPostAttempt` metadata를 생성하며, `onCallback` hook과 `createCallbackTracker()`로 테스트에서 outbound webhook behavior를 관찰한다.
미해결 또는 invalid URL expression은 inbound mock response를 유지하면서 attempt error metadata에 기록한다.

### [x] codegen: TypegenOptions/SchemaToTsOptions 공개 API 정리
`TypegenOptions`는 `generateTypes*()`가 root entry에서도 공개되어 있으므로 `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen` 양쪽에서 지원한다.
`schemaToTs()`도 양쪽 entry에서 공개된 함수이므로 `SchemaToTsOptions`를 같은 두 entry에서 public type으로 export한다.
package exports는 `.`, `./drizzle`, `./typegen`만 유지해 `@oa-sdk/codegen/typegen/schema-to-ts` 같은 deep implementation import는 비공개로 둔다.
공개 옵션 타입 import와 비공개 deep subpath 정책은 codegen public API 테스트와 API index에 반영했다.
package import fixture가 `@oa-sdk/codegen` / `@oa-sdk/codegen/typegen`의 `TypegenOptions`와 `SchemaToTsOptions` import를 typecheck하고, API index validation도 typegen option subpath 정책을 검증한다.

### [x] diagnostics: YAML line/column source map
YAML AST range와 `LineCounter`를 사용하는 `createSourceLocationIndex()` / `createYamlSourceLocationIndex()`를 parser public API로 추가.
object key, array index, nested schema pointer를 `filePath` + JSON Pointer + line/column으로 조회할 수 있고, JSON 입력은 YAML 전용 metadata 없이 빈 index로 유지한다.
`oa-gen lint`/`oa-gen validate` 출력은 source mapping이 있으면 `file:line:column`을 보여주며, target `file#pointer` fallback은 계속 포함한다.
Ref graph, lint, schema meta validation diagnostic 구조도 mapping이 있으면 source `line`/`column`을 보존한다.
증분 WorkspaceIndex 기록도 YAML source_locations와 diagnostic line/column을 함께 보강한다.

### [x] codegen: 외부 `$defs` / 비 components schema alias 정책
외부 YAML/JSON schema-position `$ref` alias 정책을 components-only에서 schema object target으로 확장.
`#/components/schemas/*`, `#/$defs/*`, `#/schemas/*`, `#/models/*` 같은 비 components schema root는 generated alias로 정규화한다.
alias 이름은 JSON Pointer 마지막 segment를 사용하고, 기존 file-stem 기반 deterministic rename과 resolver diagnostic/source metadata 보존 규칙을 유지한다.
`$defs`와 비 components root의 nested internal ref도 absolute file+pointer identity로 rewrite해 source 외부 문서 기준 alias를 가리키도록 테스트로 고정.
operation 생성 타입과 충돌하는 외부 alias도 file-stem 기반 deterministic rename을 사용하고, 지원하지 않는 외부 pointer root는 경고와 함께 `unknown`으로 생성한다.

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
