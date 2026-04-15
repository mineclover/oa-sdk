# API Index — 기능별 단일 소스 매핑

> 동일 목적의 기능이 재구현되지 않도록 관리합니다.
> 새 기능 추가 시 이 인덱스를 먼저 확인하세요.

---

## OAS 3.2 타입 (`@oa-sdk/parser`)

스펙 섹션별 분할. 상세: [oas32-coverage.md](./oas32-coverage.md)

| 파일 | 스펙 | 주요 타입 |
|------|------|----------|
| `types/common.ts` | — | `Referenceable<T>`, `OasReference`, `OasExtensions` |
| `types/document.ts` | §3 | `OasDocument`, `OasInfo`, `OasContact`, `OasLicense` |
| `types/server.ts` | §4 | `OasServer`, `OasServerVariable` |
| `types/components.ts` | §5 | `OasComponents`, `OasPaths` |
| `types/operations.ts` | §6 | `OasPathItem`, `OasOperation`, `OasExternalDocs` |
| `types/parameters.ts` | §7 | `OasParameter`, `OasParameterIn` |
| `types/request-body.ts` | §8 | `OasRequestBody`, `OasMediaType`, `OasEncoding` |
| `types/responses.ts` | §9 | `OasResponses`, `OasResponse`, `OasCallback` |
| `types/examples.ts` | §10 | `OasExample`, `OasLink` |
| `types/headers-tags.ts` | §11 | `OasHeader`, `OasTag` |
| `types/schema.ts` | §12 | `OasSchema`, `OasDiscriminator` |
| `types/xml.ts` | §13 | `OasXml`, `OasXmlNodeType` |
| `types/security.ts` | §14 | `OasSecuritySchemeType`, `OasSecurityScheme`, `OasOAuthFlows`, `OasOAuthFlow`, `OasSecurityRequirement` |

---

## IR 타입 (`@oa-sdk/parser`)

| 타입 | 정의 | 용도 |
|------|------|------|
| `ParsedDocument` | `parser/src/types.ts` | 파싱된 OAS 문서 전체 IR — 소비자의 입력 |
| `OperationEntry` | `parser/src/types.ts` | $ref 해결된 개별 오퍼레이션 |
| `RouteIndex` | `parser/src/types.ts` | path → method → OperationEntry 인덱스 |
| `MatchResult` | `parser/src/types.ts` | 경로 매칭 결과 (found / method_not_allowed / not_found) |
| `HttpMethod` | `parser/src/types.ts` | `'get' \| 'post' \| ... \| 'trace' \| 'query'` |

---

## 함수 (`@oa-sdk/parser`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `parseDocument()` | `parse.ts` | OAS 문서 → ParsedDocument IR (정식 진입점) |
| `loadSchema()` | `schema-loader.ts` | OAS 문서 → RouteIndex (레거시 호환) |
| `matchRoute()` | `schema-loader.ts` | RouteIndex에서 경로+메서드 매칭 |
| `HTTP_METHODS` | `schema-loader.ts` | HTTP 메서드 상수 배열 |
| `runPipeline()` | `pipeline.ts` | SpecPass[] 순차 실행 |
| `derefPass` | `pipeline.ts` | $ref 해소 기본 패스 |
| `createDerefPass()` | `pipeline.ts` | basePath/diagnostic 옵션을 가진 $ref 해소 Pass 생성 |
| `DEFAULT_PASSES` | `pipeline.ts` | 기본 파이프라인 패스 배열 |
| `foldSchema()` | `fold.ts` | SchemaAlgebra 기반 스키마 순회 |
| `SchemaFolder` | `folder.ts` | SchemaAlgebra 클래스 기반 순회 |
| `DerefFolder` | `deref.ts` | $ref 해소 Folder |
| `derefSpec()` | `deref.ts` | $ref 인라인 전개 |
| `derefSpecWithDiagnostics()` | `deref.ts` | $ref 인라인 전개 + 순환/외부 ref diagnostic 수집 |
| `resolveRefGraph()` | `ref-graph.ts` | 내부/외부 `$ref` 그래프 수집과 diagnostic 생성 |
| `collectRefs()` | `ref-graph.ts` | 문서 트리에서 `$ref` 위치 수집 |
| `isRelativeRef()` | `ref-graph.ts` | 상대 파일 `$ref` 판별 |
| `resolvePointer()` | `ref-graph.ts` | JSON Pointer 해소 |
| `findOperation()` | `query.ts` | operationId로 오퍼레이션 검색 |
| `findByTag()` | `query.ts` | 태그로 오퍼레이션 필터 |
| `findByPath()` | `query.ts` | 경로로 오퍼레이션 필터 |
| `getSchema()` | `query.ts` | 스키마 이름으로 조회 |
| `getTag()` | `query.ts` | 태그 이름으로 조회 |
| `groupByTag()` | `query.ts` | 태그별 오퍼레이션 그룹핑 |
| `describeApi()` | `query.ts` | API 구조 텍스트 설명 |
| `resolveServerUrl()` | `query.ts` | Server variables URL 치환 |
| `lintDocument()` | `lint.ts` | 7카테고리 17규칙 린트 |
| `validateDocument()` | `validate.ts` | 종합 검증 (파싱+린트) |

### 타입 (`@oa-sdk/parser` — 함수/파이프라인)

| 타입 | 파일 | 용도 |
|------|------|------|
| `SpecPass` | `pipeline.ts` | 파이프라인 패스 함수 타입 |
| `ParseDocumentOptions` | `parse.ts` | `parseDocument()` basePath/deref diagnostic 옵션 |
| `SchemaAlgebra` | `fold.ts` | fold 패턴 대수 인터페이스 |
| `DerefOptions` | `deref.ts` | deref basePath/diagnostic 옵션 |
| `DerefCycleStrategy` | `deref.ts` | 순환 `$ref` 처리 전략 (`empty-schema` / `preserve-ref`) |
| `DerefDiagnostic` | `deref.ts` | $ref 해소 diagnostic 항목 |
| `DerefDiagnosticCode` | `deref.ts` | $ref 해소 diagnostic 코드 |
| `RefGraph` | `ref-graph.ts` | `$ref` 그래프 분석 결과 |
| `RefGraphNode` | `ref-graph.ts` | 그래프 내 단일 `$ref` 노드 |
| `RefGraphDiagnostic` | `ref-graph.ts` | ref graph diagnostic 항목 |
| `RefGraphDiagnosticCode` | `ref-graph.ts` | ref graph diagnostic 코드 |
| `RefGraphOptions` | `ref-graph.ts` | ref graph basePath 옵션 |
| `RefKind` | `ref-graph.ts` | internal/external/unsupported ref 분류 |
| `LintResult` | `lint.ts` | 린트 결과 |
| `LintSeverity` | `lint.ts` | 린트 심각도 |
| `LintOptions` | `lint.ts` | 린트 옵션 |
| `ValidationResult` | `validate.ts` | 검증 결과 |

---

## 함수 (`@oa-sdk/codegen`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `zodToSchema()` | `zod-to-schema.ts` | Zod 4 → OAS 3.2 Schema (refs 컨텍스트 지원) |
| `generateComponents()` | `generator.ts` | Zod 맵 → YAML (writeSchemas 위임) |
| `defineConfig()` | `config.ts` | 타입 안전 config 헬퍼 |
| `generateTypes()` | `typegen/generate-types.ts` | ParsedDocument → TS 타입 문자열 |
| `generateTypesFromSpec()` | `typegen/generate-types.ts` | OAS spec → TS 타입 (parseDocument 포함) |
| `analyzeExternalSchemaRefs()` | `typegen/generate-types.ts` | 외부 schema-position `$ref` 스키마 타입명/충돌 diagnostic 조회 (`#/components/schemas/*`, `#/$defs/*`, 비 components schema root 포함, operation 타입 충돌/unsupported pointer 경고 포함) |
| `schemaToTs()` | `typegen/schema-to-ts.ts` | 단일 OAS Schema → TS 타입 문자열 (SchemaToTsOptions 지원) |
| `createWorkspaceIndex()` | `workspace-index.ts` | 기본 noop 또는 memory WorkspaceIndex 생성 |
| `createNoopWorkspaceIndex()` | `workspace-index.ts` | full rebuild 보존용 no-op WorkspaceIndex 생성 |
| `createMemoryWorkspaceIndex()` | `workspace-index.ts` | 파일 단위 metadata 저장/변경 감지용 in-memory WorkspaceIndex 생성 |
| `createSQLiteWorkspaceIndex()` | `sqlite-workspace-index.ts` | `.oa-cache/state.sqlite` 기반 persistent WorkspaceIndex 생성 |
| `SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION` | `sqlite-workspace-index.ts` | SQLite workspace index schema compatibility version |

### 타입 (`@oa-sdk/codegen`)

| 타입 | 파일 | 용도 |
|------|------|------|
| `OutputOptions` | `types.ts` | YAML 출력 옵션 (output, grouping, merge) |
| `NamedSchema` | `types.ts` | `{ name, schema }` — writer 입력 |
| `CodegenResult` | `types.ts` | `{ components, files, warnings }` |
| `CodegenConfig` | `config.ts` | `OutputOptions & { schemas }` |
| `DrizzleCodegenOptions` | `drizzle/index.ts` | `OutputOptions & { schemaPath, ... }` |
| `OasSchema` | **`@oa-sdk/parser` re-export** | codegen이 parser 정식 타입 사용 |
| `TypegenOptions` | `typegen/generate-types.ts` | typegen 옵션 (style, annotations, external ref warnings 등) |
| `ExternalSchemaRefAnalysis` | `typegen/generate-types.ts` | 외부 schema-position `$ref` alias 분석 결과 |
| `ExternalSchemaRefDiagnostic` | `typegen/generate-types.ts` | 외부 `$ref` 이름 충돌/operation 타입 충돌/unsupported pointer/해소 실패 diagnostic. sourceFilePath/sourcePointer + filePath/pointer 포함 가능 |
| `ExternalSchemaRefDiagnosticCode` | `typegen/generate-types.ts` | 외부 `$ref` diagnostic 코드. `external-schema-shadows-operation`, `external-schema-unsupported-pointer`, resolver diagnostic code도 보존 |
| `WorkspaceIndex` | `workspace-index.ts` | parser 밖의 증분 workspace index 경계. correctness 원천이 아닌 optimization/index layer |
| `WorkspaceFileRecord` | `workspace-index.ts` | file path/hash/size/mtime/parser version/run metadata |
| `WorkspaceComponentRecord` | `workspace-index.ts` | component section/name/pointer/content hash/source location metadata |
| `WorkspaceRefRecord` | `workspace-index.ts` | `$ref` edge source/target/kind/resolution/diagnostic metadata |
| `WorkspaceSourceLocationRecord` | `workspace-index.ts` | file pointer → line/column metadata |
| `WorkspaceDiagnosticRecord` | `workspace-index.ts` | producer/severity/code/message/source metadata |
| `WorkspaceTypeAliasRecord` | `workspace-index.ts` | external ref type alias name/rename/content hash metadata |
| `WorkspaceIndexDiff` / `WorkspaceIndexSnapshot` | `workspace-index.ts` | dirty detection and full index snapshot shapes |
| `WorkspaceIndexMode` / `WorkspaceIndexOptions` | `workspace-index.ts` | noop/memory/sqlite index factory configuration |
| `WorkspaceIndexCompatibilityMetadata` | `workspace-index.ts` | SQLite cache compatibility hash input metadata |
| `WorkspaceFileIndexData` | `workspace-index.ts` | 파일 단위 components/refs/source/diagnostics/typeAliases 교체 입력 |
| `WorkspaceRefKind` | `workspace-index.ts` | internal/external/unsupported ref edge kind |
| `WorkspaceDiagnosticSeverity` | `workspace-index.ts` | error/warning/info diagnostic severity |
| `WorkspaceComponentFilter` | `workspace-index.ts` | component metadata 조회 필터 |
| `WorkspaceRefFilter` | `workspace-index.ts` | ref edge 조회 필터 |
| `WorkspaceDiagnosticFilter` | `workspace-index.ts` | diagnostic metadata 조회 필터 |
| `WorkspaceTypeAliasFilter` | `workspace-index.ts` | type alias metadata 조회 필터 |
| `SQLiteWorkspaceIndex` | `sqlite-workspace-index.ts` | SQLite-backed WorkspaceIndex with database path, fallback reason, and close method |
| `SQLiteWorkspaceIndexOptions` | `sqlite-workspace-index.ts` | cacheDir/dbPath/schemaVersion/compatibility/busyTimeoutMs 설정 |

### 내부 함수 (`@oa-sdk/codegen` — index 미노출)

| 함수 | 파일 | 용도 |
|------|------|------|
| `generateFromDrizzle()` | `drizzle/index.ts` | Drizzle 파일 → YAML |
| `writeSchemas()` | `writer.ts` | NamedSchema[] → YAML 파일 |
| `mergeIntoSpec()` | `spec-merge.ts` | spec.yaml에 schemas 병합 |

---

## 어댑터 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `createMswHandlers()` | `adapters/msw.ts` | MSW 2.x 핸들러 배열 생성 |
| `createMswMockServer()` | `adapters/msw.ts` | MSW 핸들러 + override API 통합 |
| `MswHandlerOptions` | `adapters/msw.ts` | MSW 옵션 타입 |
| `MswMockServer` | `adapters/msw.ts` | MSW mock 서버 타입 (handlers + override) |
| `createNodeMockServer()` | `adapters/node-http.ts` | Node HTTP 목 서버 생성 |
| `NodeMockServer` | `adapters/node-http.ts` | Node 서버 인스턴스 타입 (override 포함) |
| `NodeMockServerOptions` | `adapters/node-http.ts` | Node 서버 옵션 타입 |
| `OverrideResponse` | `adapters/node-http.ts` | override 응답 타입 |

## parser re-exports (`@oa-sdk/mock-server`)

| 함수/타입 | 원본 | 용도 |
|-----------|------|------|
| `foldSchema` | `@oa-sdk/parser` | 스키마 재귀 순회 |
| `SchemaAlgebra` | `@oa-sdk/parser` | fold 대수 인터페이스 |
| `SchemaFolder` | `@oa-sdk/parser` | 클래스 기반 순회 |
| `DerefFolder`, `derefSpec` | `@oa-sdk/parser` | $ref 해소 |
| `runPipeline`, `derefPass`, `DEFAULT_PASSES` | `@oa-sdk/parser` | 파이프라인 |
| `SpecPass` | `@oa-sdk/parser` | 패스 타입 |
| `loadSchema`, `matchRoute` | `@oa-sdk/parser` | 레거시 라우트 로더 |

## 함수 (`@oa-sdk/mock-server` — 고유)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `GenerateFolder` | `core/generate.ts` | 응답 데이터 생성 Folder |
| `generator` | `core/generate.ts` | 생성 인스턴스 |
| `generateAlgebra` | `core/generate.ts` | 생성 대수 |
| `StreamFolder` | `core/stream.ts` | 스트림 응답 Folder |
| `streamer` | `core/stream.ts` | 스트림 인스턴스 |
| `SSE_DONE` | `core/stream.ts` | SSE 종료 상수 |
| `formatSseChunk()` | `core/stream.ts` | SSE 청크 포맷 |
| `formatNdjsonLine()` | `core/stream.ts` | NDJSON 라인 포맷 |
| `isStreamingContentType()` | `core/stream.ts` | 스트림 content-type 판별 |
| `generateStreamChunks()` | `core/stream.ts` | 스트리밍 응답 청크 생성 (어댑터 공유) |
| `StreamOptions` | `core/stream.ts` | 스트림 옵션 타입 |
| `filterRouteIndex()` | `core/route-filter.ts` | RouteIndex 필터링 |
| `RouteFilter` | `core/route-filter.ts` | 필터 조건 타입 |
| `handleRequest()` | `core/handler.ts` | 공통 요청 검증 + 응답 선택 (어댑터 공유) |
| `HandlerResult` | `core/handler.ts` | 핸들러 결과 타입 |
| `validateRequest()` | `core/request-validator.ts` | AJV 기반 요청 검증 |
| `validateRequestSchemas()` | `core/request-validator.ts` | RouteIndex 요청 스키마 preflight 컴파일 검증 |
| `assertValidRequestSchemas()` | `core/request-validator.ts` | preflight 실패 시 예외 발생 |
| `pickResponse()` | `core/response-picker.ts` | 응답 선택 (6단계 폴백) |
| `PickedResponse` | `core/response-picker.ts` | 선택된 응답 타입 |

## 에러 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `MockErrorCode` | `errors/types.ts` | 에러 코드 유니온 |
| `MockValidationStage` | `errors/types.ts` | 검증 단계 ('parse' \| 'coerce' \| 'validate') |
| `MockErrorDetail` | `errors/types.ts` | 에러 상세 타입 (path, code, message, received, value, expected, constraint, stage) |
| `MockValidationResult` | `errors/types.ts` | 검증 결과 타입 |
| `MockErrorResponse` | `errors/types.ts` | 에러 응답 타입 (ApiError 구조 호환) |
| `classifyAjvErrors()` | `errors/classifier.ts` | AJV 에러 분류 |

## 테스트 헬퍼 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `createTestClient()` | `testing.ts` | 테스트용 typed fetch wrapper |
| `createCoverageTracker()` | `testing.ts` | operationId 커버리지 추적 |
| `TestClient` | `testing.ts` | 테스트 클라이언트 타입 |
| `TestResponse` | `testing.ts` | 테스트 응답 타입 |
| `CoverageTracker` | `testing.ts` | 커버리지 추적기 타입 |

---

## 함수 (`@oa-sdk/router`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `generateRouter()` | `generate-router.ts` | OAS spec → Hono/Express 라우터 스텁 코드 |
| `RouterTarget` | `generate-router.ts` | 대상 프레임워크 타입 (`'hono' \| 'express'`) |
| `RouterOptions` | `generate-router.ts` | 라우터 생성 옵션 타입 |

---

## 함수 (`@oa-sdk/client`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `generateClient()` | `generate-client.ts` | OAS spec → fetch 기반 createClient() 코드 |
| `ClientOptions` | `generate-client.ts` | 클라이언트 생성 옵션 타입 |

---

## 함수 (`@oa-sdk/core` — 공유 유틸)

| 함수 | 파일 | 용도 |
|------|------|------|
| `pascalCase()` | `strings.ts` | snake_case/kebab-case → PascalCase |
| `escapeKey()` | `strings.ts` | 비식별자 키 → 따옴표 이스케이프 |
| `toColonPath()` | `strings.ts` | `/users/{id}` → `/users/:id` |
| `collectTypeNames()` | `codegen-utils.ts` | operations → typegen 타입 이름 수집 (ResponseHeaders 포함) |
| `formatGeneratedTs()` | `format.ts` | 생성 코드 자동 들여쓰기 |
| `pickDefaultStatus()` | `response-utils.ts` | OAS responses → 기본 상태 코드 (범위/default 지원) |
| `createHttpServer()` | `http.ts` | 범용 Node HTTP 서버 생성 (handler → HttpServerHandle) |
| `writeJson()` | `http.ts` | HTTP 응답 JSON 기록 |
| `readRaw()` | `http.ts` | HTTP 요청 body raw string 읽기 |
| `readJsonBody()` | `http.ts` | HTTP 요청 body JSON 파싱 |
| `HttpServerOptions` | `http.ts` | 서버 옵션 타입 (port, host) |
| `HttpServerHandle` | `http.ts` | 서버 인스턴스 타입 (start, stop, url) |
| `HttpHandler` | `http.ts` | 요청 핸들러 타입 |
| `ErrorEnvelope` | `http.ts` | 에러 응답 공통 래퍼 타입 |
| `ApiError` | `http.ts` | API 에러 상세 타입 |
| `ApiErrorDetail` | `http.ts` | 에러 필드 상세 타입 |

---

## 함수 (`@oa-sdk/typia-mock`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `validateRawArgs()` | `core/validator.ts` | 전체 3단계 파이프라인 (parse→coerce→validate) |
| `validateParsedArgs()` | `core/validator.ts` | coerce→validate 파이프라인 (파싱 완료 입력) |
| `generateFromSchema()` | `core/generate.ts` | JSON Schema → 최솟값 생성 (typiaGenerateAlgebra) |
| `typiaGenerateAlgebra` | `core/generate.ts` | typia 특화 SchemaAlgebra (allOf merge) |
| `listFunctions()` | `core/function-registry.ts` | ILlmApplication 함수 목록 조회 |
| `getFunction()` | `core/function-registry.ts` | 이름으로 함수 조회 |
| `createTypiaMockServer()` | `server/node-http.ts` | typia 검증 목 서버 생성 |

### 타입 (`@oa-sdk/typia-mock`)

| 타입 | 파일 | 용도 |
|------|------|------|
| `ILlmFunction` | `types.ts` | typia ILlmFunction 호환 최소 인터페이스 |
| `ILlmApplication` | `types.ts` | typia ILlmApplication 호환 최소 인터페이스 |
| `ValidationResult` | `types.ts` | 3단계 검증 결과 (판별 유니온) |
| `ValidationStage` | `types.ts` | 실패 단계 ('parse' \| 'coerce' \| 'validate') |
| `TypiaErrorDetail` | `types.ts` | 검증 에러 상세 (path, expected, value — typia 원문) |
| `TypiaErrorCode` | `types.ts` | HTTP 에러 코드 (PARSE_ERROR 등) |
| `TypiaErrorResponse` | `types.ts` | ApiError\<TypiaErrorCode\> (공통 에러 envelope) |
| `TypiaSuccessResponse` | `types.ts` | HTTP 성공 응답 타입 |
| `FunctionInfo` | `types.ts` | GET /functions 응답용 함수 정보 |
| `TypiaMockServer` | `types.ts` | 서버 인스턴스 타입 (start, stop, url) |
| `TypiaMockServerOptions` | `types.ts` | 서버 옵션 (port, host) |

---

## 재구현 금지 체크리스트

| 필요한 것 | 사용할 것 | 하지 말 것 |
|-----------|----------|-----------|
| pascalCase/escapeKey | `@oa-sdk/core` | 패키지별 로컬 정의 |
| 경로 변환 ({id}→:id) | `toColonPath()` from core | 로컬 regex replace |
| 타입 이름 수집 | `collectTypeNames()` from core | 로컬 함수 정의 |
| OAS 3.2 타입 | `@oa-sdk/parser` types/ | openapi3-ts, 로컬 타입 정의 |
| OAS 문서 파싱 | `parseDocument()` | loadSchema() (레거시) |
| 스키마 순회 | `foldSchema()` + `SchemaAlgebra` | 직접 switch/if 분기 |
| YAML 쓰기 | `writeSchemas()` | writeFileSync + stringifyYaml |
| spec 병합 | `mergeIntoSpec()` | 직접 YAML read/parse/write |
| Zod → OAS | `zodToSchema()` | 부분 재구현 |
| OAS → TS 타입 | `schemaToTs()` / `generateTypes()` | 별도 TS 생성기 만들지 말 것 |
| 라우터 스텁 | `generateRouter()` | 별도 코드젠 만들지 말 것 |
| 클라이언트 SDK | `generateClient()` | 별도 fetch 래퍼 만들지 말 것 |
| HTTP 서버 생성 | `createHttpServer()` from core | 직접 http.createServer 하지 말 것 |
| HTTP 응답 기록 | `writeJson()` from core | 직접 res.end(JSON.stringify) 하지 말 것 |
| 에러 응답 타입 | `ApiError<Code>` from core | 패키지별 에러 envelope 재정의 금지 |
| typia LLM 검증 | `@oa-sdk/typia-mock` | 별도 typia 검증 서버 만들지 말 것 |
| mock 데이터 생성 | `foldSchema()` + algebra | 직접 JSON Schema 재귀 순회 금지 |
| pascalCase 변환 | 공유 필요 (현재 중복 가능성 있음) | 패키지별 별도 정의 금지 |
