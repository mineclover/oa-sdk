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
| `types/security.ts` | §14 | `OasSecurityScheme`, `OasOAuthFlows`, `OasSecurityRequirement` |

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
| `runPipeline()` | `pipeline.ts` | SpecPass[] 순차 실행 |
| `resolveServerUrl()` | `query.ts` | Server variables URL 치환 |
| `validateDocument()` | `validate.ts` | 종합 검증 (파싱+린트) |
| `derefSpec()` | `deref.ts` | $ref 인라인 전개 |
| `foldSchema()` | `fold.ts` | SchemaAlgebra 기반 스키마 순회 |

---

## 타입 (`@oa-sdk/codegen`)

| 타입 | 정의 | 용도 |
|------|------|------|
| `OutputOptions` | `codegen/src/types.ts` | YAML 출력 옵션 (output, grouping, merge) |
| `NamedSchema` | `codegen/src/types.ts` | `{ name, schema }` — writer 입력 |
| `CodegenResult` | `codegen/src/types.ts` | `{ components, files, warnings }` |
| `CodegenConfig` | `codegen/src/config.ts` | `OutputOptions & { schemas }` |
| `DrizzleCodegenOptions` | `codegen/src/drizzle/index.ts` | `OutputOptions & { schemaPath, ... }` |
| `OasSchema` | **`@oa-sdk/parser` re-export** | codegen이 parser 정식 타입 사용 |

---

## 함수 (`@oa-sdk/codegen`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `zodToSchema()` | `zod-to-schema.ts` | Zod 4 → OAS 3.2 Schema |
| `generateComponents()` | `generator.ts` | Zod 맵 → YAML (writeSchemas 위임) |
| `generateFromDrizzle()` | `drizzle/index.ts` | Drizzle 파일 → YAML |
| `writeSchemas()` | `writer.ts` | NamedSchema[] → YAML 파일 |
| `mergeIntoSpec()` | `spec-merge.ts` | spec.yaml에 schemas 병합 |
| `defineConfig()` | `config.ts` | 타입 안전 config 헬퍼 |

---

## 함수 (`@oa-sdk/mock-server`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `handleRequest()` | `core/handler.ts` | 공통 요청 검증 + 응답 선택 (어댑터 공유) |
| `validateRequest()` | `core/request-validator.ts` | AJV 기반 요청 검증 |
| `pickResponse()` | `core/response-picker.ts` | 응답 선택 (6단계 폴백) |
| `createTestClient()` | `testing.ts` | 테스트용 typed fetch wrapper |
| `createCoverageTracker()` | `testing.ts` | operationId 커버리지 추적 |

---

## 함수 (`@oa-sdk/router`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `generateRouter()` | `generate-router.ts` | OAS spec → Hono/Express 라우터 스텁 코드 |

---

## 함수 (`@oa-sdk/client`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `generateClient()` | `generate-client.ts` | OAS spec → fetch 기반 createClient() 코드 |

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
| pascalCase 변환 | 공유 필요 (현재 중복 가능성 있음) | 패키지별 별도 정의 금지 |
