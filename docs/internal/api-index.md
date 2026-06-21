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

## OpenAPI Projection Contract (`@oa-sdk/openapi-projection-contract`)

OA SDK와 bun-graph-db가 각자의 source loader, repository, CLI, MCP, GraphQL, REST, SQLite 구현을 가져오지 않고 공유할 projection 결과 타입.

| Export | 정의 | 용도 |
|------|------|------|
| `OpenApiProjectionResult` | `openapi-projection-contract/src/index.ts` | OpenAPI projection, profile, refs, diagnostics, sources, version hash, type target metadata를 담는 공유 결과 envelope |
| `OpenApiProjectionProfile` | `openapi-projection-contract/src/index.ts` | `component-bundle`, `operation-contract`, `full-api-document` projection 종류 |
| `OPENAPI_PROJECTION_PROFILES` | `openapi-projection-contract/src/index.ts` | 허용되는 projection profile literal 목록 |
| `OPENAPI_PROJECTION_PROFILE_EXTENSION` | `openapi-projection-contract/src/index.ts` | projection profile을 직렬화하는 OpenAPI extension 이름 `x-schema-engine-profile` |
| `OPENAPI_PROJECTION_VERSION_HASH_EXTENSION` | `openapi-projection-contract/src/index.ts` | projection freshness/content hash를 직렬화하는 OpenAPI extension 이름 `x-schema-engine-version-hash` |
| `OPENAPI_PROJECTION_SOURCES_EXTENSION` | `openapi-projection-contract/src/index.ts` | source coordinate map을 직렬화하는 OpenAPI extension 이름 `x-schema-engine-sources` |
| `OPENAPI_PROJECTION_REFS_EXTENSION` | `openapi-projection-contract/src/index.ts` | ref graph edge 목록을 직렬화하는 OpenAPI extension 이름 `x-schema-engine-refs` |
| `OPENAPI_PROJECTION_EXTENSION_NAMES` | `openapi-projection-contract/src/index.ts` | 표준 schema-engine projection metadata OpenAPI extension 이름 tuple |
| `OpenApiProjectionExtensionName` | `openapi-projection-contract/src/index.ts` | 표준 projection metadata extension 이름 union |
| `OpenApiProjectionExtensionFields` | `openapi-projection-contract/src/index.ts` | profile, versionHash, sources, refs를 root-level x-* fields로 직렬화한 shape |
| `OpenApiProjectionDocumentWithExtensions` | `openapi-projection-contract/src/index.ts` | 기존 OpenAPI projection document와 projection metadata extensions를 결합한 타입 |
| `serializeOpenApiProjectionExtensions()` | `openapi-projection-contract/src/index.ts` | projection envelope metadata를 `x-schema-engine-*` extension fields로 복사 직렬화 |
| `attachOpenApiProjectionExtensions()` | `openapi-projection-contract/src/index.ts` | OpenAPI projection document root에 표준 projection metadata extensions를 부착 |
| `OpenApiProjectionProfileSemantics` | `openapi-projection-contract/src/index.ts` | profile별 paths/components/validation 의미를 표현하는 source-agnostic contract |
| `OPENAPI_PROJECTION_PROFILE_SEMANTICS` | `openapi-projection-contract/src/index.ts` | profile별 empty paths, components.schemas, operation requirement, 일반 OpenAPI validation 규칙 |
| `isOpenApiProjectionProfile` | `openapi-projection-contract/src/index.ts` | unknown 값을 runtime에서 `OpenApiProjectionProfile`로 좁히는 type guard |
| `getOpenApiProjectionProfileSemantics` | `openapi-projection-contract/src/index.ts` | 특정 profile의 validation semantics 조회 |
| `validateOpenApiProjection()` | `openapi-projection-contract/src/index.ts` | OpenAPI projection envelope의 구조, profile 요구사항, refs, diagnostics, sources, version hash를 dependency-light 방식으로 검증 |
| `SchemaRefEdge` | `openapi-projection-contract/src/index.ts` | projection artifact 안에서 발견된 ref edge와 source coordinate |
| `SchemaDiagnostic` | `openapi-projection-contract/src/index.ts` | source-aware projection diagnostic |
| `SchemaSourceCoordinate` | `openapi-projection-contract/src/index.ts` | file 또는 DB 기반 source coordinate |
| `SchemaValidateResult` | `openapi-projection-contract/src/index.ts` | projection/value validation 결과 envelope |
| `SchemaTypeTarget` | `openapi-projection-contract/src/index.ts` | projected schema/type output target metadata |

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
| `createSourceLocationIndex()` | `source-location.ts` | YAML/JSON 원문 → JSON Pointer source location index. YAML은 line/column 매핑, JSON은 빈 index fallback |
| `createYamlSourceLocationIndex()` | `source-location.ts` | YAML AST range 기반 JSON Pointer → line/column index 생성 |
| `CANONICAL_DEFINITION_KINDS` | `definition-id.ts` | canonical definition id kind 허용 목록 |
| `COMPONENT_LIKE_DEFINITION_KINDS` | `definition-id.ts` | PascalCase name을 요구하는 component-like kind 목록 |
| `parseDefinitionId()` | `definition-id.ts` | `kind:scope/domain/name` canonical id → DefinitionId 파싱. invalid id는 예외 |
| `validateDefinitionId()` | `definition-id.ts` | 단일 canonical definition id 문법/segment/kind/name 검증 |
| `validateDefinitionIds()` | `definition-id.ts` | canonical definition id 목록 검증 + duplicate id diagnostic 생성 |
| `createDefinitionNode()` | `definition-node.ts` | canonical id에서 kind/scope/domain/localName을 파생하고 fragment source path/pointer/content hash/metadata/refs를 보존 |
| `createDefinitionRef()` | `definition-node.ts` | fragment content 안 source `$ref`의 raw ref와 source path/pointer, optional target canonical id를 보존 |
| `createDefinitionRegistry()` | `definition-registry.ts` | DefinitionNode 목록을 registry graph로 등록하고 canonical/file ref를 canonical id로 정규화하며 duplicate/missing/unsupported/structural duplicate diagnostic, semantic alias, ref edge를 수집 |
| `collectDefinitionRefs()` | `definition-registry.ts` | fragment content를 JSON Pointer-aware traversal로 순회해 `$ref` 위치를 DefinitionRef로 수집 |
| `allocateDefinitionOutputNames()` | `definition-output-names.ts` | 한 target에 포함된 component-like definition node의 output component name을 target-local로 할당하고 alias metadata와 collision report를 생성 |
| `selectDefinitionTarget()` | `definition-target.ts` | target config의 scopes/domains/includePaths로 직접 path를 고르고 registry ref edge를 재귀 순회해 target-local node set과 output name allocation을 생성 |
| `emitDefinitionOpenApiDocument()` | `definition-openapi-emit.ts` | selected target result를 OpenAPI 3.2 document로 materialize하고 rewritten local `$ref`, alias metadata, validation diagnostics를 생성 |
| `toDefinitionOpenApiProjectionResult()` | `definition-openapi-projection.ts` | definition registry, target selection, OpenAPI emit result를 공유 OpenAPI projection envelope로 변환하고 표준 projection extension fields를 문서 root에 부착 |
| `computeDefinitionOpenApiProjectionVersionHash()` | `definition-openapi-projection.ts` | definition projection 입력의 registry content hash, target config, output names, emitted document를 안정 정렬해 version hash 계산 |
| `DEFINITION_PROJECTION_OUTPUT_NAMES_EXTENSION` | `definition-openapi-projection.ts` | adapter가 output name alias metadata를 보존하는 OA SDK 전용 OpenAPI extension 이름 |
| `DEFINITION_PROJECTION_COLLISION_REPORT_EXTENSION` | `definition-openapi-projection.ts` | adapter가 target-local output name collision report metadata를 보존하는 OA SDK 전용 OpenAPI extension 이름 |
| `rewriteDefinitionOutputRefs()` | `definition-output-refs.ts` | registry target id를 사용해 fragment content/refs의 source `$ref`를 표준 OpenAPI component `$ref`로 rewrite |
| `toOpenApiComponentRef()` | `definition-output-refs.ts` | component-like definition node와 output name을 OpenAPI component `$ref` 문자열로 변환 |
| `DEFINITION_OUTPUT_COMPONENT_PATHS` | `definition-output-refs.ts` | definition kind별 OpenAPI component 위치 매핑: schemas/responses/parameters/requestBodies/headers/links/callbacks/securitySchemes |
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
| `RefGraphDiagnostic` | `ref-graph.ts` | ref graph diagnostic 항목. source file/pointer와 YAML line/column metadata 포함 가능 |
| `RefGraphDiagnosticCode` | `ref-graph.ts` | ref graph diagnostic 코드 |
| `RefGraphOptions` | `ref-graph.ts` | ref graph basePath + optional source location lookup 옵션 |
| `RefKind` | `ref-graph.ts` | internal/external/unsupported ref 분류 |
| `SourceLocation` | `source-location.ts` | filePath/pointer/line/column source coordinate |
| `SourceLocationIndex` | `source-location.ts` | pointer lookup과 전체 source location entries 조회 인터페이스 |
| `SourceLocationIndexOptions` | `source-location.ts` | source location index 생성 옵션 (file path, syntax) |
| `SourceLocationSyntax` | `source-location.ts` | source location index 입력 syntax (auto/yaml/json) |
| `CanonicalDefinitionId` | `definition-id.ts` | canonical id 문자열 타입 (`kind:scope/domain/name`) |
| `DefinitionId` | `definition-id.ts` | canonical id의 파싱된 kind/scope/domain/name shape |
| `DefinitionKind` | `definition-id.ts` | canonical definition id kind union |
| `ComponentLikeDefinitionKind` | `definition-id.ts` | PascalCase name을 요구하는 component-like kind union |
| `DefinitionIdDiagnostic` | `definition-id.ts` | canonical id 검증 diagnostic 항목 |
| `DefinitionIdDiagnosticCode` | `definition-id.ts` | canonical id 검증/중복 diagnostic 코드 |
| `DefinitionIdValidationResult` | `definition-id.ts` | 단일 canonical id 검증 결과 |
| `DefinitionIdListValidationResult` | `definition-id.ts` | canonical id 목록 검증 및 duplicate 검출 결과 |
| `DefinitionNode` | `definition-node.ts` | fragment canonical identity, source path/pointer, content hash, content, metadata, refs를 담는 registry 전 단계 node 모델 |
| `DefinitionRef` | `definition-node.ts` | fragment content에서 발견한 source ref와 diagnostics용 source 위치, optional target canonical id |
| `DefinitionMetadata` | `definition-node.ts` | canonical id 계층에 넣지 않는 classification metadata map |
| `CreateDefinitionNodeInput` | `definition-node.ts` | `createDefinitionNode()` 입력 shape |
| `CreateDefinitionRefInput` | `definition-node.ts` | `createDefinitionRef()` 입력 shape |
| `DefinitionRegistry` | `definition-registry.ts` | unique node map, ref edge 목록, semantic alias 목록, registry diagnostic을 담는 definition builder graph |
| `DefinitionRegistryNode` | `definition-registry.ts` | registry에 등록된 DefinitionNode shape |
| `DefinitionRegistryRefEdge` | `definition-registry.ts` | source definition id에서 raw `$ref` source pointer와 optional target canonical id로 이어지는 edge |
| `DefinitionSemanticAlias` | `definition-registry.ts` | explicit semantic alias source/target canonical id와 양쪽 source/content hash metadata |
| `DefinitionRegistryDiagnostic` | `definition-registry.ts` | duplicate canonical id, structural duplicate, missing/unsupported source ref diagnostic. raw ref, source/target path, pointer, line/column 포함 가능 |
| `DefinitionRegistryDiagnosticCode` | `definition-registry.ts` | registry graph diagnostic code union (`duplicate-id`, `structural-duplicate`, `missing-ref`, `unsupported-ref`) |
| `DefinitionRegistryDiagnosticSeverity` | `definition-registry.ts` | registry graph diagnostic severity: error, warning, info |
| `DefinitionRegistryOptions` | `definition-registry.ts` | registry 생성 옵션. source location lookup과 structural duplicate severity 설정 지원 |
| `DefinitionOutputNameMap` | `definition-output-refs.ts` | target-local canonical id → output component name 매핑 |
| `DefinitionOutputAliasMetadata` | `definition-output-names.ts` | canonical id, output name, local/source segments, naming policy reason을 담는 alias metadata |
| `DefinitionOutputNameAllocationOptions` | `definition-output-names.ts` | explicit alias map과 optional targetName을 받는 target-local output name allocation 옵션 |
| `DefinitionOutputNameAllocationResult` | `definition-output-names.ts` | outputNames map, alias metadata array/by-id map, collision report, collision diagnostic을 담는 allocation 결과 |
| `DefinitionOutputNameCollisionReportEntry` | `definition-output-names.ts` | canonicalId, targetName, scope/domain/localName, outputName, reason, severity를 담는 machine-readable naming report row |
| `DefinitionOutputNameDiagnostic` | `definition-output-names.ts` | output component name collision diagnostic |
| `DefinitionOutputNameDiagnosticCode` | `definition-output-names.ts` | output naming diagnostic code union |
| `DefinitionOutputNamePolicyReason` | `definition-output-names.ts` | preserve-if-unique/domain-prefix/explicit-alias policy reason |
| `DefinitionOutputNameReportReason` | `definition-output-names.ts` | naming report reason union. policy reason 또는 output-name-collision |
| `DefinitionOutputNameReportSeverity` | `definition-output-names.ts` | naming report severity union: info, warning, error |
| `DefinitionTargetConfig` | `definition-target.ts` | target bundle config format: name, scopes, domains, servers, includePaths, optional namingPolicy |
| `DefinitionTargetNamingPolicy` | `definition-target.ts` | target-local output naming policy wrapper for explicit aliases |
| `DefinitionTargetSelectionResult` | `definition-target.ts` | selected target node set, direct path ids, selected ref edges, target-local allocation, diagnostics |
| `DefinitionTargetDiagnostic` | `definition-target.ts` | target selection diagnostic for missing include paths and disallowed transitive refs |
| `DefinitionTargetDiagnosticCode` | `definition-target.ts` | target selection diagnostic code union |
| `DefinitionOpenApiEmitOptions` | `definition-openapi-emit.ts` | emitted OpenAPI version/info/jsonSchemaDialect/alias metadata inclusion 옵션 |
| `DefinitionOpenApiEmitResult` | `definition-openapi-emit.ts` | emitted OpenAPI document, sidecar report, validation result, emit diagnostics를 담는 결과 |
| `DefinitionOpenApiEmitReport` | `definition-openapi-emit.ts` | targetName, alias metadata, renamed aliases, collision report, ref rewrite report를 담는 sidecar |
| `DefinitionOpenApiEmitDiagnostic` | `definition-openapi-emit.ts` | target/output-name diagnostics와 emit 자체 diagnostics를 합친 union |
| `DefinitionOpenApiEmitOwnDiagnostic` | `definition-openapi-emit.ts` | missing path, path collision, invalid content, unrewritten ref, validation error diagnostic shape |
| `DefinitionOpenApiEmitDiagnosticCode` | `definition-openapi-emit.ts` | OpenAPI emit diagnostic code union |
| `DefinitionOpenApiProjectionAdapterInput` | `definition-openapi-projection.ts` | registry, selection, emitted result를 함께 받는 adapter 입력 shape |
| `DefinitionOpenApiProjectionAdapterOptions` | `definition-openapi-projection.ts` | version hash forwarding과 source line/column lookup을 지원하는 adapter 옵션 |
| `DefinitionOpenApiProjectionDocument` | `definition-openapi-projection.ts` | emitted OpenAPI document와 표준 projection extensions, OA SDK output naming extensions를 결합한 document type |
| `DefinitionOpenApiProjectionMetadataExtensions` | `definition-openapi-projection.ts` | OA SDK output names와 collision report extension fields shape |
| `DefinitionOpenApiProjectionResult` | `definition-openapi-projection.ts` | full-api-document profile로 변환된 Definition Builder OpenAPI projection envelope |
| `DefinitionOutputRefRewrite` | `definition-output-refs.ts` | source ref, target id, output ref, component path, output name을 담는 rewrite 기록 |
| `DefinitionOutputRefRewriteOptions` | `definition-output-refs.ts` | output name map 또는 resolver를 받는 output ref rewrite 옵션 |
| `DefinitionOutputRefRewriteResult` | `definition-output-refs.ts` | rewritten nodes, nodeById, rewrite 기록, registry diagnostics를 담는 결과 |
| `LintResult` | `lint.ts` | 린트 결과. source file/pointer와 YAML line/column metadata 포함 가능 |
| `LintSeverity` | `lint.ts` | 린트 심각도 |
| `LintOptions` | `lint.ts` | 린트 옵션. basePath와 optional source location lookup 지원 |
| `ValidationResult` | `validate.ts` | 검증 결과 |

---

## 함수 (`@oa-sdk/codegen`)

Typegen 공개 surface는 root entry(`@oa-sdk/codegen`)와 typegen sub-entry(`@oa-sdk/codegen/typegen`)에서 동일하게 지원한다.
지원 subpath는 package exports의 `.`, `./drizzle`, `./spec-lens`, `./typegen`, `./typegen/browser`뿐이며 `typegen/generate-types.ts`와 `typegen/schema-to-ts.ts`는 문서상 코드 위치일 뿐 package deep import로 공개하지 않는다.
`./typegen/browser`는 이미 로드된 OpenAPI 객체를 위한 브라우저 안전 surface이며, 외부 파일 `$ref` 분석과 `basePath` 처리는 Node용 `./typegen`에 남긴다.

| 함수 | 파일 | 용도 |
|------|------|------|
| `zodToSchema()` | `zod-to-schema.ts` | Zod 4 → OAS 3.2 Schema (refs 컨텍스트 지원) |
| `generateComponents()` | `generator.ts` | Zod 맵 → YAML (writeSchemas 위임) |
| `defineConfig()` | `config.ts` | 타입 안전 config 헬퍼 |
| `generateTypes()` | `typegen/generate-types.ts` | ParsedDocument → TS 타입 문자열 (ResponseLinks 포함) |
| `generateTypesFromSpec()` | `typegen/generate-types.ts` | OAS spec → TS 타입 (parseDocument 포함, ResponseLinks 포함) |
| `generateTypes()` / `generateTypesFromSpec()` | `typegen/browser.ts` | 브라우저 안전 typegen. in-memory spec만 처리하고 Node crypto/path/filesystem ref graph를 import하지 않음 |
| `analyzeExternalSchemaRefs()` | `typegen/generate-types.ts` | 외부 schema-position `$ref` 스키마 타입명/충돌 diagnostic 조회 (`#/components/schemas/*`, `#/$defs/*`, 비 components schema root 포함, operation 타입 충돌/unsupported pointer 경고 포함) |
| `schemaToTs()` | `typegen/schema-to-ts.ts` | 단일 OAS Schema → TS 타입 문자열 (SchemaToTsOptions 지원) |
| `createWorkspaceIndex()` | `workspace-index.ts` | 기본 noop 또는 memory WorkspaceIndex 생성 |
| `createNoopWorkspaceIndex()` | `workspace-index.ts` | full rebuild 보존용 no-op WorkspaceIndex 생성 |
| `createMemoryWorkspaceIndex()` | `workspace-index.ts` | 파일 단위 metadata 저장/변경 감지용 in-memory WorkspaceIndex 생성 |
| `createSQLiteWorkspaceIndex()` | `sqlite-workspace-index.ts` | `.oa-cache/state.sqlite` 기반 persistent WorkspaceIndex 생성 |
| `SQLITE_WORKSPACE_INDEX_SCHEMA_VERSION` | `sqlite-workspace-index.ts` | SQLite workspace index schema compatibility version |
| `parseOpenApiCollectProfile()` | `cli/lib/openapi-collect.ts` | undefined → 'generic' default, generic/nestjs-swagger/fastapi 외 값은 supported list와 함께 throw |
| `normalizeOpenApiDocument()` | `cli/lib/openapi-collect.ts` | 외부 OpenAPI 문서를 의미 보존 normalize (noise 제거, stable key/array ordering, YAML anchor 제거) |
| `upgradeOpenApiDocumentTo32()` | `cli/lib/openapi-collect.ts` | normalized OpenAPI 3.0/3.1 문서를 OpenAPI 3.2 분석 artifact로 파생하고 nullable 등 변환 report를 함께 반환 |
| `stringifyOpenApiYaml()` | `cli/lib/openapi-collect.ts` | normalized OpenAPI 문서를 YAML anchor 없이 stable한 YAML 문자열로 직렬화 |
| `createOpenApiCollectReport()` | `cli/lib/openapi-collect.ts` | profile/raw/normalized/upgraded 경로와 upgrade report를 묶은 collect report payload 생성 |
| `exportOpenApiToTypeSpec()` | `cli/lib/tsp-export.ts` | OpenAPI artifact를 TypeSpec spike source와 diagnostics report로 변환. schema/property docs, defaults, examples, deprecated, strict-object sealing, tag metadata, response headers, bearer auth를 TypeSpec source에 반영 |
| `createOpenApiGovernanceInterface()` | `cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스용 artifact interface(`oa-gen.openapi-governance.v1`) payload 생성 |
| `scaffoldOpenApiGovernance()` | `cli/lib/openapi-governance-scaffold.ts` | 서비스 root에 `openapi-governance.config.json`, `scripts/openapi-governance.sh`, `openapi-governance.md`와 contracts/scripts/src 디렉토리를 생성 |
| `formatScaffoldResult()` | `cli/lib/openapi-governance-scaffold.ts` | scaffold 결과의 root 디렉토리와 생성 파일 목록을 사용자 친화 텍스트로 렌더링 |
| `fingerprintGovernanceConfig()` | `cli/lib/openapi-governance-scaffold.ts` | profile/source/artifacts/consumers를 안정 정렬 후 sha256 16자로 해시. rendered 스크립트와 config drift 감지에 사용 |

### 타입 (`@oa-sdk/codegen`)

| 타입 | 파일 | 용도 |
|------|------|------|
| `OutputOptions` | `types.ts` | YAML 출력 옵션 (output, grouping, merge) |
| `NamedSchema` | `types.ts` | `{ name, schema }` — writer 입력 |
| `CodegenResult` | `types.ts` | `{ components, files, warnings }` |
| `CodegenConfig` | `config.ts` | `OutputOptions & { schemas }` |
| `DrizzleCodegenOptions` | `drizzle/index.ts` | `OutputOptions & { schemaPath, ... }` |
| `OasSchema` | **`@oa-sdk/parser` re-export** | codegen이 parser 정식 타입 사용 |
| `TypegenOptions` | `typegen/generate-types.ts` | public typegen 옵션. `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen`에서 모두 export |
| TypegenOptions | `typegen/browser.ts` | 브라우저 안전 subentry의 typegen 옵션. banner/style/includeAnnotations/refNameOverrides만 지원하며 basePath 외부 ref 분석 옵션은 포함하지 않음 |
| `SchemaToTsOptions` | `typegen/schema-to-ts.ts` | public `schemaToTs()` 옵션. `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen`에서 모두 export |
| `ExternalSchemaRefAnalysis` | `typegen/generate-types.ts` | 외부 schema-position `$ref` alias 분석 결과 |
| `ExternalSchemaTypeAlias` | `typegen/generate-types.ts` | 외부 schema alias의 source pointer/ref/type name/content hash metadata |
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
| `SqliteDriverName` | `sqlite-workspace-index.ts` | persistent index backend 이름 (`node:sqlite` primary, `better-sqlite3` fallback) |
| `OpenApiCollectProfile` | `cli/lib/openapi-collect.ts` | 외부 OpenAPI collect/normalize/scaffold profile union (generic \| nestjs-swagger \| fastapi) |
| `OpenApiTransformWarning` | `cli/lib/openapi-collect.ts` | collect/upgrade pipeline의 pointer-aware 변환/경고 항목 |
| `OpenApiUpgradeReport` | `cli/lib/openapi-collect.ts` | OpenAPI 3.0/3.1 → 3.2 변환 report. source/target version과 conversion/warning 목록 포함 |
| `OpenApiCollectReport` | `cli/lib/openapi-collect.ts` | collect command가 기록하는 raw/normalized/upgraded 경로와 upgrade report 묶음 |
| `TspExportOptions` | `cli/lib/tsp-export.ts` | TypeSpec export namespace 옵션 |
| `TspExportResult` | `cli/lib/tsp-export.ts` | 생성된 TypeSpec source, diagnostics report, diagnostics 목록 |
| `TspExportReport` | `cli/lib/tsp-export.ts` | `oa-gen.tsp-export-report.v1` report payload. counts와 warning diagnostics를 포함 |
| `TspExportDiagnostic` | `cli/lib/tsp-export.ts` | TypeSpec export 중 의미 손실 또는 미구현 mapping을 기록하는 warning diagnostic |
| `TspExportDiagnosticSeverity` | `cli/lib/tsp-export.ts` | 현재 TypeSpec export diagnostic severity union |
| `OpenApiGovernanceInterface` | `cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스용 artifact interface(`oa-gen.openapi-governance.v1`) payload 타입 |
| `OpenApiGovernanceScaffoldOptions` | `cli/lib/openapi-governance-scaffold.ts` | scaffold root/service/profile/source-command/runtime URL/force overwrite 옵션 |
| `OpenApiGovernanceScaffoldResult` | `cli/lib/openapi-governance-scaffold.ts` | scaffold 결과의 rootDir와 생성된 파일 절대 경로 목록 |

### 내부 함수 (`@oa-sdk/codegen` — index 미노출)

| 함수 | 파일 | 용도 |
|------|------|------|
| `generateFromDrizzle()` | `drizzle/index.ts` | Drizzle 파일 → YAML |
| `writeSchemas()` | `writer.ts` | NamedSchema[] → YAML 파일 |
| `mergeIntoSpec()` | `spec-merge.ts` | spec.yaml에 schemas 병합 |
| `analyzeDefinitionDuplicateReview()` | `cli/lib/duplicate-review.ts` | Definition fragments에서 duplicate canonical id, same content hash, same local name/different shape, output collision, semantic alias finding을 수집 |
| `formatDefinitionDuplicateReviewMarkdown()` | `cli/lib/duplicate-review.ts` | duplicate-review 결과를 PR comment용 compact Markdown으로 렌더링 |
| `checkTargetCoverage()` | `cli/lib/target-coverage.ts` | generated OpenAPI artifact 또는 Definition Builder target materialization 결과의 emitted `paths` key에 include/exclude assertion을 적용 |
| `formatTargetCoverageMarkdown()` | `cli/lib/target-coverage.ts` | target-check assertion result와 failure를 compact Markdown report로 렌더링 |
| `createArtifactReview()` | `cli/lib/artifact-review.ts` | artifact freshness report 생성과 skipped fallback을 CLI orchestration 관점에서 통합 |
| `createBehaviorRecord()` | `cli/lib/behavior-recorder.ts` | append-only behavior entity payload를 schemaVersion/behaviorId/status와 함께 생성 |
| `createBehaviorIdentityKey()` | `cli/lib/behavior-recorder.ts` | behaviorType과 deterministic parts로 상태 전이/최신 projection 기준 identity key를 생성 |
| `getBehaviorTypeDefinition()` | `cli/lib/behavior-registry.ts` | behavior type별 input/target/decision/result schema, identity builder, projection policy 선언을 조회 |
| `readBehaviorComponentSchemas()` | `cli/lib/behavior-registry.ts` | behavior type별 input/target/decision/result schema set을 반환 |
| `readBehaviorProjectionPolicy()` | `cli/lib/behavior-registry.ts` | behavior type별 projection snapshot policy를 계산 |
| `resolveBehaviorIdentityParts()` | `cli/lib/behavior-registry.ts` | behavior type registry 기반으로 identity key parts를 계산 |
| `validateBehaviorRegistryComponents()` | `cli/lib/behavior-registry.ts` | behavior type registry 기반 cross-component semantic rule을 검증 |
| `createBehaviorRecorder()` | `cli/lib/behavior-recorder.ts` | 하위 호환용 recorder factory. file path를 JSONL adapter로 연결 |
| `createBehaviorRecorderFromOptions()` | `cli/lib/behavior-recorder.ts` | noop, JSONL, SQLite adapter 중 하나를 선택해 behavior recorder를 생성 |
| `createSqliteBehaviorRecorder()` | `cli/lib/behavior-recorder.ts` | append-only `behavior_records` table을 사용하는 SQLite recorder adapter를 생성 |
| `createMemoryBehaviorRecorder()` | `cli/lib/behavior-recorder.ts` | 테스트/향후 orchestration용 in-memory behavior recorder adapter를 생성 |
| `validateBehaviorRecord()` | `cli/lib/behavior-recorder.ts` | behavior record schema를 검증하고 path/message issue 목록을 반환 |
| `assertValidBehaviorRecord()` | `cli/lib/behavior-recorder.ts` | invalid behavior record를 예외로 차단 |
| `isAllowedBehaviorStatusTransition()` | `cli/lib/behavior-recorder.ts` | documented lifecycle transition 허용 여부를 판단 |
| `assertBehaviorStatusTransition()` | `cli/lib/behavior-recorder.ts` | invalid lifecycle transition을 예외로 차단 |
| `createSqliteBehaviorProjectionReader()` | `cli/lib/behavior-projection.ts` | `behavior_records`/`behavior_projections`에서 recent/latest-by-type/latest-by-identity/latest-by-target/latest-by-decision-signal/latest-failure/latest-by-recommendation read projection과 full raw listing을 제공 |
| `queryBehavior()` | `cli/lib/behavior-query.ts` | behavior projection reader를 mode selector + exact-match filters(`behaviorType`/`identityKey`/`targetType`/`targetKey`/`decisionSignal`/`recommendation`/`status`) 기반 JSON report로 변환하고 summary-by-* 및 composite aggregation bucket(`behavior+status`, `behavior+decision`)을 계산 |
| `formatBehaviorQueryMarkdown()` | `cli/lib/behavior-query.ts` | behavior projection query result를 filter summary와 decision signal column을 포함한 Markdown table로 렌더링하고 aggregation mode에서는 dimensions column을 함께 출력 |
| `createReviewBundle()` | `cli/lib/review-bundle.ts` | base/head diff, artifact freshness, optional runtime drift, provenance diff, inventory, composition, metadata registry, duplicate review payload를 PR review bundle로 집계 |
| `formatReviewBundleMarkdown()` | `cli/lib/review-bundle.ts` | recommendation과 summary로 시작하고 breaking changes를 non-breaking changes보다 먼저 두는 review-bundle Markdown report를 렌더링 |
| `createReviewReport()` | `cli/lib/review-report.ts` | review command의 JSON report model과 summary/recommendation/reasons 계산을 조립 |
| `formatReviewReportMarkdown()` | `cli/lib/review-report.ts` | review command의 Markdown report를 공통 renderer 기준으로 렌더링 |
| `createReviewBehaviorResult()` | `cli/lib/review-behavior-result.ts` | review report를 behavior result payload shape로 변환 |
| `createReviewBundleBehaviorResult()` | `cli/lib/review-behavior-result.ts` | review-bundle summary를 behavior result payload shape로 변환 |
| `createReviewBehaviorReasonFields()` | `cli/lib/review-behavior-result.ts` | review/review-bundle 공통 recommendation + reasons slice를 behavior result shape로 변환 |
| `createReviewBehaviorDiffFields()` | `cli/lib/review-behavior-result.ts` | breaking/non-breaking count slice를 behavior result shape로 변환 |
| `createReviewValidationFields()` | `cli/lib/review-behavior-result.ts` | review validation count slice를 behavior result shape로 변환 |
| `createReviewCheckedState()` | `cli/lib/review-behavior-result.ts` | review artifact/provenance/metadata checked state slice를 behavior result shape로 변환 |
| `createReviewBundleIncludedState()` | `cli/lib/review-behavior-result.ts` | review-bundle artifact/runtime/inventory/composition/metadata/duplicate include/checked state slice를 behavior result shape로 변환 |
| `recommendationDecisionSignal()` | `cli/lib/review-behavior-result.ts` | APPROVE/COMMENT/REQUEST_CHANGES를 behavior decision signal로 매핑 |
| `recommendationDecisionReason()` | `cli/lib/review-behavior-result.ts` | review recommendation별 decision reason 문구를 반환 |
| `bundleRecommendationDecisionReason()` | `cli/lib/review-behavior-result.ts` | review-bundle recommendation별 decision reason 문구를 반환 |
| `validateBuildOpenApiTargetComponents()` | `cli/lib/build-runtime-behavior-validation.ts` | build_openapi_target semantic validator. target/input path, targetKey, decision/result consistency를 검증 |
| `validateSyncRuntimeOpenApiComponents()` | `cli/lib/build-runtime-behavior-validation.ts` | sync_runtime_openapi semantic validator. target/input path, targetKey, runtime source, decision/result consistency를 검증 |
| `validateReviewBehaviorComponents()` | `cli/lib/review-behavior-validation.ts` | review/review-bundle 공통 semantic validator. recommendation/reasons/sidecar checked state 일관성을 검증 |
| `issue()` | `cli/lib/behavior-validation-utils.ts` | behavior validator issue helper |
| `readDecisionSignal()` | `cli/lib/behavior-validation-utils.ts` | behavior decision component에서 primarySignal을 읽는다 |
| `readString()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 string으로 읽는다 |
| `readBoolean()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 boolean으로 읽는다 |
| `readNullableBoolean()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 nullable boolean으로 읽는다 |
| `readNumber()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 number로 읽는다 |
| `readStringArray()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 string array로 읽는다 |
| `readNullableNumber()` | `cli/lib/behavior-validation-utils.ts` | behavior component field를 nullable number로 읽는다 |
| `readSidecarPairState()` | `cli/lib/behavior-validation-utils.ts` | base/head sidecar pair의 none/partial/complete 상태를 계산한다 |
| `validateSameStringField()` | `cli/lib/behavior-validation-utils.ts` | input/target 같은 이름 field의 cross-field equality를 검증한다 |
| `validateCrossStringField()` | `cli/lib/behavior-validation-utils.ts` | 임의 component pair의 string field equality를 검증한다 |
| `validateReviewBehaviorComponents()` | `cli/lib/review-behavior-validation.ts` | review/review-bundle 공통 semantic validator. recommendation/reasons/sidecar checked state 일관성을 검증 |
| `createProvenanceDiffReview()` | `cli/lib/review-sidecar-diff.ts` | base/head provenance sidecar diff summary를 checked/changed/summary shape로 정규화 |
| `createMetadataRegistryDiffReview()` | `cli/lib/review-sidecar-diff.ts` | base/head metadata registry sidecar diff summary를 checked/changed/summary shape로 정규화 |
| `recommendReviewOutcome()` | `cli/lib/review-policy.ts` | review/review-bundle 공통 APPROVE/COMMENT/REQUEST_CHANGES 결정 helper |
| `formatChangeLines()` | `cli/lib/review-markdown.ts` | review/review-bundle 공통 change list Markdown renderer |
| `formatArtifactFreshnessLines()` | `cli/lib/review-markdown.ts` | artifact freshness section Markdown renderer |
| `formatSidecarDiffLines()` | `cli/lib/review-markdown.ts` | provenance/metadata sidecar diff table Markdown renderer |
| `collectOpenApiDocumentSourceFragments()` | `cli/lib/openapi-source-fragments.ts` | OpenAPI `paths`/`webhooks`/`components` sections를 normalized source fragments와 pointer diagnostics issue로 수집 |
| `adaptZodSchemas()` | `cli/lib/source-adapters.ts` | Zod schema map을 기존 `zodToSchema()` 경로로 OpenAPI schema source fragments에 매핑 |
| `adaptDrizzleTables()` | `cli/lib/source-adapters.ts` | Drizzle extracted table 목록을 기존 `convertTables()` 경로로 select/insert/update schema source fragments에 매핑 |
| `adaptOpenApiProjectionEnvelope()` | `cli/lib/source-adapters.ts` | `OpenApiProjectionResult` envelope의 projection document와 profile/versionHash/sources/refs/typeTargets metadata를 source fragments로 보존 |
| `adaptPythonContractSpecSnapshot()` | `cli/lib/source-adapters.ts` | Python `ContractSpec` 또는 `oa-contract-snapshot` JSON mapping을 Python runtime 없이 schema/operation/response/security/example/target fragments로 매핑 |

---

## CLI (`oa-gen`)

| Command | 구현 | 용도 |
|------|------|------|
| `build-spec` | `packages/codegen/src/cli/commands/build-spec.ts`, `packages/codegen/src/cli/lib/build-spec.ts`, `packages/codegen/src/cli/lib/composition-report.ts`, `packages/codegen/src/cli/lib/provenance-report.ts`, `packages/codegen/src/cli/lib/metadata-registry.ts`, `packages/codegen/src/cli/lib/behavior-recorder.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | Definition Builder target config와 fragments에서 OpenAPI artifact를 생성하고 diagnostics, collision report, composition report, provenance sidecar, metadata registry sidecar를 출력하며 선택적으로 behavior JSONL/SQLite record를 append한다 |
| `behavior-query` | `packages/codegen/src/cli/commands/behavior-query.ts`, `packages/codegen/src/cli/lib/behavior-query.ts`, `packages/codegen/src/cli/lib/behavior-projection.ts` | behavior SQLite projection을 filtered recent/latest-by-type/latest-failure-by-type/latest-by-identity/latest-by-target/latest-by-decision-signal/latest-by-recommendation 및 summary-by-type/status/target-type/behavior-status/behavior-decision-signal/decision-signal/recommendation 모드로 조회하며 `decision-signal` exact-match filter를 지원한다 |
| `check-artifact` | `packages/codegen/src/cli/commands/check-artifact.ts`, `packages/codegen/src/cli/lib/artifact-freshness.ts`, `packages/codegen/src/cli/lib/artifact-review.ts` | generated OpenAPI artifact freshness 확인 |
| `collect` | `packages/codegen/src/cli/commands/collect.ts`, `packages/codegen/src/cli/lib/openapi-collect.ts` | 외부 OpenAPI 산출물을 raw로 보존하고 stable governance용 normalized artifact와 OpenAPI 3.2 analysis용 upgraded artifact, collect report를 생성한다 |
| `duplicate-review` | `packages/codegen/src/cli/commands/duplicate-review.ts`, `packages/codegen/src/cli/lib/duplicate-review.ts` | Definition fragments duplicate identity risk를 `markdown` 또는 `json`으로 보고하고 error severity finding에서만 non-zero 종료 |
| `drift` | `packages/codegen/src/cli/commands/drift.ts`, `packages/codegen/src/cli/lib/behavior-recorder.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | managed OpenAPI 파일과 runtime OpenAPI 파일 또는 URL을 비교하고 URL fetch/HTTP/parse 실패를 `drift-check-failed`로 보고하며 선택적으로 behavior JSONL/SQLite record를 append한다 |
| `inventory` | `packages/codegen/src/cli/commands/inventory.ts` + `packages/codegen/src/cli/lib/openapi-inventory.ts` | OpenAPI YAML/JSON 또는 Definition Builder target artifact에서 path/operation/component count, tag/domain grouping, security scheme usage, projection source metadata, unused component candidates를 `markdown` 또는 `json`으로 보고 |
| `normalize` | `packages/codegen/src/cli/commands/normalize.ts`, `packages/codegen/src/cli/lib/openapi-collect.ts` | 외부 OpenAPI 산출물의 의미를 바꾸지 않고 noise 제거, stable ordering, YAML anchor 제거를 적용해 diff 가능한 governance artifact를 생성한다 |
| `review` | `packages/codegen/src/cli/commands/review.ts`, `packages/codegen/src/cli/lib/review-report.ts`, `packages/codegen/src/cli/lib/artifact-review.ts`, `packages/codegen/src/cli/lib/review-sidecar-diff.ts`, `packages/codegen/src/cli/lib/review-markdown.ts`, `packages/codegen/src/cli/lib/review-policy.ts`, `packages/codegen/src/cli/lib/provenance-report.ts`, `packages/codegen/src/cli/lib/metadata-registry.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | base/head OpenAPI diff, validation, artifact freshness를 묶고 선택적으로 base/head provenance sidecar와 metadata registry sidecar 변경 entries를 report에 포함 |
| `review-bundle` | `packages/codegen/src/cli/commands/review-bundle.ts`, `packages/codegen/src/cli/lib/review-bundle.ts`, `packages/codegen/src/cli/lib/artifact-review.ts`, `packages/codegen/src/cli/lib/review-sidecar-diff.ts`, `packages/codegen/src/cli/lib/review-markdown.ts`, `packages/codegen/src/cli/lib/review-policy.ts`, `packages/codegen/src/cli/lib/provenance-report.ts`, `packages/codegen/src/cli/lib/metadata-registry.ts`, `packages/codegen/src/cli/lib/behavior-recorder.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | base/head OpenAPI diff와 artifact freshness를 필수 section으로 묶고 선택적으로 inventory, runtime drift JSON, provenance diff, composition report JSON, metadata registry JSON, metadata registry diff, duplicate-review JSON을 stable nested section으로 포함하며 behavior JSONL/SQLite record를 append할 수 있다 |
| `scaffold-governance` | `packages/codegen/src/cli/commands/scaffold-governance.ts`, `packages/codegen/src/cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스 루트에 `openapi-governance.config.json`, `scripts/openapi-governance.sh`, `openapi-governance.md`를 생성해 oa-sdk 기능별 artifact interface를 표준화한다 |
| `target-check` | `packages/codegen/src/cli/commands/target-check.ts`, `packages/codegen/src/cli/lib/target-coverage.ts` | Definition Builder target config 또는 generated OpenAPI artifact의 emitted path surface를 include/exclude assertion으로 검증하고 실패 시 non-zero 종료 |
| `tsp-export` | `packages/codegen/src/cli/commands/tsp-export.ts`, `packages/codegen/src/cli/lib/tsp-export.ts`, `packages/codegen/src/cli/lib/typespec-sidecar.ts` | OpenAPI YAML/JSON artifact를 TypeSpec spike source, diagnostics JSON, optional OA SDK compatibility sidecar로 변환 |
| `tsp-restore` | `packages/codegen/src/cli/commands/tsp-restore.ts`, `packages/codegen/src/cli/lib/typespec-sidecar.ts` | TypeSpec emitted OpenAPI artifact에 OA SDK compatibility sidecar를 재적용하고 restore report를 출력 |
| `upgrade` | `packages/codegen/src/cli/commands/upgrade.ts`, `packages/codegen/src/cli/lib/openapi-collect.ts` | normalized OpenAPI 3.0/3.1 artifact를 OpenAPI 3.2 analysis artifact로 파생하고 nullable 등 표현 변환 report를 남긴다 |

Governance manifest: `packages/codegen/src/cli/spec/oa-gen-governance.ts` 및 `docs/cli-spec/oa-gen.governance.json`.

---

## 어댑터 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `createMswHandlers()` | `adapters/msw.ts` | MSW 2.x 핸들러 배열 생성 |
| `createMswMockServer()` | `adapters/msw.ts` | MSW 핸들러 + override API 통합 |
| `MswHandlerOptions` | `adapters/msw.ts` | MSW 옵션 타입 (request hook, route filter, request schema preflight, callback hook) |
| `MswMockServer` | `adapters/msw.ts` | MSW mock 서버 타입 (handlers + override) |
| `createNodeMockServer()` | `adapters/node-http.ts` | Node HTTP 목 서버 생성 |
| `NodeMockServer` | `adapters/node-http.ts` | Node 서버 인스턴스 타입 (override 포함) |
| `NodeMockServerOptions` | `adapters/node-http.ts` | Node 서버 옵션 타입 (port/host, server variables, route filter, request schema preflight, callback hook) |
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
| `pickResponse()` | `core/response-picker.ts` | 응답 선택 (6단계 폴백) + Link metadata 추출 |
| `PickedResponse` | `core/response-picker.ts` | 선택된 응답 타입 (status/body/schema/headers/links/stream) |
| `CallbackObserver` | `core/callbacks.ts` | simulated outbound callback POST attempt 관찰 hook 타입 |
| `CallbackPostAttempt` | `core/callbacks.ts` | callbackName/expression/url/body/error를 포함한 simulated POST attempt metadata |
| `CallbackSimulationError` | `core/callbacks.ts` | callback URL expression 평가 실패 metadata |
| `CallbackSimulationErrorCode` | `core/callbacks.ts` | callback expression unsupported/unresolved/invalid URL 코드 |

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
| `createCallbackTracker()` | `testing.ts` | simulated outbound callback POST attempt 추적 |
| `TestClient` | `testing.ts` | 테스트 클라이언트 타입 |
| `TestResponse` | `testing.ts` | 테스트 응답 타입 |
| `CoverageTracker` | `testing.ts` | 커버리지 추적기 타입 |
| `CallbackTracker` | `testing.ts` | callback attempt 추적기 타입 |

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
| `generateClient()` | `generate-client.ts` | OAS spec → fetch 기반 createClient() 코드. 기본 operation 메서드는 body 반환을 유지하고, 문서화된 응답 헤더가 있으면 generated typed response object를 반환하는 `withResponse.<operation>()` helper를 함께 생성 |
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
