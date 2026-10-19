# API Index — 기능별 단일 소스 매핑

> 동일 목적의 기능이 재구현되지 않도록 관리합니다.
> 새 기능 추가 시 이 인덱스를 먼저 확인하세요.

`pnpm check:api-index`는 빌드 없이 최신 TypeScript 소스를 실행한다. 검사 범위는
[release policy](./release-policy.json)의 releaseTracked·distributionCandidates와 기존 DPM이다.
각 패키지의 root export가 `dist/index.js`·`dist/index.d.ts`를 가리키는지 확인하고,
`src/index.ts`에서 AST로 공개 이름을 추출하여 정확히 같은 패키지 문서와 비교한다.
다른 root entrypoint를 도입할 때는 검사기의 source mapping도 명시적으로 변경한다.
`schemas`는 symbol 대신 manifest의 JSON/YAML asset export를 검사한다. 일반 subpath 전체를
검사하는 gate는 아니며 codegen/typegen의 공유 옵션 두 타입은 별도 호환성 규칙으로 확인한다.
`pnpm test:api-index`는 누락·고아 export, async·alias·주석 파싱, 패키지 구분, inventory 변경과
읽을 수 없는 진입점에 대한 회귀 검사다. CI에서 gate와 함께 실행한다.

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
| `RefProjection` | `parser/src/ref-projection.ts` | ref 해결 그래프의 노드·엣지·진단 projection. 엣지가 없는 `$ref` occurrence는 모두 진단이 가리킨다 |
| `RefProjectionNode` | `parser/src/ref-projection.ts` | projection 그래프의 노드 표현 |
| `RefProjectionEdge` | `parser/src/ref-projection.ts` | projection 그래프의 edge 표현 |
| `RefProjectionNodeKind` | `parser/src/ref-projection.ts` | projection 노드 종류 분류 |
| `RefProjectionRecursion` | `parser/src/ref-projection.ts` | projection에서 발견된 순환 구조 표현 |
| `RefProjectionDiagnostic` | `parser/src/ref-projection.ts` | projection 진단: resolver의 `RefGraphDiagnostic` 또는 `RefProjectionOutsideNodesDiagnostic` |
| `RefProjectionDiagnosticCode` | `parser/src/ref-projection.ts` | `RefGraphDiagnosticCode`와 `ref-source-outside-nodes` / `ref-target-outside-nodes` |
| `RefProjectionOutsideNodesDiagnostic` | `parser/src/ref-projection.ts` | occurrence나 참조 대상이 어떤 노드에도 속하지 않아 엣지가 없는 해결된 `$ref` occurrence. 노드 밖에 있는 끝마다 하나 |
| `projectRefGraph` | `parser/src/ref-projection.ts` | 선언·외부 참조 대상을 노드로, 양 끝이 노드 안에 있는 해결된 `$ref` occurrence를 엣지로 projection 생성. 나머지 occurrence는 resolver 진단 또는 `ref-*-outside-nodes` 진단으로 보고 |

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
| `projectDiscriminatedUnion()` | `openapi-projection-contract/src/discriminated-union.ts` | 다형성 스키마 및 RPC/MCP 요청을 정규 OpenAPI 3.1 discriminator + oneOf 구조로 투영 |
| `projectDiscriminatedUnionDocument()` | `openapi-projection-contract/src/discriminated-union.ts` | 투영된 판별 유니온 스키마와 경로를 완전한 OpenAPI projection document envelope으로 생성 |
| `DiscriminatedUnionProjectionOptions` | `openapi-projection-contract/src/discriminated-union.ts` | 판별 유니온 투영 옵션 (discriminatorProperty, unionSchemaId, variants, pathPrefix 등) |
| `DiscriminatedUnionProjectionResult` | `openapi-projection-contract/src/discriminated-union.ts` | 투영된 root unionSchema, variantSchemas, optional operation paths 결과 |
| `DiscriminatedUnionDocumentOptions` | `openapi-projection-contract/src/discriminated-union.ts` | 판별 유니온 문서 생성 옵션 (info, title, version, openapiVersion 포함) |
| `OPENAPI_SURFACE_ANCHOR_EXTENSION` | `openapi-projection-contract/src/surface-extensions.ts` | 소스 앵커 메타데이터 OpenAPI extension 이름 `x-surface-anchor` |
| `OPENAPI_SURFACE_PARAM_RANGE_EXTENSION` | `openapi-projection-contract/src/surface-extensions.ts` | 파라미터 텍스트 범위 메타데이터 OpenAPI extension 이름 `x-surface-param-range` |
| `OPENAPI_SURFACE_FINGERPRINT_EXTENSION` | `openapi-projection-contract/src/surface-extensions.ts` | 서피스 핑거프린트 OpenAPI extension 이름 `x-surface-fingerprint` |
| `OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION` | `openapi-projection-contract/src/surface-extensions.ts` | 따옴표 스타일 메타데이터 OpenAPI extension 이름 `x-surface-quote-style` |
| `OPENAPI_SURFACE_PATCH_POLICY_EXTENSION` | `openapi-projection-contract/src/surface-extensions.ts` | 패치 정책 메타데이터 OpenAPI extension 이름 `x-surface-patch-policy` |
| `OPENAPI_SURFACE_EXTENSION_NAMES` | `openapi-projection-contract/src/surface-extensions.ts` | OpenAPI 서피스 메타데이터 extension 이름 tuple |
| `OpenApiSurfaceExtensionName` | `openapi-projection-contract/src/surface-extensions.ts` | OpenAPI 서피스 메타데이터 extension 이름 union |
| `SURFACE_QUOTE_STYLES` | `openapi-projection-contract/src/surface-extensions.ts` | 지원하는 따옴표 스타일 목록 ('single', 'double', 'backtick', 'none') |
| `SurfaceQuoteStyle` | `openapi-projection-contract/src/surface-extensions.ts` | 따옴표 스타일 literal union |
| `SURFACE_PATCH_POLICY_ON_DRIFT_VALUES` | `openapi-projection-contract/src/surface-extensions.ts` | 드리프트 발생 시 패치 정책 목록 ('abort', 'rebase', 'force') |
| `SurfacePatchPolicyOnDrift` | `openapi-projection-contract/src/surface-extensions.ts` | 드리프트 발생 시 패치 정책 union |
| `SurfaceAnchorMetadata` | `openapi-projection-contract/src/surface-extensions.ts` | 소스 라인/컬럼 위치 및 식별자 메타데이터 인터페이스 |
| `SurfaceParamRangeMetadata` | `openapi-projection-contract/src/surface-extensions.ts` | 텍스트 오프셋 시작/종료 범위 및 라이브 패치 지원 메타데이터 |
| `SurfacePatchPolicyMetadata` | `openapi-projection-contract/src/surface-extensions.ts` | 드리프트 처리 정책 및 재시도 한도 메타데이터 |
| `SurfaceExtensionFields` | `openapi-projection-contract/src/surface-extensions.ts` | OpenAPI 스펙 루트 또는 작업에 부착되는 서피스 확장 필드 모음 |
| `isOpenApiSurfaceExtensionName()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 정규 서피스 확장명인지 판별하는 타입 가드 |
| `isSurfaceQuoteStyle()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 유효한 SurfaceQuoteStyle인지 판별하는 타입 가드 |
| `isSurfaceFingerprint()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 SHA-256 형식 핑거프린트인지 검증하는 타입 가드 |
| `isSurfaceAnchorMetadata()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 SurfaceAnchorMetadata 구조인지 검증하는 타입 가드 |
| `isSurfaceParamRangeMetadata()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 SurfaceParamRangeMetadata 구조인지 검증하는 타입 가드 |
| `isSurfacePatchPolicyMetadata()` | `openapi-projection-contract/src/surface-extensions.ts` | unknown 값이 SurfacePatchPolicyMetadata 구조인지 검증하는 타입 가드 |

---

## Spec Lens HTTP Wire Contract (`@oa-sdk/spec-lens-contract`)

Backend HTTP adapter와 browser UI가 공유하는 의존성이 적은 wire 계약이다. UI는 별도 응답 모델 대신 이 타입과 runtime guard를 소비한다.

| Export | 정의 | 용도 |
|---|---|---|
| `SPEC_LENS_SNAPSHOT_SCHEMA_VERSION`, `SPEC_LENS_DIFF_SCHEMA_VERSION`, `SPEC_LENS_COMPOSITION_REPORT_SCHEMA_VERSION` | `spec-lens-contract/src/index.ts` | snapshot·diff·composition wire 버전 |
| `SPEC_LENS_TYPESPEC_COMPILE_EVIDENCE_SCHEMA_VERSION`, `SPEC_LENS_TYPESPEC_TOOLCHAIN_EVIDENCE_SCHEMA_VERSION`, `SPEC_LENS_TYPESPEC_SOURCE_READ_BUDGET_SCHEMA_VERSION` | `spec-lens-contract/src/index.ts` | TypeSpec compile·toolchain·source budget evidence 버전 |
| `SPEC_LENS_TYPESPEC_MANIFEST_SCHEMA_VERSION`, `SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION`, `SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION` | `spec-lens-contract/src/index.ts` | TypeSpec manifest·restore·isolation 계약 버전 |
| `SPEC_LENS_PROJECT_KINDS`, `SPEC_LENS_SOURCE_KINDS`, `SpecLensProjectKind`, `SpecSourceKind`, `SpecDefinitionKind`, `SpecCanonicalDefinitionId` | `spec-lens-contract/src/index.ts` | project·source·definition 종류와 canonical ID |
| `SpecRevision`, `SpecFileEntry`, `SpecSnapshotDiagnostic` | `spec-lens-contract/src/index.ts` | revision·파일 entry·snapshot 진단 |
| `SpecCompositionOutputPath`, `SpecCompositionOutputComponent`, `SpecCompositionAlias`, `SpecCompositionCollision`, `SpecCompositionSourceRef`, `SpecCompositionReport` | `spec-lens-contract/src/index.ts` | composition 출력 path·component·alias·collision·참조·report |
| `SpecProvenanceEntry`, `SpecProvenanceMap`, `SpecProvenanceDiffEntry` | `spec-lens-contract/src/index.ts` | provenance entry·map·diff |
| `SpecLensTypeSpecSourceReadBudget`, `SpecLensTypeSpecToolchainEvidence`, `SpecLensTypeSpecCompileEvidence`, `SpecLensObservedInputEvidence` | `spec-lens-contract/src/index.ts` | TypeSpec source budget·toolchain·compile·관측 입력 evidence |
| `SpecSnapshotBase`, `DefinitionBuilderSpecSnapshot`, `TypeSpecBundleSpecSnapshot`, `SpecSnapshot` | `spec-lens-contract/src/index.ts` | project kind별 snapshot과 공통 base |
| `SpecDiffEntry`, `SpecBreakingChange`, `DiffEntry`, `BreakingChange`, `ProvenanceEntry`, `ProvenanceDiffEntry` | `spec-lens-contract/src/index.ts` | 정규 diff·breaking change와 호환 별칭 |
| `SpecTimelineDiffBase`, `DefinitionBuilderSpecTimelineDiff`, `TypeSpecBundleSpecTimelineDiff`, `SpecTimelineDiff`, `SpecTimelineEntry` | `spec-lens-contract/src/index.ts` | project kind별 timeline diff와 timeline entry |
| `SpecPathEntry`, `SpecPathsResult`, `SpecGraphNode`, `SpecGraphEdge`, `SpecGraph` | `spec-lens-contract/src/index.ts` | path 결과 및 dependency graph |
| `RefreshResult`, `ClearCacheResult` | `spec-lens-contract/src/index.ts` | refresh와 cache 삭제 결과 |
| `DefinitionBuilderServerConfig`, `TypeSpecBundleServerConfig`, `SpecServerConfig` | `spec-lens-contract/src/index.ts` | project kind별 server 설정 |
| `SpecLensApiResponseMap`, `SpecLensApiError` | `spec-lens-contract/src/index.ts` | endpoint 응답 map과 API 오류 |
| `isSpecLensProjectKind`, `isSpecSourceKind`, `isSpecLensResponse` | `spec-lens-contract/src/index.ts` | project kind·source kind·HTTP 응답 runtime guard |
| `DashboardView`, `ScenarioTopicId`, `ScenarioPersona`, `ScenarioGuardEvaluationResult`, `ScenarioGuard`, `ScenarioTerminalGoal`, `ScenarioTransitionRule`, `ScenarioTopicDefinition`, `LensBehaviorAction`, `ScenarioStepProvenance`, `ScenarioMachineContext`, `FlowStep`, `FlowPath`, `FlowMatrixRow`, `FlowEnumerationResult` | `spec-lens-contract/src/index.ts` | 유저 시나리오 주제 및 FSM 네비게이션 타입 |
| `SPEC_DRIFT_TRIAGE_SCENARIO`, `ENDPOINT_EXPLORATION_SCENARIO`, `BREAKING_IMPACT_ANALYSIS_SCENARIO`, `CIRCULAR_REF_DIAGNOSTIC_SCENARIO`, `DEFAULT_SCENARIOS`, `ScenarioRegistry` | `spec-lens-contract/src/index.ts` | 4대 표준 시나리오 정의 및 시나리오 레지스트리 |
| `guardRequireDiffPair`, `guardRequirePathPattern`, `guardRequireSymbolId` | `spec-lens-contract/src/index.ts` | 시나리오 전이 가드 함수 |
| `createInitialScenarioState`, `scenarioTransitionReducer`, `ScenarioTransitionResult` | `spec-lens-contract/src/index.ts` | 순수 FSM 상태 머신 초기화 및 전이 리듀서 |
| `ScenarioFlowEnumerator` | `spec-lens-contract/src/index.ts` | 시나리오 정적 경로 분석 및 Mermaid/DOT 다이어그램 생성기 |

---

## DPM Manifest (`@oa-sdk/dpm`)

Relationship-first Data Pseudonymization Manifest의 package surface다. Manifest syntax gate,
catalog/registry snapshot, semantic validator, compiler, CLI/gateway/publishing context를 포함한다.
지원 subpath는 package exports의 `.`, `./package`, `./catalog`, `./data`, `./profile`, `./relationship`,
`./gateway`, `./storage`, `./publishing`, `./execution`이며 각 subpath는 `packages/dpm/src/public/*.ts`
category barrel을 가리킨다. `packages/dpm/test/package-subpath-import-smoke.mjs`와
`packages/dpm/test/package-subpath-type-consumer.ts`는 build된 package subpath의 runtime/declaration
소비를 검증하고, `packages/dpm/test/package-pack-smoke.mjs`는 dry-run package 파일 경계를 검증한다.

| Export | 정의 | 용도 |
|------|------|------|
| `DPM_PACKAGE_NAME` | `dpm/src/public/package.ts` | 패키지 identity smoke/export guard |
| `DPM_BASELINE` | `dpm/src/public/package.ts` | DPM v1 relationship-first baseline marker |
| `DPM_VERSION` | `dpm/src/public/package.ts` | DPM manifest v1 version literal |
| `DPM_MANIFEST_SCHEMA_ID` | `dpm/src/schema/index.ts` | JSON Schema `$id`와 package export 정합성 검증 |
| `validateDpmManifestSchema()` | `dpm/src/schema/index.ts` | DPM manifest JSON Schema syntax gate |
| `DpmBaseline` | `dpm/src/types.ts` | relationship-first baseline literal type |
| `DpmVersion` | `dpm/src/types.ts` | DPM manifest version literal type |
| `DpmPackageMetadata` | `dpm/src/types.ts` | package metadata shape |
| `DpmManifestSchemaIssue` | `dpm/src/schema/index.ts` | JSON Schema validation issue normalized for DPM diagnostics |
| `DpmManifestSchemaValidationResult` | `dpm/src/schema/index.ts` | DPM manifest syntax validation result |
| `DpmDataFieldType` | `dpm/src/model/data-types.ts` | logical data field type taxonomy |
| `DpmDataFieldDeclaration` | `dpm/src/model/data-types.ts` | logical field definition with optional DB storage reference |
| `DpmDataFieldDeclarationInput` | `dpm/src/model/data-types.ts` | logical field definition input |
| `DpmDataFieldRef` | `dpm/src/model/data-types.ts` | logical DPM field reference used by API bindings |
| `DpmDatabaseColumnRef` | `dpm/src/model/data-types.ts` | physical DB catalog table/column reference |
| `DpmApiObjectRef` | `dpm/src/model/data-types.ts` | OpenAPI artifact/pointer/version reference |
| `DpmApiBindingDirection` | `dpm/src/model/data-types.ts` | request/response/both binding direction |
| `DpmApiBinding` | `dpm/src/model/data-types.ts` | logical field to API object binding |
| `DpmApiBindingInput` | `dpm/src/model/data-types.ts` | API binding input |
| `DpmDataDefinitions` | `dpm/src/model/data-types.ts` | normalized logical data definitions and API bindings |
| `DpmDataDefinitionsInput` | `dpm/src/model/data-types.ts` | data definition normalization input |
| `createDpmDataField()` | `dpm/src/model/data-normalize.ts` | logical field normalization and identity creation |
| `createDpmDataDefinitions()` | `dpm/src/model/data-normalize.ts` | data definitions normalization and reference checks |
| `createDpmApiBinding()` | `dpm/src/model/data-normalize.ts` | API binding normalization and pointer checks |
| `createDpmDataFieldIdentity()` | `dpm/src/model/data-normalize.ts` | logical field identity renderer |
| `createDpmDatabaseColumnIdentity()` | `dpm/src/model/data-normalize.ts` | DB catalog column identity renderer |
| `createDpmApiObjectIdentity()` | `dpm/src/model/data-normalize.ts` | OpenAPI artifact object identity renderer |
| `createDpmApiBindingIdentity()` | `dpm/src/model/data-normalize.ts` | field/API relationship identity renderer |
| `DpmFieldOrigin` | `dpm/src/model/data-identity-types.ts` | persisted/derived/computed/API-only field origin taxonomy |
| `DpmFieldLifecycle` | `dpm/src/model/data-identity-types.ts` | active/deprecated/superseded field lifecycle |
| `DpmEntityRef` | `dpm/src/model/data-identity-types.ts` | dataset/namespace/name-safe logical entity reference |
| `DpmDataFieldLocator` | `dpm/src/model/data-identity-types.ts` | human-readable dataset/namespace/entity/field locator |
| `DpmDataSourceCoordinate` | `dpm/src/model/data-identity-types.ts` | file/DB source coordinate for catalog evidence |
| `DpmCatalogSnapshotRef` | `dpm/src/model/data-identity-types.ts` | catalog snapshot identity, freshness hash, and source coordinate |
| `DpmIdentityDatabaseColumnRef` | `dpm/src/model/data-identity-types.ts` | catalog-qualified physical table/column reference |
| `DpmIdentityApiObjectRef` | `dpm/src/model/data-identity-types.ts` | artifact/version/JSON Pointer API identity reference |
| `DpmIdentityDataFieldDeclaration` | `dpm/src/model/data-identity-types.ts` | identity-complete logical field definition |
| `DpmIdentityDataFieldDeclarationInput` | `dpm/src/model/data-identity-types.ts` | identity-complete logical field input |
| `DpmIdentityDataFieldRef` | `dpm/src/model/data-identity-types.ts` | logical object/revision reference used by v1.1 API bindings |
| `DpmIdentityApiBindingInput` | `dpm/src/model/data-identity-types.ts` | identity-complete API binding input |
| `DpmIdentityApiBinding` | `dpm/src/model/data-identity-types.ts` | independent binding edge and API target contract |
| `DpmIdentityDataDefinitions` | `dpm/src/model/data-identity-types.ts` | experimental v1.1 data definitions normalized contract |
| `DpmIdentityDataDefinitionsInput` | `dpm/src/model/data-identity-types.ts` | experimental v1.1 data definitions input |
| `createDpmIdentityDataDefinitions()` | `dpm/src/model/data-identity-normalize.ts` | v1.1 identity contract normalization and cardinality checks |
| `createDpmIdentityDataField()` | `dpm/src/model/data-identity-normalize.ts` | origin, lifecycle, alias, and identity validation |
| `createDpmIdentityApiBinding()` | `dpm/src/model/data-identity-normalize.ts` | versioned API binding normalization |
| `createDpmIdentityApiBindingIdentity()` | `dpm/src/model/data-identity-normalize.ts` | independent binding edge identity renderer |
| `createDpmEntityRefIdentity()` | `dpm/src/model/data-identity-normalize.ts` | namespace-safe entity identity renderer |
| `createDpmDataFieldLocator()` | `dpm/src/model/data-identity-normalize.ts` | scoped logical field locator constructor |
| `renderDpmDataFieldLocator()` | `dpm/src/model/data-identity-normalize.ts` | deterministic field locator renderer |
| `createDpmDataFieldObjectIdentity()` | `dpm/src/model/data-identity-normalize.ts` | rename-safe logical object identity renderer |
| `createDpmApiObjectCanonicalIdentity()` | `dpm/src/model/data-identity-normalize.ts` | artifact/version/pointer canonical API identity renderer |
| `createDpmIdentityDatabaseColumnIdentity()` | `dpm/src/model/data-identity-normalize.ts` | catalog-qualified DB identity renderer |
| `DPM_NEUTRAL_DATA_BINDING_ARTIFACT_KIND` | `dpm/src/model/data-artifact-types.ts` | immutable neutral logical/API/catalog binding artifact kind |
| `DPM_NEUTRAL_DATA_BINDING_ARTIFACT_VERSIONS` | `dpm/src/model/data-artifact-types.ts` | neutral binding artifact wire-version taxonomy |
| `DpmDataBindingFreshness` | `dpm/src/model/data-artifact-types.ts` | data definition, catalog snapshot, API artifact, and provenance freshness tuple |
| `DpmDataBindingApiArtifactFreshness` | `dpm/src/model/data-artifact-types.ts` | API artifact version and optional provenance version entry in freshness |
| `DpmDataBindingApiArtifactLink` | `dpm/src/model/data-artifact-types.ts` | API artifact hash and source-coordinate provenance link |
| `DpmNeutralDataBindingArtifact` | `dpm/src/model/data-artifact-types.ts` | policy-neutral logical field/API/DB binding output for codegen, trace, review, and future read models |
| `DpmNeutralDataBindingArtifactVersion` | `dpm/src/model/data-artifact-types.ts` | neutral binding artifact version literal union |
| `DpmNeutralDataBindingField` | `dpm/src/model/data-artifact-types.ts` | logical field identity, locator, lifecycle, origin, and optional storage binding output |
| `DpmNeutralDataBindingStorage` | `dpm/src/model/data-artifact-types.ts` | catalog-qualified DB column binding output |
| `DpmNeutralDataBindingApi` | `dpm/src/model/data-artifact-types.ts` | canonical API object identity and coordinate output |
| `DpmNeutralDataBindingApiBinding` | `dpm/src/model/data-artifact-types.ts` | logical field to API object binding edge output |
| `DpmNeutralDataBindingProvenance` | `dpm/src/model/data-artifact-types.ts` | API, catalog, behavior trace, and review provenance link envelope |
| `DpmDataBindingBehaviorTraceLink` | `dpm/src/model/data-artifact-types.ts` | behavior record and trace lineage link accepted by the compiler |
| `DpmDataBindingReviewLink` | `dpm/src/model/data-artifact-types.ts` | review record link accepted by the compiler |
| `createDpmNeutralDataBindingArtifact()` | `dpm/src/compiler/data-binding-artifact.ts` | deterministic immutable v1.1 binding artifact builder |
| `CatalogSnapshot` | `dpm/src/catalog/snapshot-types.ts` | DPM compiler가 소비할 normalized catalog snapshot |
| `CatalogSnapshotInput` | `dpm/src/catalog/snapshot-types.ts` | catalog snapshot normalization 입력 |
| `CatalogSnapshotSource` | `dpm/src/catalog/source-types.ts` | PostgreSQL 또는 OpenAPI projection catalog source 구분 |
| `CatalogFreshness` | `dpm/src/catalog/snapshot-types.ts` | deterministic catalog freshness hash |
| `CatalogSchema` | `dpm/src/catalog/structure-types.ts` | DB schema entry |
| `CatalogTable` | `dpm/src/catalog/structure-types.ts` | table/view entry |
| `CatalogColumn` | `dpm/src/catalog/structure-types.ts` | column type/nullability/ordinal entry |
| `CatalogPrimaryKey` | `dpm/src/catalog/integrity-types.ts` | primary key entry |
| `CatalogForeignKey` | `dpm/src/catalog/integrity-types.ts` | FK-like structural catalog entry |
| `CatalogIndex` | `dpm/src/catalog/integrity-types.ts` | index entry |
| `CatalogUniqueCandidate` | `dpm/src/catalog/integrity-types.ts` | PK/unique/profiled unique candidate entry |
| `CatalogDiagnostic` | `dpm/src/catalog/diagnostic-types.ts` | source-aware catalog diagnostic |
| `PostgresCatalogSnapshotInput` | `dpm/src/catalog/snapshot-types.ts` | PostgreSQL catalog snapshot constructor input |
| `normalizeCatalogSnapshot()` | `dpm/src/catalog/snapshot.ts` | catalog snapshot arrays/source maps를 deterministic internal model로 정규화 |
| `computeCatalogFreshnessHash()` | `dpm/src/catalog/freshness.ts` | catalog structure freshness hash 계산 |
| `createPostgresCatalogSnapshot()` | `dpm/src/catalog/postgres.ts` | PostgreSQL catalog input을 normalized catalog snapshot으로 변환 |
| `POSTGRES_CATALOG_PROFILE_SQL` | `dpm/src/catalog/profiler-postgres.ts` | read-only PostgreSQL catalog profile query |
| `PostgresCatalogProfileRecordKind` | `dpm/src/catalog/profiler-postgres-row-types.ts` | profiled PostgreSQL catalog row kind |
| `PostgresCatalogProfileRow` | `dpm/src/catalog/profiler-postgres-row-types.ts` | raw profiler row returned by the catalog query adapter |
| `PostgresCatalogProfilerClient` | `dpm/src/catalog/profiler-postgres.ts` | explicit query client boundary for PostgreSQL catalog profiling |
| `PostgresCatalogProfilerInput` | `dpm/src/catalog/profiler-postgres.ts` | catalog profiler request with database, schema filter, client, and capture time |
| `PostgresCatalogRowsToSnapshotInput` | `dpm/src/catalog/profiler-postgres-row-types.ts` | row-to-catalog-snapshot conversion input |
| `profilePostgresCatalog()` | `dpm/src/catalog/profiler-postgres.ts` | query client를 통해 PostgreSQL catalog metadata를 읽고 DPM catalog snapshot으로 변환 |
| `postgresCatalogRowsToSnapshot()` | `dpm/src/catalog/profiler-postgres.ts` | profiler rows를 기존 `CatalogSnapshot` contract로 변환 |
| `catalogSnapshotFromOpenApiProjection()` | `dpm/src/catalog/projection.ts` | OpenAPI projection envelope를 structural catalog evidence로 변환 |
| `DPM_PROFILE_ARTIFACT_KIND` | `dpm/src/profile/profile-artifact-types.ts` | DPM profile artifact kind literal |
| `DPM_PROFILE_SOURCE_KINDS` | `dpm/src/profile/profile-taxonomy.ts` | source-neutral profile source taxonomy |
| `DPM_PROFILE_NODE_KINDS` | `dpm/src/profile/profile-taxonomy.ts` | profile graph node taxonomy |
| `DPM_PROFILE_EDGE_KINDS` | `dpm/src/profile/profile-taxonomy.ts` | profile graph edge taxonomy |
| `DPM_PROFILE_METRIC_KINDS` | `dpm/src/profile/profile-taxonomy.ts` | measurable profile metric taxonomy |
| `DPM_PROFILE_CAPTURE_MODES` | `dpm/src/profile/profile-taxonomy.ts` | connector capture mode taxonomy |
| `DPM_PROFILE_DIAGNOSTIC_FAMILIES` | `dpm/src/profile/profile-taxonomy.ts` | profile/connector diagnostic code family prefixes |
| `DpmProfileSourceKind` | `dpm/src/profile/profile-taxonomy.ts` | profile source kind union |
| `DpmProfileNodeKind` | `dpm/src/profile/profile-taxonomy.ts` | profile node kind union |
| `DpmProfileEdgeKind` | `dpm/src/profile/profile-taxonomy.ts` | profile edge kind union |
| `DpmProfileMetricKind` | `dpm/src/profile/profile-taxonomy.ts` | profile metric kind union |
| `DpmProfileCaptureMode` | `dpm/src/profile/profile-taxonomy.ts` | connector capture mode union |
| `DpmProfileDiagnosticFamily` | `dpm/src/profile/profile-taxonomy.ts` | profile diagnostic family union |
| `DpmProfileCoordinate` | `dpm/src/profile/profile-source-types.ts` | DPM-owned source-neutral coordinate for DB/projection/Kafka/query/ORM/manual evidence |
| `DpmProfileSourceDescriptor` | `dpm/src/profile/profile-source-types.ts` | connector/source identity, refs, capture mode, and source freshness metadata |
| `DpmProfileEvidenceSource` | `dpm/src/profile/profile-source-types.ts` | evidence id to coordinate/provenance entry |
| `DpmProfileNode` | `dpm/src/profile/profile-graph-types.ts` | normalized profile graph node |
| `DpmProfileEdge` | `dpm/src/profile/profile-graph-types.ts` | normalized profile graph edge with evidence pointers |
| `DpmProfileMetric` | `dpm/src/profile/profile-graph-types.ts` | normalized profile metric for measurable evidence |
| `DpmProfileDiagnostic` | `dpm/src/profile/profile-artifact-types.ts` | profile/connector diagnostic entry |
| `DpmProfileFreshness` | `dpm/src/profile/profile-artifact-types.ts` | deterministic profile freshness hash and optional source hashes |
| `DpmProfileArtifact` | `dpm/src/profile/profile-artifact-types.ts` | normalized source-neutral profile evidence artifact |
| `DpmProfileArtifactSnapshot` | `dpm/src/profile/artifact-snapshot.ts` | readonly frozen profile artifact snapshot type for SDK consumers |
| `DpmProfileArtifactInput` | `dpm/src/profile/artifact-input-types.ts` | profile artifact normalization input |
| `normalizeDpmProfileArtifact()` | `dpm/src/profile/artifact.ts` | profile arrays/source maps를 deterministic artifact로 정규화 |
| `createDpmProfileArtifactSnapshot()` | `dpm/src/profile/artifact-snapshot.ts` | defensive copied and frozen profile artifact snapshot 생성 |
| `computeDpmProfileFreshnessHash()` | `dpm/src/profile/artifact-freshness.ts` | normalized profile evidence freshness hash 계산 |
| `DPM_PROFILE_ARTIFACT_SCHEMA_ID` | `dpm/src/profile/schema-document.ts` | profile artifact JSON Schema `$id` |
| `DPM_PROFILE_ARTIFACT_SCHEMA` | `dpm/src/profile/schema-document.ts` | DPM profile artifact JSON Schema |
| `DpmProfileArtifactSchemaIssue` | `dpm/src/profile/schema-types.ts` | profile artifact schema validation issue |
| `DpmProfileArtifactSchemaValidationResult` | `dpm/src/profile/schema-types.ts` | profile artifact schema validation result |
| `validateDpmProfileArtifactSchema()` | `dpm/src/profile/schema-validation.ts` | profile artifact JSON Schema validation helper |
| `DPM_PROFILE_CONNECTOR_RESULT_KIND` | `dpm/src/profile/connector-types.ts` | DPM profile connector result kind literal |
| `DPM_PROFILE_CONNECTOR_STATUSES` | `dpm/src/profile/connector-types.ts` | connector result lifecycle status taxonomy |
| `DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS` | `dpm/src/profile/connector-types.ts` | observed connector evidence kind taxonomy |
| `DpmProfileConnectorStatus` | `dpm/src/profile/connector-types.ts` | connector result status union |
| `DpmProfileConnectorEvidenceKind` | `dpm/src/profile/connector-types.ts` | connector observed evidence kind union |
| `DpmProfileConnectorCapabilities` | `dpm/src/profile/connector-types.ts` | connector capability metadata for source/capture/evidence support |
| `DpmProfileConnectorFreshness` | `dpm/src/profile/connector-types.ts` | connector run hash plus profile/source freshness references |
| `DpmProfileConnectorResult` | `dpm/src/profile/connector-types.ts` | normalized connector output envelope for profile artifacts and diagnostics |
| `DpmProfileConnectorResultInput` | `dpm/src/profile/connector-types.ts` | connector result normalization input |
| `DpmProfileConnectorValidationResult` | `dpm/src/profile/connector-types.ts` | connector result validation diagnostics envelope |
| `normalizeDpmProfileConnectorResult()` | `dpm/src/profile/connector-result.ts` | connector output을 deterministic result envelope로 정규화 |
| `computeDpmProfileConnectorRunHash()` | `dpm/src/profile/connector-run-hash.ts` | connector result run hash 계산 |
| `validateDpmProfileConnectorResult()` | `dpm/src/profile/connector-validate.ts` | capabilities/observed evidence/profile artifact 정합성 검증 |
| `DpmKafkaTopicProfileInput` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured Kafka topic bundle profile adapter input |
| `DpmKafkaTopicProfileCaptureMode` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | Kafka topic profile capture mode union |
| `DpmKafkaTopic` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured Kafka topic shape, partitions, key/header/schema/value evidence |
| `DpmKafkaKey` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured Kafka message key metadata |
| `DpmKafkaHeader` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured Kafka message header metadata |
| `DpmKafkaSchema` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured Kafka schema subject/version metadata |
| `DpmKafkaMessageField` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured nested Kafka message field metadata |
| `DpmKafkaRelationshipHint` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | captured non-executable Kafka relationship hint metadata |
| `DpmKafkaTopicProfileInputValidationOptions` | `dpm/src/profile/kafka-topic-profile-input-validation.ts` | Kafka topic profile input validation options |
| `DpmKafkaTopicProfileInputValidationResult` | `dpm/src/profile/kafka-topic-profile-input-validation.ts` | Kafka topic profile input validation diagnostics envelope |
| `DPM_KAFKA_TOPIC_PROFILE_CAPTURE_MODES` | `dpm/src/profile/kafka-topic-profile-input-types.ts` | Kafka topic profile connector capture mode taxonomy |
| `DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_ID` | `dpm/src/profile/kafka.ts` | default product Kafka topic profile connector id |
| `DPM_KAFKA_TOPIC_PROFILE_CONNECTOR_VERSION` | `dpm/src/profile/kafka.ts` | default product Kafka topic profile connector version |
| `DPM_KAFKA_TOPIC_FIXTURE_CONNECTOR_ID` | `dpm/src/profile/kafka.ts` | default fixture Kafka topic profile connector id |
| `profileKafkaTopic()` | `dpm/src/profile/kafka.ts` | captured Kafka topic bundle을 profile artifact + connector result로 변환 |
| `validateDpmKafkaTopicProfileInput()` | `dpm/src/profile/kafka-topic-profile-input-validation.ts` | captured Kafka topic bundle input을 graph 생성 전 검증 |
| `DpmKafkaTopicProfileFixture` | `dpm/src/profile/kafka-fixture-types.ts` | fixture-backed Kafka topic profile adapter input |
| `DpmKafkaTopicFixture` | `dpm/src/profile/kafka-fixture-types.ts` | Kafka topic shape, partitions, key/header/schema/value evidence fixture |
| `DpmKafkaKeyFixture` | `dpm/src/profile/kafka-fixture-types.ts` | Kafka message key fixture metadata |
| `DpmKafkaHeaderFixture` | `dpm/src/profile/kafka-fixture-types.ts` | Kafka message header fixture metadata |
| `DpmKafkaSchemaFixture` | `dpm/src/profile/kafka-fixture-types.ts` | Kafka schema subject/version fixture metadata |
| `DpmKafkaMessageFieldFixture` | `dpm/src/profile/kafka-fixture-types.ts` | nested Kafka message field fixture metadata |
| `DpmKafkaRelationshipHintFixture` | `dpm/src/profile/kafka-fixture-types.ts` | non-executable Kafka relationship hint fixture metadata |
| `profileKafkaTopicFixture()` | `dpm/src/profile/kafka.ts` | fixture-backed Kafka topic evidence를 fixture capture mode의 profile artifact + connector result로 변환 |
| `DPM_PROFILE_ANALYSIS_REPORT_KIND` | `dpm/src/profile/analysis-report-types.ts` | DPM profile analysis report kind literal |
| `DPM_PROFILE_RELATIONSHIP_HINT_STATUSES` | `dpm/src/profile/analysis-taxonomy.ts` | relationship hint proposal lifecycle taxonomy |
| `DPM_PROFILE_RELATIONSHIP_HINT_SOURCES` | `dpm/src/profile/analysis-taxonomy.ts` | relationship hint proposal evidence source taxonomy |
| `DPM_PROFILE_KEY_CANDIDATE_KINDS` | `dpm/src/profile/analysis-taxonomy.ts` | profile key candidate taxonomy |
| `DPM_PROFILE_RISK_INDICATOR_KINDS` | `dpm/src/profile/analysis-taxonomy.ts` | profile analysis risk indicator taxonomy |
| `DPM_PROFILE_DRIFT_SIGNAL_KINDS` | `dpm/src/profile/analysis-taxonomy.ts` | profile drift signal taxonomy |
| `DpmProfileRelationshipHintStatus` | `dpm/src/profile/analysis-taxonomy.ts` | relationship hint proposal status union |
| `DpmProfileRelationshipHintSource` | `dpm/src/profile/analysis-taxonomy.ts` | relationship hint proposal source union |
| `DpmProfileKeyCandidateKind` | `dpm/src/profile/analysis-taxonomy.ts` | profile key candidate kind union |
| `DpmProfileRiskIndicatorKind` | `dpm/src/profile/analysis-taxonomy.ts` | profile risk indicator kind union |
| `DpmProfileDriftSignalKind` | `dpm/src/profile/analysis-taxonomy.ts` | profile drift signal kind union |
| `DpmProfileAnalysisInput` | `dpm/src/profile/analysis-input-types.ts` | profile analysis request input |
| `DpmProfileAnalysisPolicy` | `dpm/src/profile/analysis-policy-types.ts` | profile analysis threshold and confidence policy |
| `DpmProfileAnalysisPolicyInput` | `dpm/src/profile/analysis-policy-types.ts` | partial profile analysis policy override input |
| `DEFAULT_DPM_PROFILE_ANALYSIS_POLICY` | `dpm/src/profile/analysis-policy.ts` | default profile analysis threshold policy preserving existing behavior |
| `resolveDpmProfileAnalysisPolicy()` | `dpm/src/profile/analysis-policy.ts` | partial policy override resolver with ratio validation |
| `computeDpmProfileAnalysisPolicyHash()` | `dpm/src/profile/analysis-policy.ts` | resolved profile analysis policy hash 계산 |
| `DpmProfileAnalysisCoverage` | `dpm/src/profile/analysis-signal-types.ts` | source/node/metric coverage summary |
| `DpmProfileRelationshipHintProposal` | `dpm/src/profile/analysis-signal-types.ts` | reviewer-safe non-executable relationship hint proposal |
| `DpmProfileKeyCandidate` | `dpm/src/profile/analysis-signal-types.ts` | key/join candidate derived from profile evidence |
| `DpmProfileRiskIndicator` | `dpm/src/profile/analysis-signal-types.ts` | profile risk indicator without raw values |
| `DpmProfileDriftSignal` | `dpm/src/profile/analysis-signal-types.ts` | current-vs-previous profile drift signal |
| `DpmProfileAnalysisSummary` | `dpm/src/profile/analysis-report-types.ts` | profile analysis report count summary |
| `DpmProfileAnalysisFreshness` | `dpm/src/profile/analysis-report-types.ts` | analysis report freshness hash metadata |
| `DpmProfileAnalysisReport` | `dpm/src/profile/analysis-report-types.ts` | coverage, relationship hints, key candidates, drift, risk, diagnostics report |
| `createDpmProfileAnalysisReport()` | `dpm/src/profile/analysis-report.ts` | profile artifact를 deterministic analysis report로 변환 |
| `computeDpmProfileAnalysisReportHash()` | `dpm/src/profile/analysis-report-freshness.ts` | profile analysis report hash 계산 |
| `DpmProfileRelationshipEndpointResolverOptions` | `dpm/src/profile/analysis-relationship-candidate.ts` | profile hint endpoint resolution에서 소비자가 제공하는 child table mapping 옵션 |
| `DpmProfileRelationshipEndpointResolverInput` | `dpm/src/profile/analysis-relationship-candidate.ts` | profile artifact와 relationship hint를 endpoint resolver에 전달하는 input |
| `DpmProfileRelationshipEndpointResolution` | `dpm/src/profile/analysis-relationship-candidate.ts` | resolved parent/child discovery endpoints와 resolver warnings |
| `DpmProfileRelationshipTargetRefResolution` | `dpm/src/profile/analysis-relationship-candidate.ts` | parsed profile hint targetRef endpoint path and optional catalog authority |
| `DpmProfileRelationshipCandidateBridgeInput` | `dpm/src/profile/analysis-relationship-candidate.ts` | reviewer-supplied endpoint mapping input for profile hint to relationship candidate bridge |
| `DpmProfileResolvedRelationshipCandidateBridgeInput` | `dpm/src/profile/analysis-relationship-candidate.ts` | profile hint endpoint resolver options를 포함한 resolved candidate bridge input |
| `resolveDpmRelationshipCandidateEndpointsFromProfileHint()` | `dpm/src/profile/analysis-relationship-candidate.ts` | profile relationship hint의 targetRef/source coordinate와 consumer table mapping을 discovery endpoints로 변환 |
| `createDpmRelationshipCandidateInputFromResolvedProfileHint()` | `dpm/src/profile/analysis-relationship-candidate.ts` | resolved profile hint endpoints를 사용해 import-ready relationship candidate input 생성 |
| `createDpmRelationshipCandidateInputFromProfileHint()` | `dpm/src/profile/analysis-relationship-candidate.ts` | profile relationship hint proposal을 import-ready relationship candidate input으로 변환 |
| `DISCOVERY_REPORT_KIND` | `dpm/src/discovery/report.ts` | discovery report kind literal |
| `DiscoveryEvidenceKind` | `dpm/src/discovery/discovery-taxonomy.ts` | candidate evidence source taxonomy |
| `DISCOVERY_EVIDENCE_KINDS` | `dpm/src/discovery/discovery-taxonomy.ts` | runtime discovery evidence kind taxonomy used by TypeScript and OpenAPI |
| `DISCOVERY_RELATIONSHIP_CANDIDATE_TYPES` | `dpm/src/discovery/discovery-taxonomy.ts` | runtime discovery relationship candidate type taxonomy |
| `DISCOVERY_EXCLUDED_CANDIDATE_REASONS` | `dpm/src/discovery/discovery-taxonomy.ts` | runtime discovery exclusion reason taxonomy |
| `DiscoveryEvidence` | `dpm/src/discovery/discovery-evidence-types.ts` | reviewable relationship candidate evidence entry |
| `DiscoveryThresholds` | `dpm/src/discovery/discovery-threshold-types.ts` | confidence/reject/orphan threshold contract |
| `DiscoveryConfidenceLevel` | `dpm/src/discovery/discovery-taxonomy.ts` | high/review/low confidence classification |
| `DISCOVERY_CANDIDATE_RECOMMENDATIONS` | `dpm/src/discovery/discovery-taxonomy.ts` | runtime relationship candidate recommendation taxonomy used by TypeScript and OpenAPI |
| `DISCOVERY_CONFIDENCE_LEVELS` | `dpm/src/discovery/discovery-taxonomy.ts` | runtime relationship candidate confidence taxonomy |
| `DiscoveryCandidateRecommendation` | `dpm/src/discovery/discovery-taxonomy.ts` | review/reject recommendation contract |
| `DiscoveryRelationshipCandidateType` | `dpm/src/discovery/discovery-taxonomy.ts` | relationship candidate type union |
| `DiscoveryExcludedCandidateReason` | `dpm/src/discovery/discovery-taxonomy.ts` | discovery exclusion reason union |
| `RelationshipCandidateInput` | `dpm/src/discovery/discovery-relationship-candidate-types.ts` | candidate report authoring input |
| `RelationshipCandidate` | `dpm/src/discovery/discovery-relationship-candidate-types.ts` | normalized non-executable relationship candidate |
| `ExcludedRelationshipCandidate` | `dpm/src/discovery/discovery-exclusion-types.ts` | excluded candidate reason entry |
| `RelationshipDiscoveryReportInput` | `dpm/src/discovery/discovery-report-types.ts` | discovery report creation input |
| `RelationshipDiscoveryReport` | `dpm/src/discovery/discovery-report-types.ts` | reviewable discovery report output |
| `RelationshipDiscoveryCatalogInput` | `dpm/src/discovery/catalog-relationship-candidates.ts` | catalog-derived relationship discovery input |
| `classifyRelationshipCandidate()` | `dpm/src/discovery/report.ts` | confidence score를 review/reject classification으로 변환 |
| `createRelationshipDiscoveryReport()` | `dpm/src/discovery/report.ts` | candidate input을 non-executable review report로 정규화 |
| `createRelationshipDiscoveryReportFromCatalog()` | `dpm/src/discovery/catalog-relationship-candidates.ts` | catalog foreign key evidence를 non-executable review report로 정규화 |
| `REGISTRY_SNAPSHOT_KIND` | `dpm/src/registry/registry-identity.ts` | registry snapshot kind literal |
| `REGISTRY_RELATIONSHIP_STATUSES` | `dpm/src/registry/registry-taxonomy.ts` | runtime registry lifecycle status taxonomy used by TypeScript and OpenAPI |
| `RegistryRelationshipStatus` | `dpm/src/registry/registry-taxonomy.ts` | candidate/proposed/approved/rejected/deprecated/superseded lifecycle status |
| `REGISTRY_RELATIONSHIP_KINDS` | `dpm/src/registry/registry-taxonomy.ts` | runtime registry relationship kind taxonomy |
| `RegistryRelationshipKind` | `dpm/src/registry/registry-taxonomy.ts` | registry relationship kind taxonomy |
| `REGISTRY_TRANSFORM_STRATEGIES` | `dpm/src/registry/registry-taxonomy.ts` | runtime registry transform strategy taxonomy |
| `RegistryTransformStrategy` | `dpm/src/registry/registry-taxonomy.ts` | registry transform strategy taxonomy |
| `REGISTRY_ORPHAN_POLICIES` | `dpm/src/registry/registry-taxonomy.ts` | runtime registry orphan policy taxonomy used by TypeScript and OpenAPI |
| `RegistryOrphanPolicy` | `dpm/src/registry/registry-taxonomy.ts` | registry relationship orphan policy taxonomy |
| `RegistryConditionMetadata` | `dpm/src/registry/registry-relationship-types.ts` | context column, SQL condition, temporal condition metadata |
| `RegistryEvidence` | `dpm/src/registry/registry-relationship-types.ts` | registry relationship evidence entry |
| `RegistryApprovalMetadata` | `dpm/src/registry/registry-relationship-types.ts` | owner/reviewer/approval metadata |
| `ApprovedRegistryApprovalMetadata` | `dpm/src/registry/registry-relationship-types.ts` | approved relationship approval metadata for write paths |
| `RegistryRelationshipInput` | `dpm/src/registry/registry-relationship-types.ts` | registry relationship authoring input |
| `ApprovedRegistryRelationshipInput` | `dpm/src/registry/registry-relationship-types.ts` | approved registry relationship payload for write paths |
| `RegistryRelationship` | `dpm/src/registry/registry-relationship-types.ts` | normalized relationship with identity and executable flag |
| `RegistrySnapshotInput` | `dpm/src/registry/registry-snapshot-types.ts` | registry snapshot creation input |
| `RegistrySnapshot` | `dpm/src/registry/registry-snapshot-types.ts` | versioned registry snapshot output |
| `createRegistrySnapshot()` | `dpm/src/registry/snapshot.ts` | registry input을 stable versioned snapshot으로 정규화 |
| `parseRegistrySnapshotYaml()` | `dpm/src/registry/snapshot.ts` | YAML review artifact를 registry snapshot으로 파싱 |
| `selectApprovedRelationships()` | `dpm/src/registry/registry-executable.ts` | approved executable relationship만 선택 |
| `isExecutableRegistryRelationship()` | `dpm/src/registry/registry-executable.ts` | registry status 실행 가능성 판별 |
| `DPM_REGISTRY_STORAGE_SCHEMA_VERSION` | `dpm/src/storage/registry-schema-sql.ts` | registry storage SQL compatibility/version marker |
| `DPM_REGISTRY_STORAGE_SCHEMA_SQL_BLOCKS` | `dpm/src/storage/registry-schema-sql.ts` | ordered Postgres registry storage schema SQL blocks |
| `DPM_REGISTRY_STORAGE_SCHEMA_SQL` | `dpm/src/storage/registry-schema-sql.ts` | Postgres canonical relationship registry schema SQL |
| `DpmRegistryStorageSchemaQueryClient` | `dpm/src/storage/registry-schema-apply.ts` | dependency-free query client boundary for applying registry storage schema SQL blocks |
| `DpmRegistryStorageSchemaApplyResult` | `dpm/src/storage/registry-schema-apply.ts` | registry storage schema apply result with schema version and applied block count |
| `applyDpmRegistryStorageSchema()` | `dpm/src/storage/registry-schema-apply.ts` | applies ordered registry storage schema SQL blocks through an explicit query client |
| `DPM_REGISTRY_APPROVED_RELATIONSHIP_CONFLICT_ERROR_CODE` | `dpm/src/storage/registry-storage-errors.ts` | stable storage error code for approved relationship uniqueness conflicts |
| `DpmRegistryApprovedRelationshipConflictError` | `dpm/src/storage/registry-storage-errors.ts` | structured storage error containing dataset, registry, relationship, version, and constraint context |
| `isDpmRegistryApprovedRelationshipConflictError()` | `dpm/src/storage/registry-storage-errors.ts` | runtime type guard for approved relationship uniqueness conflict errors |
| `DpmRegistryApprovedRelationshipConflictDetails` | `dpm/src/storage/registry-storage-errors.ts` | context payload for constructing approved relationship uniqueness conflict errors |
| `DpmRegistryApprovedRelationshipConflictErrorCode` | `dpm/src/storage/registry-storage-errors.ts` | type literal for the approved relationship uniqueness conflict error code |
| `DPM_REGISTRY_RELATIONSHIP_AUDIT_EVENT_TYPES` | `dpm/src/storage/registry-audit-row-types.ts` | registry relationship audit event taxonomy |
| `DpmPostgresRegistryQueryClient` | `dpm/src/storage/registry-postgres-storage.ts` | dependency-free Postgres query client boundary for registry storage SQL |
| `DpmPostgresRegistryClient` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres registry query client with transaction callback for atomic approval commits |
| `DpmRegistryCanonicalKeyEncodingContractRequest` | `dpm/src/storage/registry-encoding-contract-types.ts` | dataset and registry-version coordinate for reading the authoritative canonical-key encoding contract |
| `DpmRegistryCanonicalKeyEncodingClaimInput` | `dpm/src/storage/registry-encoding-contract-types.ts` | atomic canonical-key encoding version claim for one dataset and registry version |
| `DpmRegistryCanonicalKeyEncodingContract` | `dpm/src/storage/registry-encoding-contract-types.ts` | persisted authoritative canonical-key encoding contract with optional storage timestamps |
| `DpmRegistrySnapshotExportRequest` | `dpm/src/storage/registry-repository-types.ts` | storage-backed registry snapshot export request |
| `DpmRegistryRelationshipRowRequest` | `dpm/src/storage/registry-repository-types.ts` | storage reader dataset/version row request |
| `DpmRegistryRelationshipAuditEventRequest` | `dpm/src/storage/registry-repository-types.ts` | storage reader request for registry relationship audit events |
| `DpmRegistryRelationshipSaveInput` | `dpm/src/storage/registry-repository-types.ts` | approved relationship payload to registry storage row save input |
| `DpmRegistryRelationshipApprovalCommitInput` | `dpm/src/storage/registry-repository-types.ts` | storage adapter payload for atomically committing an approved relationship row with its audit event |
| `DpmRegistryRelationshipApprovalCommitResult` | `dpm/src/storage/registry-repository-types.ts` | storage adapter result for an atomic approved relationship row and audit event commit |
| `DpmRegistryRelationshipSaveResult` | `dpm/src/storage/registry-repository-types.ts` | repository save result containing the saved relationship row and actual persisted approval audit event when available |
| `DpmRegistryRelationshipAuditEventRow` | `dpm/src/storage/registry-repository-types.ts` | append-only relationship approval audit event row |
| `DpmRegistryRelationshipAuditEventType` | `dpm/src/storage/registry-repository-types.ts` | relationship audit event type union |
| `DpmRegistryRelationshipRow` | `dpm/src/storage/registry-repository-types.ts` | canonical storage row shape for relationship registry records |
| `DpmRegistryRowsToSnapshotInput` | `dpm/src/storage/registry-repository-types.ts` | row-to-snapshot export input |
| `DpmRegistryStorageReader` | `dpm/src/storage/registry-repository-types.ts` | repository adapter boundary for listing registry rows |
| `DpmRegistryAuditEventReader` | `dpm/src/storage/registry-repository-types.ts` | read-only adapter boundary for listing registry approval audit events |
| `DpmRegistryStorage` | `dpm/src/storage/registry-repository-types.ts` | writable registry storage adapter boundary for split row upserts or atomic approval commits, plus optional audit event append/listing |
| `DpmRegistryRepository` | `dpm/src/storage/registry-repository-types.ts` | storage-backed snapshot export repository |
| `DpmRegistryWritableRepository` | `dpm/src/storage/registry-repository-types.ts` | registry repository with saveRelationship persistence bridge, optional audit-aware save result bridge, and optional audit event listing |
| `createDpmRegistryRepository()` | `dpm/src/storage/registry-repository.ts` | row reader를 registry snapshot export repository로 감싸고, writer adapter에는 relationship save bridge, audit-aware save result bridge, optional atomic approval commit bridge, optional audit append bridge를 제공한다 |
| `createDpmPostgresRegistryStorage()` | `dpm/src/storage/registry-postgres-storage.ts` | dependency-free Postgres registry storage adapter with transaction-backed approval commits |
| `listDpmPostgresRegistryRelationshipRows()` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres relationship registry row query helper |
| `upsertDpmPostgresRegistryRelationshipRow()` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres relationship registry row upsert helper |
| `commitDpmPostgresRegistryRelationshipApproval()` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres relationship row and approval audit event commit helper that wraps the provided transaction callback |
| `appendDpmPostgresRegistryRelationshipAuditEvent()` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres approval audit event insert helper |
| `listDpmPostgresRegistryRelationshipAuditEvents()` | `dpm/src/storage/registry-postgres-storage.ts` | Postgres approval audit timeline query helper |
| `createDpmRegistryRelationshipRow()` | `dpm/src/storage/registry-row-relationship.ts` | registry relationship payload를 canonical registry storage row로 변환 |
| `copyDpmRegistryRelationshipRow()` | `dpm/src/storage/registry-row-relationship.ts` | registry storage row adapter boundary defensive copy helper |
| `createDpmRegistryRelationshipAuditEventRow()` | `dpm/src/storage/registry-audit-event.ts` | approved registry relationship row를 append-only approval audit event row로 변환 |
| `copyDpmRegistryRelationshipAuditEventRow()` | `dpm/src/storage/registry-audit-event.ts` | registry audit event adapter boundary defensive copy helper |
| `registryRowsToSnapshot()` | `dpm/src/storage/registry-row-mapper.ts` | storage rows를 기존 `RegistrySnapshot` contract로 변환 |
| `CanonicalKeyValue` | `dpm/src/model/canonical-key.ts` | canonical key value primitive |
| `CanonicalKeyValueMap` | `dpm/src/model/canonical-key.ts` | canonical key column value map |
| `DpmCanonicalKeyEncodingVersion` | `dpm/src/model/canonical-key-encoding.ts` | string-v1 / typed-v2 canonical key identity contract |
| `DPM_CANONICAL_KEY_ENCODING_VERSIONS` | `dpm/src/model/canonical-key-encoding.ts` | supported canonical key encoding version tuple |
| `DPM_DEFAULT_CANONICAL_KEY_ENCODING_VERSION` | `dpm/src/model/canonical-key-encoding.ts` | compatibility-window default string-v1 marker |
| `isDpmCanonicalKeyEncodingVersion()` | `dpm/src/model/canonical-key-encoding.ts` | unknown encoding version runtime type guard |
| `resolveDpmCanonicalKeyEncodingVersion()` | `dpm/src/model/canonical-key-encoding.ts` | omitted version defaulting and unsupported version rejection |
| `ModelEndpoint` | `dpm/src/model/endpoint.ts` | table and column endpoint for DPM model surfaces |
| `TenantNamespaceInput` | `dpm/src/model/canonical-key.ts` | tenant-scoped canonical key input |
| `EntityKeyStrategyType` | `dpm/src/model/entity-types.ts` | single-column or composite entity key mode |
| `EntityKeyStrategy` | `dpm/src/model/entity-types.ts` | entity root canonical key strategy |
| `EntityTransform` | `dpm/src/model/entity-types.ts` | deterministic entity transform contract |
| `EntityDeclarationInput` | `dpm/src/model/entity-types.ts` | entity declaration authoring input |
| `EntityDeclaration` | `dpm/src/model/entity-types.ts` | normalized entity declaration with identity |
| `createEntityDeclaration()` | `dpm/src/model/entity-normalize.ts` | entity root and namespace contract normalization |
| `renderEntityCanonicalKey()` | `dpm/src/model/entity-canonical-key.ts` | deterministic entity canonical key rendering |
| `DpmCanonicalKeyEncodingPlan` | `dpm/src/model/plan-aware-canonical-key.ts` | compiled-plan canonical key encoding projection |
| `assertDpmCanonicalKeyEncodingVersionMatchesPlan()` | `dpm/src/model/plan-aware-canonical-key.ts` | renderer strategy와 compiled plan encoding 불일치 차단 |
| `renderEntityCanonicalKeyForPlan()` | `dpm/src/model/plan-aware-canonical-key.ts` | plan encoding을 검증한 entity canonical key rendering |
| `LogicalRelationshipKind` | `dpm/src/model/relationship-types.ts` | logical relationship kind taxonomy |
| `LogicalRelationshipOrphanPolicy` | `dpm/src/model/relationship-types.ts` | orphan policy taxonomy for logical relationships |
| `LogicalRelationshipCardinality` | `dpm/src/model/relationship-types.ts` | logical relationship cardinality contract |
| `LogicalRelationshipCondition` | `dpm/src/model/relationship-types.ts` | condition text and metadata contract |
| `TemporalRelationshipInput` | `dpm/src/model/relationship-types.ts` | temporal valid-time declaration or absence reason |
| `RelationshipCanonicalKeyStrategy` | `dpm/src/model/relationship-types.ts` | relationship canonical key component strategy |
| `LogicalRelationshipInput` | `dpm/src/model/relationship-types.ts` | logical relationship authoring input |
| `LogicalRelationship` | `dpm/src/model/relationship-types.ts` | normalized logical relationship model |
| `createLogicalRelationship()` | `dpm/src/model/relationship-normalize.ts` | relationship predicate and temporal rule normalization |
| `renderRelationshipCanonicalKey()` | `dpm/src/model/relationship-canonical-key.ts` | deterministic relationship canonical key rendering |
| `renderRelationshipCanonicalKeyForPlan()` | `dpm/src/model/plan-aware-canonical-key.ts` | plan encoding을 검증한 relationship canonical key rendering |
| `DpmDiagnosticSeverity` | `dpm/src/validator/diagnostic-taxonomy.ts` | semantic validator severity taxonomy |
| `DPM_DIAGNOSTIC_CODES` | `dpm/src/validator/diagnostic-taxonomy.ts` | runtime diagnostic code taxonomy used by TypeScript and OpenAPI |
| `DpmDiagnosticCode` | `dpm/src/validator/diagnostic-taxonomy.ts` | SYN/REL/SAF diagnostic code taxonomy |
| `DpmCatalogCoordinate` | `dpm/src/validator/diagnostic-coordinate-types.ts` | catalog coordinate attached to diagnostics |
| `DpmApiCoordinate` | `dpm/src/validator/diagnostic-coordinate-types.ts` | API artifact/version/pointer coordinate attached to DAT diagnostics |
| `DpmRegistryCoordinate` | `dpm/src/validator/diagnostic-coordinate-types.ts` | registry coordinate attached to diagnostics |
| `DpmDiagnostic` | `dpm/src/validator/diagnostic-result-types.ts` | deterministic semantic validation diagnostic |
| `DpmValidationSummary` | `dpm/src/validator/diagnostic-result-types.ts` | error, warning, and info counts |
| `DpmValidationResult` | `dpm/src/validator/diagnostic-result-types.ts` | semantic validation result envelope |
| `DpmValidationPhase` | `dpm/src/validator/validation-types.ts` | validate, compile, dry-run, or runtime phase |
| `DpmValidationInput` | `dpm/src/validator/validation-types.ts` | manifest plus catalog and registry snapshot validator input |
| `DpmApiArtifactInput` | `dpm/src/validator/data-binding-types.ts` | OpenAPI artifact document and optional provenance input for semantic binding |
| `DpmApiArtifactProvenance` | `dpm/src/validator/data-binding-types.ts` | artifact version and source coordinate provenance |
| `validateDpmManifest()` | `dpm/src/validator/manifest.ts` | SYN syntax plus REL/SAF semantic diagnostics without source DB access |
| `validateDpmDataBindings()` | `dpm/src/validator/data-binding-validator.ts` | DAT entity/catalog/API/provenance binding validation |
| `computeDpmApiArtifactVersionHash()` | `dpm/src/validator/data-binding-validator.ts` | deterministic OpenAPI artifact version hash |
| `DPM_COMPILED_PLAN_KIND` | `dpm/src/compiler/plan.ts` | compiled plan kind literal |
| `DPM_COMPILED_PLAN_VERSIONS` | `dpm/src/compiler/plan.ts` | runtime compiled plan version taxonomy used by TypeScript and OpenAPI |
| `DpmCompiledPlanVersion` | `dpm/src/compiler/plan.ts` | compiled plan version taxonomy |
| `DPM_PLAN_STALE_REASONS` | `dpm/src/compiler/plan.ts` | runtime compiled plan stale reason taxonomy used by TypeScript and OpenAPI |
| `DpmPlanStaleReason` | `dpm/src/compiler/plan.ts` | compiled plan stale reason taxonomy |
| `DPM_RELATIONSHIP_STEP_CARDINALITIES` | `dpm/src/compiler/plan.ts` | runtime relationship step cardinality taxonomy used by TypeScript and OpenAPI |
| `DpmRelationshipStepCardinality` | `dpm/src/compiler/plan.ts` | compiled relationship step cardinality taxonomy |
| `DpmPlanFreshness` | `dpm/src/compiler/plan.ts` | manifest, catalog, and registry freshness tuple |
| `DpmNamespaceBinding` | `dpm/src/compiler/plan.ts` | namespace to entity, relationship, and column binding |
| `DpmRelationshipStep` | `dpm/src/compiler/plan.ts` | approved relationship execution step |
| `DpmColumnStep` | `dpm/src/compiler/plan.ts` | column transform execution step |
| `DpmCompiledPlan` | `dpm/src/compiler/plan.ts` | relationship-first compiled execution plan |
| `createPlanFreshness()` | `dpm/src/compiler/plan-freshness.ts` | compiled plan freshness tuple creation |
| `DpmCompileInput` | `dpm/src/compiler/compile.ts` | compiler manifest, catalog, and registry input |
| `DpmCompileSuccess` | `dpm/src/compiler/compile.ts` | successful compiler result |
| `DpmCompileFailure` | `dpm/src/compiler/compile.ts` | compiler refusal result with diagnostics |
| `DpmCompileResult` | `dpm/src/compiler/compile.ts` | compiler result union |
| `compileDpmPlan()` | `dpm/src/compiler/compile.ts` | validator-gated compiled plan creation |
| `DPM_DRY_RUN_REPORT_KIND` | `dpm/src/dry-run/report.ts` | dry-run report kind literal |
| `DpmDryRunImpact` | `dpm/src/dry-run/report.ts` | dry-run impact count summary |
| `DpmDryRunCategory` | `dpm/src/dry-run/report.ts` | dry-run impact category count |
| `DpmDryRunInput` | `dpm/src/dry-run/report.ts` | dry-run report input |
| `DpmDryRunReport` | `dpm/src/dry-run/report.ts` | raw-value-free dry-run report |
| `createDpmDryRunReport()` | `dpm/src/dry-run/report.ts` | dry-run impact report creation |
| `DpmExecutionKey` | `dpm/src/execution/execution-types.ts` | caller-supplied ephemeral key material type for in-memory execution |
| `DpmExecutionRow` | `dpm/src/execution/execution-types.ts` | caller-owned table row input for in-memory execution |
| `DpmExecutionInput` | `dpm/src/execution/execution-types.ts` | compiled plan plus in-memory row batch execution input |
| `DpmExecutionOptions` | `dpm/src/execution/execution-types.ts` | token/hash key and redaction output options; key material is not persisted |
| `DpmExecutionDiagnostic` | `dpm/src/execution/execution-types.ts` | raw-value-free execution diagnostic |
| `DpmExecutionIntegrity` | `dpm/src/execution/execution-types.ts` | post-run relationship integrity summary |
| `DpmExecutionReport` | `dpm/src/execution/execution-types.ts` | raw-value-free in-memory execution report |
| `DpmExecutionResult` | `dpm/src/execution/execution-types.ts` | fail-closed execution result union |
| `DpmExecutionSuccess` | `dpm/src/execution/execution-types.ts` | successful transformed row batch result |
| `DpmExecutionFailure` | `dpm/src/execution/execution-types.ts` | execution refusal with diagnostics and no output rows |
| `executeDpmRows()` | `dpm/src/execution/in-memory-executor.ts` | caller-owned in-memory transform adapter with keyed token/hash, orphan checks, and relationship integrity; no DB/vault access |
| `DPM_JOB_KIND` | `dpm/src/storage/job-repository-types.ts` | persisted DPM job row kind literal |
| `DPM_JOB_OPERATIONS` | `dpm/src/storage/job-operation-taxonomy.ts` | persisted DPM job operation taxonomy |
| `DPM_JOB_STATUSES` | `dpm/src/storage/job-status-taxonomy.ts` | persisted DPM job status taxonomy |
| `DpmJobOperation` | `dpm/src/storage/job-repository-types.ts` | compile or dry-run persisted job operation taxonomy |
| `DpmJobStatus` | `dpm/src/storage/job-repository-types.ts` | accepted, completed, or failed persisted job status |
| `DpmJobRequest` | `dpm/src/storage/job-repository-types.ts` | job lookup request |
| `DpmJobSaveInput` | `dpm/src/storage/job-repository-types.ts` | sanitized job persistence input |
| `DpmJobRow` | `dpm/src/storage/job-repository-types.ts` | persisted job metadata row |
| `DpmJobStorage` | `dpm/src/storage/job-repository-types.ts` | storage adapter boundary for persisted jobs |
| `DpmJobRepository` | `dpm/src/storage/job-repository-types.ts` | job persistence repository surface |
| `createDpmJobRow()` | `dpm/src/storage/job-row-builder.ts` | copy-only job row builder that excludes unsafe payload fields |
| `createDpmJobRepository()` | `dpm/src/storage/job-repository.ts` | adapter-backed job persistence repository factory |
| `DPM_VALIDATION_REPORT_KIND` | `dpm/src/storage/report-repository-types.ts` | persisted validation report row kind literal |
| `DPM_VALIDATION_REPORT_STATUSES` | `dpm/src/storage/report-status-taxonomy.ts` | persisted validation report status taxonomy |
| `DpmValidationReportStatus` | `dpm/src/storage/report-repository-types.ts` | completed or failed validation report status |
| `DpmValidationReportRequest` | `dpm/src/storage/report-repository-types.ts` | validation report lookup request |
| `DpmValidationReportSaveInput` | `dpm/src/storage/report-repository-types.ts` | sanitized validation report persistence input |
| `DpmStoredValidationReport` | `dpm/src/storage/report-repository-types.ts` | persisted validation report row with diagnostics and summaries |
| `DpmGatewayJobReport` | `dpm/src/storage/report-repository-types.ts` | gateway-compatible job report retrieval shape |
| `DpmValidationReportStorage` | `dpm/src/storage/report-repository-types.ts` | storage adapter boundary for validation reports |
| `DpmReportRepository` | `dpm/src/storage/report-repository-types.ts` | validation report persistence and retrieval repository surface |
| `createDpmValidationReport()` | `dpm/src/storage/report-row-builder.ts` | copy-only validation report builder that excludes unsafe payload fields |
| `validationReportToGatewayJobReport()` | `dpm/src/storage/report-gateway-projection.ts` | stored report to gateway job report projection |
| `createDpmReportRepository()` | `dpm/src/storage/report-repository.ts` | adapter-backed validation report repository factory |
| `DPM_PROFILE_BASELINE_KIND` | `dpm/src/storage/profile-baseline-repository.ts` | persisted profile baseline row kind literal |
| `DpmProfileBaselineRequest` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline lookup request |
| `DpmProfileBaselineListRequest` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline list request for dataset/profile history |
| `DpmProfileBaselineMeasurementIdentityInput` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline measurement identity hash input |
| `DpmProfileBaselineArtifactSummary` | `dpm/src/storage/profile-baseline-repository.ts` | body-free baseline profile artifact count summary |
| `DpmProfileBaselineSummary` | `dpm/src/storage/profile-baseline-repository.ts` | body-free profile baseline history summary projection |
| `DpmProfileBaselineSelectionRequest` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline selection request for current profile analysis |
| `DpmProfileBaselineSaveInput` | `dpm/src/storage/profile-baseline-repository.ts` | profile artifact and optional analysis report persistence input |
| `DpmProfileBaselineRow` | `dpm/src/storage/profile-baseline-repository.ts` | persisted profile baseline artifact/report row |
| `DPM_PROFILE_BASELINE_SELECTION_STRATEGIES` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline selection strategy taxonomy |
| `DpmProfileBaselineSelectionStrategy` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline selection strategy union |
| `DpmPreviousProfileBaselineSelectionInput` | `dpm/src/storage/profile-baseline-repository.ts` | direct selector input for latest previous profile baseline selection |
| `DpmPreviousProfileBaselineSummarySelectionInput` | `dpm/src/storage/profile-baseline-repository.ts` | body-free summary selector input for latest previous profile baseline selection |
| `DpmProfileBaselineStorage` | `dpm/src/storage/profile-baseline-repository.ts` | storage adapter boundary for profile baselines |
| `DpmProfileBaselineRepository` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline persistence, retrieval, selection, and body-free summary repository surface |
| `createDpmProfileBaselineRow()` | `dpm/src/storage/profile-baseline-repository.ts` | copy-only profile baseline row builder with profile/report consistency guard |
| `copyDpmProfileBaselineRow()` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline row copy helper that preserves stored metadata |
| `createDpmProfileBaselineMeasurementId()` | `dpm/src/storage/profile-baseline-repository.ts` | deterministic profile baseline measurement identity helper |
| `renderDpmProfileBaselineRef()` | `dpm/src/storage/profile-baseline-repository.ts` | profile baseline ref renderer that includes measurement identity when present |
| `assertDpmProfileBaselineSummary()` | `dpm/src/storage/profile-baseline-repository.ts` | runtime invariant guard for body-free profile baseline summaries |
| `copyDpmProfileBaselineSummary()` | `dpm/src/storage/profile-baseline-repository.ts` | body-free profile baseline summary copy helper |
| `copyDpmProfileBaselineSummaries()` | `dpm/src/storage/profile-baseline-repository.ts` | body-free profile baseline summary list copy helper |
| `summarizeDpmProfileBaselineRow()` | `dpm/src/storage/profile-baseline-repository.ts` | body-free profile baseline row summary projection |
| `summarizeDpmProfileBaselineRows()` | `dpm/src/storage/profile-baseline-repository.ts` | body-free profile baseline history summary projection |
| `selectDpmPreviousProfileBaseline()` | `dpm/src/storage/profile-baseline-repository.ts` | deterministic latest previous profile baseline selector |
| `selectDpmPreviousProfileBaselineSummary()` | `dpm/src/storage/profile-baseline-repository.ts` | deterministic latest previous profile baseline summary selector |
| `createDpmProfileBaselineRepository()` | `dpm/src/storage/profile-baseline-repository.ts` | adapter-backed profile baseline repository factory |
| `DpmGatewayOperationId` | `dpm/src/gateway/openapi-operation-ids.ts` | DPM gateway operation id taxonomy |
| `DpmGatewayOpenApiDocument` | `dpm/src/gateway/openapi.ts` | DPM gateway OpenAPI 3.2 document type |
| `DPM_GATEWAY_OPERATION_IDS` | `dpm/src/gateway/openapi-operation-ids.ts` | required DPM gateway operation id list |
| `getDpmGatewayOpenApiDocument()` | `dpm/src/gateway/openapi.ts` | checked DPM gateway OpenAPI 3.2 artifact |
| `DPM_PROFILE_PROPOSAL_REVIEW_STATUSES` | `dpm/src/gateway/profile-proposal.ts` | editor-safe profile proposal review lifecycle taxonomy |
| `DpmProfileProposalReviewStatus` | `dpm/src/gateway/profile-proposal.ts` | editor-safe profile proposal review status union |
| `DPM_GATEWAY_RUNTIME_OPERATION_IDS` | `dpm/src/gateway/runtime-operation-ids.ts` | runtime-executable DPM gateway operation id list |
| `DpmGatewayProfileInspectionInput` | `dpm/src/gateway/runtime-profile-types.ts` | loaded profile artifact inspection request |
| `DpmGatewayProfileInspectionResult` | `dpm/src/gateway/runtime-profile-types.ts` | profile artifact inspection counts and diagnostics |
| `DpmGatewayProfileAnalysisInput` | `dpm/src/gateway/runtime-profile-types.ts` | loaded profile artifact analysis request |
| `DpmGatewayProfileAnalysisResult` | `dpm/src/gateway/runtime-profile-types.ts` | profile analysis gateway response result |
| `DpmGatewayProfileBaselineSummaryListInput` | `dpm/src/gateway/runtime-profile-types.ts` | loaded profile baseline summary list request backed by a consumer repository |
| `DpmGatewayProfileBaselineSummaryListResult` | `dpm/src/gateway/runtime-profile-types.ts` | body-free profile baseline summary list gateway result |
| `DpmGatewayProfileProposalReviewInput` | `dpm/src/gateway/runtime-profile-types.ts` | path-owned proposal id plus editor-safe profile proposal review decision |
| `DpmGatewayProfileProposalReviewResult` | `dpm/src/gateway/runtime-profile-types.ts` | editor-safe profile proposal review result |
| `DpmGatewayRelationshipDiscoveryRequest` | `dpm/src/gateway/runtime-relationship-types.ts` | OpenAPI relationship discovery request with catalog snapshot ref |
| `DpmGatewayRelationshipDiscoverySnapshotResolver` | `dpm/src/gateway/runtime-relationship-types.ts` | consumer-supplied catalog snapshot resolver for relationship discovery requests |
| `DpmGatewayRelationshipDiscoveryInput` | `dpm/src/gateway/runtime-relationship-types.ts` | loaded manifest and catalog input for catalog-derived relationship discovery |
| `DpmGatewayRelationshipDiscoveryResult` | `dpm/src/gateway/runtime-relationship-types.ts` | schema-valid relationship discovery report result |
| `DpmGatewayCandidateImportInput` | `dpm/src/gateway/runtime-relationship-types.ts` | relationship candidate import request input |
| `DpmGatewayCandidateImportResult` | `dpm/src/gateway/runtime-relationship-types.ts` | relationship candidate import count plus normalized review report result |
| `DpmGatewayRelationshipApprovalInput` | `dpm/src/gateway/runtime-relationship-types.ts` | relationship candidate approval input with registry policy fields |
| `DpmGatewayRelationshipApprovalResult` | `dpm/src/gateway/runtime-relationship-types.ts` | approved registry relationship payload result |
| `DpmGatewayProfileRelationshipHintApprovalInput` | `dpm/src/gateway/runtime-relationship-types.ts` | profile relationship hint approval workflow input with endpoint resolver, approval, optional audit event id, and writable registry repository fields |
| `DpmGatewayProfileRelationshipHintApprovalRequest` | `dpm/src/gateway/runtime-relationship-types.ts` | OpenAPI profile relationship hint approval request body before path-owned relationship name and runtime repository injection |
| `DpmGatewayRegistryRelationshipWriteReceipt` | `dpm/src/gateway/runtime-relationship-types.ts` | logical registry write receipt for gateway responses, including optional persisted approval audit event id, without exposing storage row shape |
| `DpmGatewayProfileRelationshipHintApprovalSuccessResult` | `dpm/src/gateway/runtime-relationship-types.ts` | schema-valid profile hint approval success result with candidate import, approved relationship, write receipt, and exported registry snapshot |
| `DpmGatewayProfileRelationshipHintApprovalBlockingResult` | `dpm/src/gateway/runtime-relationship-types.ts` | schema-valid profile hint approval blocking result with relationship name and profile diagnostics |
| `DpmGatewayProfileRelationshipHintApprovalResult` | `dpm/src/gateway/runtime-relationship-types.ts` | profile hint approval success or blocking result discriminated by status |
| `DpmGatewayRegistrySnapshotExportInput` | `dpm/src/gateway/runtime-relationship-types.ts` | repository-backed registry snapshot export runtime input |
| `DpmGatewayRegistrySnapshotExportResult` | `dpm/src/gateway/runtime-relationship-types.ts` | schema-valid registry snapshot export runtime result |
| `DpmGatewayRegistryAuditEventListInput` | `dpm/src/gateway/runtime-relationship-types.ts` | repository-backed registry approval audit event timeline list runtime input |
| `DpmGatewayRegistryAuditEventListResult` | `dpm/src/gateway/runtime-relationship-types.ts` | schema-valid registry approval audit event timeline list result |
| `DpmGatewayRuntimeOperationId` | `dpm/src/gateway/runtime-operation-ids.ts` | runtime operation id taxonomy |
| `DpmGatewayRuntimeStatusCode` | `dpm/src/gateway/runtime-response-types.ts` | runtime success or blocking-diagnostic status code |
| `DpmGatewayRuntimeCommand` | `dpm/src/gateway/runtime-response-types.ts` | profile, relationship, and manifest runtime command taxonomy |
| `DpmGatewayRuntimeBody` | `dpm/src/gateway/runtime-response-types.ts` | runtime response body envelope |
| `DpmGatewayRuntimeManifestInput` | `dpm/src/gateway/runtime-manifest-types.ts` | already-loaded manifest, catalog, registry, and estimated row input |
| `DpmGatewaySnapshotRef` | `dpm/src/gateway/runtime-manifest-request-types.ts` | OpenAPI request snapshot ref passed to runtime snapshot resolvers |
| `DpmGatewayManifestRequest` | `dpm/src/gateway/runtime-manifest-request-types.ts` | OpenAPI manifest request body shape for validate, compile, and dry-run runtime resolution |
| `DpmGatewayManifestSnapshotResolver` | `dpm/src/gateway/runtime-manifest-request-types.ts` | consumer-supplied snapshot resolver for catalog and registry refs |
| `DpmGatewayProfileBaselineRef` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | OpenAPI profile analysis request ref for a stored profile baseline |
| `DpmGatewayProfileAnalysisRequest` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | OpenAPI profile analysis request body shape before baseline resolution |
| `DpmGatewayProfileAnalysisResolvedRequest` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | resolved profile analysis runtime input plus selected body-free baseline summary metadata |
| `DpmGatewayProfileAnalysisBaselineResolver` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | consumer-supplied profile baseline row resolver for profile analysis requests |
| `DpmGatewayRuntimeResponse` | `dpm/src/gateway/runtime-response-types.ts` | gateway runtime response envelope |
| `DpmGatewayRuntime` | `dpm/src/gateway/runtime-types.ts` | loaded profile, relationship discovery/import/approval/profile hint approval/export, validate, compile, and dry-run runtime handlers |
| `resolveDpmGatewayManifestRuntimeInput()` | `dpm/src/gateway/runtime-manifest-request.ts` | converts OpenAPI manifest request refs into loaded runtime manifest input through a snapshot resolver |
| `resolveDpmGatewayRelationshipDiscoveryRuntimeInput()` | `dpm/src/gateway/runtime-relationship-request.ts` | converts OpenAPI relationship discovery request refs into loaded runtime input through a catalog snapshot resolver |
| `resolveDpmGatewayProfileAnalysisRequest()` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | converts profile analysis baseline refs into loaded runtime input and selected baseline summary metadata |
| `resolveDpmGatewayProfileAnalysisRuntimeInput()` | `dpm/src/gateway/runtime-profile-analysis-request.ts` | converts profile analysis baseline refs into loaded runtime profile analysis input through a profile baseline resolver |
| `discoverDpmRelationshipsRuntime()` | `dpm/src/gateway/runtime-relationship-discover.ts` | source-DB-free relationship discovery runtime handler from loaded manifest/catalog evidence |
| `importDpmRelationshipCandidatesRuntime()` | `dpm/src/gateway/runtime-relationship-candidate-import.ts` | relationship candidate import runtime handler returning counts and a normalized review report without registry mutation |
| `approveDpmRelationshipCandidateRuntime()` | `dpm/src/gateway/runtime-relationship-approve.ts` | relationship candidate approval runtime handler returning an approved registry relationship payload without storage mutation and rejecting non-review candidates |
| `approveDpmProfileRelationshipHintRuntime()` | `dpm/src/gateway/runtime-profile-relationship-hint-approval.ts` | product workflow helper that resolves a profile hint, imports a review candidate, approves it, saves the approved row, and exports the registry snapshot |
| `exportDpmRegistrySnapshotRuntime()` | `dpm/src/gateway/runtime-relationship-registry-export.ts` | repository-backed registry snapshot export runtime handler returning schema-valid registry snapshots |
| `listDpmRegistryRelationshipAuditEventsRuntime()` | `dpm/src/gateway/runtime-relationship-registry-audit-events.ts` | repository-backed registry approval audit event timeline runtime handler returning schema-valid copied events |
| `createDpmGatewayRuntime()` | `dpm/src/gateway/runtime-factory.ts` | source-DB-free runtime adapter for profile, relationship, profile hint approval, registry export, registry audit timeline, and manifest operations |
| `DpmRelationshipMetadata` | `dpm/src/publishing/types.ts` | AI-publishable approved relationship metadata |
| `DpmAiRelationshipContext` | `dpm/src/publishing/types.ts` | AI schema relationship context entry |
| `DpmAiSchemaContext` | `dpm/src/publishing/types.ts` | read-only AI schema context envelope |
| `DpmPhysicalForeignKeyRecommendation` | `dpm/src/publishing/types.ts` | recommendation-only physical FK output |
| `DpmPublishingContextInput` | `dpm/src/publishing/types.ts` | publishing context creation input |
| `DpmPublishingContext` | `dpm/src/publishing/types.ts` | relationship metadata and AI schema context output |
| `DPM_PUBLISHING_CONTEXT_KIND` | `dpm/src/publishing/context.ts` | publishing context kind literal |
| `createDpmPublishingContext()` | `dpm/src/publishing/context.ts` | publishing context generation from compiled plans |

---

## 함수 (`@oa-sdk/parser`)

| 함수 | 파일 | 용도 |
|------|------|------|
| `parseDocument()` | `parse.ts` | OAS 문서 → ParsedDocument IR (정식 진입점) |
| `getQuerystringParameter()` | `querystring.ts` | OAS 3.2 whole-query parameter를 찾고 query와의 배타성·단일성 위반을 fail-fast 처리 |
| `isParsedDocument()` | `parsed-document.ts` | raw OAS와 Map-backed `ParsedDocument` IR을 구분하는 runtime type guard |
| `isParsedDocumentComplete()` | `parsed-document.ts` | `$ref` resolution evidence가 complete인 `ParsedDocument`를 좁히는 runtime type guard |
| `assertParsedDocumentComplete()` | `parsed-document.ts` | partial 또는 legacy metadata-less IR이 생성기로 전달되는 것을 차단하는 assertion |
| `IncompleteParsedDocumentError` | `parsed-document.ts` | 불완전 IR 소비 시 resolution diagnostic을 보존하는 명시적 오류 |
| `createParsedDocumentRefResolution()` | `parsed-document.ts` | resolver diagnostic과 잔존 `$ref`를 complete/partial evidence로 정규화 |
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
| `escapeJsonPointerToken()` | `json-pointer.ts` | RFC 6901 reference token escape (`~`→`~0` 다음 `/`→`~1`). parser에 의존하는 패키지의 공용 구현(parser에 의존하지 않거나 런타임에 로드할 수 없는 코드는 자체 사본 유지), `@oa-sdk/parser/browser`에도 export |
| `unescapeJsonPointerToken()` | `json-pointer.ts` | RFC 6901 token unescape를 한 번의 좌→우 패스로 수행 (`~01`→`~1`). 잘못된 `~` 시퀀스는 그대로 둠 |
| `appendJsonPointer()` | `json-pointer.ts` | JSON Pointer 또는 `#` fragment 끝에 escape한 token(문자열/배열 index) 추가 |
| `formatJsonPointer()` | `json-pointer.ts` | token 목록 → JSON Pointer. 빈 목록은 root pointer `''` |
| `parseJsonPointer()` | `json-pointer.ts` | JSON Pointer → unescape된 token 목록. `''`→`[]`, 선행 `/` 누락이나 잘못된 `~` escape는 `undefined` |
| `canonicalJsonPointerFragment()` | `json-pointer.ts` | JSON Reference URI fragment를 정규 표기로 변환: percent-decode 후 token을 `formatJsonPointer()`처럼 escape (`#/a%20b`→`#/a b`). 같은 위치의 다른 표기가 같은 문자열이 되며, `projectRefGraph` pointer와 resolver cache key가 이 표기를 쓴다. fragment가 아니거나 잘못된 percent/`~` escape는 `undefined`. `@oa-sdk/parser/browser`에도 export |
| `findNearestJsonPointerEntry()` | `json-pointer.ts` | pointer 자신, 없으면 가장 가까운 상위 pointer(token 경계 기준, root 포함)를 key로 가진 Map entry를 찾는다. build-spec provenance의 `canonicalId` 조회를 spec-lens graph와 `oa-gen ref-projection`이 공유하며 `@oa-sdk/parser/browser`에도 export |
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
| `extractOperationsFromSource()` | `ts-operation-extractor.ts` | TypeScript 소스 텍스트에서 JSDoc `@oaOperation` 태그를 추출하여 OpenAPI 3.2 Operation 목록 및 진단 반환 |
| `extractOperationsFromFile()` | `ts-operation-extractor.ts` | TypeScript 파일 경로에서 JSDoc `@oaOperation` 태그를 추출하여 OpenAPI 3.2 Operation 목록 및 진단 반환 |
| `toOperationEntry()` | `ts-operation-extractor.ts` | `ExtractedOperation`을 OpenAPI 3.2 표준 `OperationEntry` 모델로 변환 |
| `buildPathPointer()` | `ts-operation-extractor.ts` | OpenAPI 3.2 JSON Pointer (`#/paths/~1.../method`) 빌드 |
| `SUPPORTED_HTTP_METHODS` | `ts-operation-extractor.ts` | 지원되는 HTTP 메서드 (OAS 3.2 query 포함 9종) 집합 |

### 타입 (`@oa-sdk/parser` — 함수/파이프라인)

| 타입 | 파일 | 용도 |
|------|------|------|
| `SpecPass` | `pipeline.ts` | 파이프라인 패스 함수 타입 |
| `ParseDocumentOptions` | `parse.ts` | `parseDocument()` basePath/deref diagnostic 옵션 |
| `CompleteParsedDocument` | `types.ts` | complete resolution evidence를 필수로 가진 생성기 안전 IR |
| `ParsedDocumentRefResolution` | `types.ts` | `$ref` 해소 status, scope, diagnostic evidence |
| `ParsedDocumentRefDiagnostic` | `types.ts` | missing/cycle/external/unsupported ref 진단과 source coordinate |
| `ParsedDocumentRefDiagnosticCode` | `types.ts` | parser completeness diagnostic 코드 union |
| `ParsedDocumentRefResolutionScope` | `types.ts` | internal / all / custom resolver scope |
| `CreateParsedDocumentRefResolutionOptions` | `parsed-document.ts` | resolution evidence 생성 입력 |
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
| `JsonPointerEntryMatch` | `json-pointer.ts` | `findNearestJsonPointerEntry()`가 찾은 key pointer와 값 |
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
| `LintCategory` | `lint.ts` | 린트 규칙 카테고리 union ('spec' / 'style' / 'best-practice' / 'performance' / 'security') |
| `ValidateDocumentOptions` | `validate.ts` | validation gate 옵션. basePath/source location과 OpenAPI 3.2 strict 여부 지원 |
| `ValidationResult` | `validate.ts` | 검증 결과 |
| `ExtractedOperation` | `ts-operation-extractor.ts` | JSDoc `@oaOperation` 태그에서 추출된 API 오퍼레이션 모델 (method, path, declarationName, declarationKind 등) |
| `OperationDiagnostic` | `ts-operation-extractor.ts` | JSDoc 오퍼레이션 태그 구문/메서드/경로 파싱 진단 정보 |
| `OperationExtractResult` | `ts-operation-extractor.ts` | 오퍼레이션 추출 결과 (operations, diagnostics) |

---

## 함수 (`@oa-sdk/codegen`)

Typegen 공개 surface는 root entry(`@oa-sdk/codegen`)와 typegen sub-entry(`@oa-sdk/codegen/typegen`)에서 동일하게 지원한다.
지원 subpath는 package exports의 `.`, `./apitomy`, `./drizzle`, `./plugin`, `./spec-lens`, `./typegen`, `./typegen/browser`, `./zodgen`이며 `typegen/generate-types.ts`와 `typegen/schema-to-ts.ts`는 문서상 코드 위치일 뿐 package deep import로 공개하지 않는다.
`./typegen/browser`는 이미 로드된 OpenAPI 객체를 위한 브라우저 안전 surface이며, 외부 파일 `$ref` 분석과 `basePath` 처리는 Node용 `./typegen`에 남긴다.
`./zodgen`은 OpenAPI 3.2 Schema Object(Draft 2020-12)를 최신 Zod 4 코드로 생성하고 런타임 검증기를 제공하는 모듈이다.

| 함수 | 파일 | 용도 |
|------|------|------|
| `zodToSchema()` | `zod-to-schema.ts` | Zod 4 → OAS 3.2 Schema (refs 컨텍스트 지원) |
| `generateComponents()` | `generator.ts` | Zod 맵 → YAML (writeSchemas 위임) |
| `defineConfig()` | `config.ts` | 타입 안전 oa.config.ts 설정 정의 헬퍼 |
| `validateOaConfig()` | `config.ts` | OaConfig 스키마 및 타겟 유효성 검증 |
| `assertOaConfig()` | `config.ts` | 유효하지 않은 OaConfig에 대해 OaConfigError throw |
| `isOaConfig()` | `config.ts` | OaConfig 타입 가드 |
| `OaConfigError` | `config.ts` | oa.config 설정 유효성 검증 실패 에러 클래스 |
| `getArchetypeDefaults()` | `config.ts` | 아키타입별 기본 설정 반환 |
| `resolveConfigWithDefaults()` | `config.ts` | 루트 및 프로덕트 레이어 설정을 병합하고 기본값 적용 |
| `ARTIFACT_KINDS` | `config.ts` | 지원 산출물 종류 상수 배열 ('contract', 'client', 'queries', 'keys', 'guards', 'schemas') |
| `artifactKindSchema` | `config.ts` | 산출물 종류 Zod 유효성 검증 스키마 |
| `outputRoutingRuleSchema` | `config.ts` | 산출물 라우팅 규칙 Zod 스키마 |
| `byKindRoutingConfigSchema` | `config.ts` | 산출물 종류별 라우팅 매핑 Zod 스키마 |
| `outputRoutingConfigSchema` | `config.ts` | outputRouting 설정 전체 Zod 스키마 |
| `toKebabCase()` | `routing/token-resolver.ts` | 문자열을 kebab-case로 변환 |
| `toCamelCase()` | `routing/token-resolver.ts` | 문자열을 camelCase로 변환 |
| `toPascalCase()` | `routing/token-resolver.ts` | 문자열을 PascalCase로 변환 |
| `splitWords()` | `routing/token-resolver.ts` | 대소문자 및 구분자 기준 단어 분할 |
| `sanitizePathPreserve()` | `routing/token-resolver.ts` | 경로 문자열 정규화 및 특수문자 정제 |
| `casingTransformers` | `routing/token-resolver.ts` | CasingStyle별 변환 함수 맵 |
| `extractGroupFromPath()` | `routing/token-resolver.ts` | URL 경로의 첫 번째 유효 세그먼트 추출 |
| `resolvePathPattern()` | `routing/token-resolver.ts` | 템플릿 패턴 내 토큰({tag}, {kind}, {operationId}, {method}, {group}) 치환 및 경로 해결 |
| `loadTsconfig()` | `routing/import-resolver.ts` | tsconfig.json 로드 및 파싱 (주석 및 extends 지원) |
| `stripJsonComments()` | `routing/import-resolver.ts` | JSON 문자열 내 주석(//, /* */) 제거 |
| `toPosixPath()` | `routing/import-resolver.ts` | Windows 백슬래시 및 드라이브 문자를 POSIX 슬래시 경로로 정규화 |
| `formatExtension()` | `routing/import-resolver.ts` | 출력 확장자 포맷 정규화 (.js ESM 지원) |
| `matchTsconfigPathAlias()` | `routing/import-resolver.ts` | tsconfig.json의 paths 별칭 매칭 및 치환 |
| `resolveImportSpecifier()` | `routing/import-resolver.ts` | 두 파일 간 동적 상대 import 경로 또는 tsconfig path alias 계산 |
| `DEFAULT_BANNER_MARKERS` | `routing/manifest-manager.ts` | 자동 생성 파일 배너 식별 마커 목록 |
| `OaManifestManager` | `routing/manifest-manager.ts` | .oa-manifest.json 매니페스트 관리 및 3-Gate 안전 고아 파일 정리 클래스 |
| `matchesRoutingRule()` | `routing/path-dispatcher.ts` | 산출물 컨텍스트가 라우팅 규칙 조건에 부합하는지 평가 |
| `dispatchArtifactPath()` | `routing/path-dispatcher.ts` | 우선순위에 따른 산출물 최종 경로 결정 |
| `PathDispatcher` | `routing/path-dispatcher.ts` | 산출물 라우팅 및 상대 import 경로 해결 오케스트레이터 클래스 |
| `createPathDispatcher()` | `routing/path-dispatcher.ts` | PathDispatcher 인스턴스 팩토리 함수 |
| `loadOaConfig()` | `cli/lib/config-loader.ts` | TypeScript/ESM/JSON oa.config 비동기 로더 및 캐시 버스팅 |
| `resolveProfileTarget()` | `cli/lib/config-loader.ts` | 프로파일 타겟 경로 정규화 및 절대 경로 해석 |
| `resolveGuardTarget()` | `cli/lib/config-loader.ts` | 타입 가드 타겟 경로 정규화 |
| `CANDIDATE_CONFIG_FILES` | `cli/lib/config-loader.ts` | 설정 파일 검색 후보 목록 (`oa.config.ts`, `oa.config.js`, `oa.config.mjs`, `oa.config.json`) |
| `findProjectRoot()` | `@oa-sdk/core` re-export | 상향식 프로젝트 루트 디렉터리 자동 탐색 함수 re-export |
| `stableStringify()` | `spec-projector.ts` | 키 순서가 정렬된 결정론적 JSON 직렬화 |
| `computeSha256()` | `spec-projector.ts` | 입력 문자열의 SHA-256 해시 계산 |
| `computeVersionHash()` | `spec-projector.ts` | 결정론적 SHA-256 스펙 해시 계산 |
| `stripSchemaEngineExtensions()` | `spec-projector.ts` | 산출물 객체에서 `x-schema-engine-*` 내부 확장 필드 제거 |
| `projectTargetSpec()` | `spec-projector.ts` | 선언적 프로파일 기반 OpenAPI/JSON Schema 산출물 투영 |
| `projectTargetGuards()` | `spec-projector.ts` | 선언적 타겟 기반 독립형 타입 가드 일괄 생성 |
| `generateStandaloneGuards()` | `standalone-guards/index.ts` | 사전 컴파일된 제로 런타임/Zero-Eval 독립형 ESM 타입 가드 생성 |
| `computeEntitySpecDiff()` | `ast-sync/diff-engine.ts` | EntitySpec 간 정밀 AST 차이 계산 |
| `createInsertEdit()` | `ast-sync/text-edit.ts` | 소스 코드 삽입 편집 단위 생성 헬퍼 |
| `createReplaceEdit()` | `ast-sync/text-edit.ts` | 소스 코드 교체 편집 단위 생성 헬퍼 |
| `createDeleteEdit()` | `ast-sync/text-edit.ts` | 소스 코드 삭제 편집 단위 생성 헬퍼 |
| `applyTextEdits()` | `ast-sync/text-edit.ts` | 역오프셋 상향식 텍스트 편집 적용 (트리비아/포맷 100% 보존) |
| `syncEntitySpecWithCode()` | `ast-sync/index.ts` | EntitySpec IR과 소스 코드 간 양방향 동기화 |
| `ZodTypeAdapter` | `ast-sync/adapters/zod-adapter.ts` | Zod 스키마 양방향 AST 어댑터 |
| `TsAstTypeAdapter` | `ast-sync/adapters/ts-ast-adapter.ts` | TypeScript 인터페이스/타입 양방향 AST 어댑터 |
| `TypiaTypeAdapter` | `ast-sync/adapters/typia-adapter.ts` | Typia 검증 태그 양방향 AST 어댑터 |
| `executeSchemaPipeline()` | `schema-pipeline/pipeline.ts` | 4단계 스키마 투명성 파이프라인 통합 실행 및 매니페스트 생성 |
| `formatTransparencyTable()` | `schema-pipeline/pipeline.ts` | 4단계 스키마 투명성 파이프라인 ASCII 감사 보고서 포맷터 |
| `createZod4Algebra()` | `zodgen/schema-to-zod.ts` | OpenAPI 3.2 Schema Object를 Zod 4 코드로 변환하는 catamorphic fold 대수 |
| `generateZodFromSpec()` | `zodgen/generate-zod.ts` | OpenAPI 3.2 스펙의 컴포넌트 스키마를 Zod 4 정의 및 타입 추론 코드로 생성 |
| `ZodGenerationPreflightError` | `zodgen/generate-zod.ts` | Zod 4 코드 생성 전 사전 검증(preflight validation) 실패 시 진단 정보와 함께 throw되는 에러 클래스 |
| `schemaToZod()` | `zodgen/schema-to-zod.ts` | 단일 OasSchema를 Zod 4 코드 표현식으로 변환 |
| `prepareSchemaForZod()` | `zodgen/schema-to-zod.ts` | Zod 4 변환을 위한 스키마 사전 처리 (타입 배열, nullish, exclusive bounds 등 정규화) |
| `normalizeOasForZodRuntime()` | `zodgen/runtime-adapter.ts` | Zod 4 `z.fromJSONSchema` 호환을 위한 OAS 포인터 및 키워드 정규화 |
| `createDynamicZodValidator()` | `zodgen/runtime-adapter.ts` | Zod 4 네이티브 JSON Schema 파서를 이용한 단일 인메모리 런타임 검증기 생성 |
| `createRuntimeZodValidators()` | `zodgen/runtime-adapter.ts` | 전체 컴포넌트 스키마에 대한 인메모리 런타임 Zod 검증기 맵 생성
| `generateTypes()` | `typegen/generate-types.ts` | ParsedDocument → TS 타입 문자열 (ResponseLinks 포함) |
| `generateTypesFromSpec()` | `typegen/generate-types.ts` | OAS spec → TS 타입 (parseDocument 포함, ResponseLinks 포함) |
| `generateTypes()` / `generateTypesFromSpec()` | `typegen/browser.ts` | 브라우저 안전 typegen. in-memory spec만 처리하고 Node crypto/path/filesystem ref graph를 import하지 않음 |
| `analyzeExternalSchemaRefs()` | `typegen/generate-types.ts` | 외부 schema-position `$ref` 스키마 타입명/충돌 diagnostic 조회 (`#/components/schemas/*`, `#/$defs/*`, 비 components schema root 포함, operation 타입 충돌/unsupported pointer 경고 포함) |
| `schemaToTs()` | `typegen/schema-to-ts.ts` | 단일 OAS Schema → TS 타입 문자열 (SchemaToTsOptions 지원) |
| `createTypescriptAlgebra()` | `typegen/schema-to-ts.ts` | 호출별 옵션을 closure로 격리해 JSON Schema fold 결과를 TypeScript 타입 표현으로 변환하는 algebra 생성 |
| `projectSchemaToTs()` | `typegen/schema-fidelity.ts` | schema→TypeScript 출력과 pointer별 의미 보존 진단을 하나의 projection 결과로 생성 |
| `analyzeSchemaFidelity()` | `typegen/schema-fidelity.ts` | JSON Schema 제약이 TypeScript에 exact/runtime-only/widening/narrowing/unsupported 중 어떻게 투영되는지 결정적으로 분류 |
| `createMemoryTypeRegistry()` | `type-registry.ts` | 선언·관계·경계·runtime exposure를 파일 교체 단위로 관리하는 in-memory Type Registry 생성 |
| `createNoopTypeRegistry()` | `type-registry.ts` | 타입 인덱싱을 비활성화해도 동일 호출 계약을 유지하는 no-op Type Registry 생성 |
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
| `emitSketchArtifacts()` | `sketch-emitter/index.ts` | TypeSpec 스케치 소스 또는 `InterfaceSketchIr`에서 JSON Schema·OpenAPI·Mermaid·TypeScript/Python 계약 스텁을 한 번에 생성(`oa-gen sketch --action emit`이 사용) |
| `buildJsonSchemaFromSketchIr()` | `sketch-emitter/index.ts` | Interface Sketch IR을 JSON Schema 2020-12(`x-evidence`, `x-oa-sdk-intent`, `x-oa-sdk-derived-from` 포함)로 변환 |
| `buildOpenApiFromSketchIr()` | `sketch-emitter/index.ts` | Interface Sketch IR을 OpenAPI 3.1 문서로 변환(모델은 `components.schemas`, 인터페이스 operation은 `POST /<Interface>/<operation>` 경로와 `<Interface>_<operation>` operationId) |
| `buildMermaidFromSketchIr()` | `sketch-emitter/index.ts` | Interface Sketch IR을 Mermaid `classDiagram`으로 변환 |
| `buildTypeScriptStubFromSketchIr()` | `sketch-emitter/index.ts` | 모델·인터페이스와 `not implemented`를 던지는 `<Interface>Stub` 클래스를 담은 TypeScript 계약 스텁 생성 |
| `buildPythonStubFromSketchIr()` | `sketch-emitter/index.ts` | dataclass 모델과 snake_case 메서드 `Protocol`을 담은 Python 계약 스텁 생성 |
| `findArtifactCompatibility()` | `cli/lib/artifact-compatibility-policy.ts` | 이름으로 공개 artifact schema 지원·migration 정책 항목을 찾는다 |
| `supportsArtifactSchemaVersion()` | `cli/lib/artifact-compatibility-policy.ts` | artifact의 입력 schema version이 현재 지원 창에 포함되는지 확인한다 |
| `ARTIFACT_COMPATIBILITY_POLICY_SCHEMA_VERSION` | `cli/lib/artifact-compatibility-policy.ts` | artifact 호환성 정책 wire schema version |
| `OA_SDK_ARTIFACT_COMPATIBILITY_POLICY_V1` | `cli/lib/artifact-compatibility-policy.ts` | provenance, parallel evidence, governance config의 현재 schema·migration support policy |
| `createRefProjectionArtifact()` | `cli/lib/ref-projection-artifact.ts` | parsed OpenAPI 문서를 `projectRefGraph`로 `$ref` 전개 없이 투영해 `oa-sdk.ref-projection.v1` artifact 생성. 노드·엣지·진단을 code unit 순서로 정렬하고 그래프 파일 경로를 진입 문서 기준 `$ref` 형식으로 쓰며(상대·비정규 `entryPath`는 정규화), build-spec provenance가 있으면 노드별 `canonicalId`(가장 가까운 상위 provenance pointer)와 project root 기준 fragment `sourcePath`, 또는 unmapped reason을 붙인다. 입력은 수정하지 않음 |
| `serializeRefProjectionArtifact()` | `cli/lib/ref-projection-artifact.ts` | ref projection artifact를 `oa-gen ref-projection`이 쓰는 2-space JSON + trailing newline으로 직렬화 |
| `validateRefProjectionArtifact()` | `cli/lib/ref-projection-artifact-schema.ts` | 값을 `REF_PROJECTION_ARTIFACT_SCHEMA_V1`(JSON Schema 2020-12, Ajv)로 검사해 schema issue 목록 반환. 빈 목록이면 적합 |
| `REF_PROJECTION_SCHEMA_VERSION` | `cli/lib/ref-projection-artifact.ts` | ref projection artifact format id `oa-sdk.ref-projection.v1` |
| `REF_PROJECTION_ARTIFACT_SCHEMA_V1` | `cli/lib/ref-projection-artifact-schema.ts` | `oa-sdk.ref-projection.v1` artifact JSON Schema 정본. 언어 중립 사본은 `docs/cli-spec/oa-sdk.ref-projection.v1.schema.json`이고 `check:cli-spec`이 drift를 검사 |
| `adaptZodSchemas()` | `cli/lib/source-adapters.ts` | Zod schema map을 OpenAPI source fragment로 변환 |
| `adaptDrizzleTables()` | `cli/lib/source-adapters.ts` | Drizzle table projection을 OpenAPI source fragment로 변환 |
| `adaptOpenApiProjectionEnvelope()` | `cli/lib/source-adapters.ts` | OpenAPI Projection envelope을 metadata 보존 source fragment로 변환 |
| `adaptPythonContractSpecSnapshot()` | `cli/lib/source-adapters.ts` | Python ContractSpec JSON snapshot을 runtime 의존 없이 source fragment로 변환 |
| `createBuiltInCodegenSourceAdapterRegistry()` | `cli/lib/source-adapters.ts` | Zod/Drizzle/Projection/Python의 유지보수 adapter를 명시 등록한 registry 생성 |
| `CodegenSourceAdapterRegistry` | `cli/lib/source-adapters.ts` | 애플리케이션이 신뢰한 source adapter를 명시 등록·호출하는 composition boundary |
| `zodSchemaSourceAdapter` | `cli/lib/source-adapters.ts` | maintained Zod source adapter object |
| `drizzleTableSourceAdapter` | `cli/lib/source-adapters.ts` | maintained Drizzle source adapter object |
| `openApiProjectionEnvelopeSourceAdapter` | `cli/lib/source-adapters.ts` | maintained Projection envelope source adapter object |
| `pythonContractSpecSnapshotSourceAdapter` | `cli/lib/source-adapters.ts` | maintained Python ContractSpec snapshot source adapter object |
| `buildParallelEvidence()` | `cli/lib/parallel-evidence.ts` | TypeSpec authority artifact와 명시 implementation adapter를 exact OpenAPI pointer로 join |
| `buildParallelEvidenceFromArtifacts()` | `cli/lib/parallel-evidence.ts` | unknown artifact pair를 TypeSpec parser와 selected implementation adapter로 parse한 뒤 join |
| `createParallelEvidenceMetrics()` | `cli/lib/parallel-evidence.ts` | joined evidence의 deterministic coverage/relation/shape metric 생성 |
| `createParallelEvidenceMetricDelta()` | `cli/lib/parallel-evidence.ts` | baseline/current metric의 stable numeric delta 생성 |
| `createParallelEvidenceReport()` | `cli/lib/parallel-evidence.ts` | evidence와 optional baseline을 durable report envelope으로 구성 |
| `parseTypeSpecRefProvenance()` | `cli/lib/parallel-evidence.ts` | TypeSpec contract provenance boundary parser |
| `parseTtscContractProvenance()` | `cli/lib/parallel-evidence.ts` | maintained ttsc implementation provenance boundary parser |
| `parseParallelEvidenceMetrics()` | `cli/lib/parallel-evidence.ts` | metric 또는 prior report에서 metric snapshot을 읽는다 |
| `ttscContractProvenanceAdapter` | `cli/lib/parallel-evidence.ts` | oa-gen CLI가 기본으로 사용하는 maintained ttsc implementation adapter |
| `PARALLEL_EVIDENCE_SCHEMA_VERSION` | `cli/lib/parallel-evidence.ts` | review-only parallel evidence envelope schema version |
| `PARALLEL_EVIDENCE_METRICS_SCHEMA_VERSION` | `cli/lib/parallel-evidence.ts` | deterministic parallel evidence metric schema version |
| `PARALLEL_EVIDENCE_REPORT_SCHEMA_VERSION` | `cli/lib/parallel-evidence.ts` | baseline-capable parallel evidence report schema version |
| `createOpenApiGovernanceInterface()` | `cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스용 artifact interface(`oa-gen.openapi-governance.v2`), 독립 CLI/CI baseline payload 생성 |
| `scaffoldOpenApiGovernance()` | `cli/lib/openapi-governance-scaffold.ts` | 서비스 root에 `openapi-governance.config.json`, `scripts/openapi-governance.sh`, `openapi-governance.md`와 contracts/scripts/src 디렉토리를 생성 |
| `formatScaffoldResult()` | `cli/lib/openapi-governance-scaffold.ts` | scaffold 결과의 root 디렉토리와 생성 파일 목록을 사용자 친화 텍스트로 렌더링 |
| `fingerprintGovernanceConfig()` | `cli/lib/openapi-governance-scaffold.ts` | profile/source/artifacts/consumers를 안정 정렬 후 sha256 16자로 해시. rendered 스크립트와 config drift 감지에 사용 |
| `createApitomyReferenceAdapter()` | `apitomy/index.ts` | 주입된 Apitomy Library를 비권위적 JSON/YAML I/O, validation 비교, OAS 3.x → oa-sdk IR probe로 연결 |
| `createApitomyReferenceAdapterFromModule()` | `apitomy/index.ts` | Apitomy 모듈의 named/default Library export를 reference adapter로 래핑 |
| `loadApitomyDataModels()` | `apitomy/index.ts` | optional `@apitomy/data-models`를 동적으로 로드하고 미설치 시 actionable error를 반환 |
| `APITOMY_DATA_MODELS_PACKAGE` | `apitomy/index.ts` | optional Apitomy package specifier 상수 |
| `APITOMY_REFERENCE_ADAPTER_VERSION` | `apitomy/index.ts` | reference 비교 리포트의 adapter contract version |
| `auditShapeCommand` | `cli/commands/audit-shape.ts` | TypeScript AST 타입 형태 분류 및 TypeSpec/OpenAPI 투영 가능성 진단 감사 CLI 커맨드 |
| `auditShapeFiles()` | `cli/lib/audit-shape-files.ts` | 지정된 경로 내 TypeScript 소스 파일들의 타입 형태를 감사하여 진단 리포트 생성 |
| `extractWireSchemaFromOas()` | `wire-adapter/wire-schema-extractor.ts` | TypeSpec/OAS 스펙에서 canonical WireSchemaModel IR 추출 및 1-based 자동 인덱싱 fallback |
| `TypeSpecWirePipeline` | `wire-adapter/typespec-wire-pipeline.ts` | TypeSpec SSOT 기반 플러그형 wire 타겟 변환 파이프라인 클래스 |
| `typeSpecWirePipeline` | `wire-adapter/typespec-wire-pipeline.ts` | TypeSpec wire 변환 파이프라인 기본 싱글톤 인스턴스 |
| `Proto3TargetAdapter` | `wire-adapter/adapters/proto3-target-adapter.ts` | Protocol Buffers v3 (.proto) 스키마 생성 타겟 어댑터 |
| `ProtobufCodecTargetAdapter` | `wire-adapter/adapters/protobuf-codec-target-adapter.ts` | Zero-eval CSP 준수 순수 TypeScript Protobuf 바이너리 코덱 생성 어댑터. `Proto3TargetAdapter`의 .proto와 같은 wire format(중첩 message, enum 번호, map, packed repeated, 64-bit, JSON fallback) |
| `RpcContractTargetAdapter` | `wire-adapter/adapters/rpc-contract-target-adapter.ts` | 서비스 핸들러 계약과, 선언된 route·파라미터를 채우고 `BinaryCodecAdapter`로 Protobuf/MessagePack 메시지를 인코딩·디코딩하는 클라이언트(`WireRpcError`) 생성 어댑터 |
| `generateRpcModule`, `RpcModuleOptions` | `rpc/generate-rpc-module.ts` | Surface IR RPC contract → `<Name>Procedures` 타입 맵과 `<name>Contract` 데이터 TypeScript module |
| `MessagePackTargetAdapter` | `wire-adapter/adapters/messagepack-target-adapter.ts` | MessagePack 바이너리 통신 코덱 바인딩 생성 어댑터 |
| `defineTspConfig()` | `plugin/config.ts` | TypeSpec SSOT 빌드 파이프라인 설정 정의 헬퍼 |
| `validateTspConfig()` | `plugin/config.ts` | TypeSpec 설정 객체 유효성 검증 및 기본값 정규화 |
| `sortPlugins()` | `plugin/sorter.ts` | Kahn 알고리즘 기반 플러그인 위상 정렬 편의 함수 |
| `sortPluginEntries()` | `plugin/sorter.ts` | 플러그인 의존성 DAG 위상 정렬 및 순환 참조/누락 검증 |
| `compileTypeSpecInMemory()` | `plugin/compiler.ts` | 디스크 파일 생성 없는 TypeSpec 인메모리 컴파일 및 OAS 3.2 추출 |
| `resolveTypeSpecEntrypoint()` | `plugin/compiler.ts` | TypeSpec 파일 또는 프로젝트 디렉터리 엔트리포인트 절대 경로 해결 |
| `createPluginContext()` | `plugin/context.ts` | TspPluginContext 인스턴스 팩토리 함수 |
| `normalizeVirtualPath()` | `plugin/context.ts` | 가상 파일 상대 POSIX 경로 정규화 |
| `formatEsmImportExtension()` | `plugin/context.ts` | ESM 임포트용 .js 확장자 치환 |
| `TspPluginContextImpl` | `plugin/context.ts` | 가상 파일 시스템 및 플러그인 실행 컨텍스트 구현 클래스 |
| `runTspPluginPipeline()` | `plugin/runner.ts` | TypeSpec 플러그인 4단계 라이프사이클 실행 및 파일 방출 오케스트레이터 |
| `pluginTypescript()` | `plugin/plugins/typescript.ts` | 순수 TypeScript 모델, 열거형 및 타입 가드 생성 플러그인 |
| `pluginClient()` | `plugin/plugins/client.ts` | openapi-ts 스타일 단일 객체 인자 및 판별 유니온 클라이언트 SDK 생성 플러그인 |
| `pluginSdk()` | `plugin/plugins/client.ts` | pluginClient의 표준 명칭 별칭 |
| `pluginTanstackQuery()` | `plugin/plugins/tanstack-query.ts` | TanStack Query v5 3-Tier(Keys, Options, Hooks) 생성 플러그인 |
| `pluginRouter()` | `plugin/plugins/router.ts` | 서버 프레임워크 핸들러 계약 및 라우터 바인딩 생성 플러그인 |
| `pluginWire()` | `plugin/plugins/wire.ts` | Zero-eval Protobuf 및 바이너리 코덱 바인딩 생성 플러그인 |
| `pluginRpc()` | `plugin/plugins/rpc.ts` | TypeSpec 계약의 RPC procedure 타입 맵과 contract 데이터 module 생성 플러그인 |
| `TspPluginError` | `plugin/types.ts` | TypeSpec 플러그인 엔진 공통 에러 기본 클래스 |
| `TspPluginCycleError` | `plugin/types.ts` | 플러그인 간 순환 의존성 감지 시 발생하는 에러 |
| `TspPluginMissingDependencyError` | `plugin/types.ts` | 필수 선행 플러그인 누락 시 발생하는 에러 |
| `TspPluginDuplicateError` | `plugin/types.ts` | 중복 플러그인 이름 등록 시 발생하는 에러 |
| `TspFileConflictError` | `plugin/types.ts` | 동일 가상 파일 경로 충돌 시 발생하는 에러 |
| `TspConfigValidationError` | `plugin/types.ts` | TypeSpec 파이프라인 설정 유효성 검증 실패 에러 |
| `TspProjectBuilder` | `plugin/builder.ts` | TypeSpec 프로젝트 고수준 프로그래머블 빌더 플랫폼 클래스 |
| `createTspBuilder()` | `plugin/builder.ts` | TypeSpec 프로젝트 빌더 인스턴스 생성 팩토리 함수 |
| `vitePluginTsp()` | `plugin/vite.ts` | TypeSpec 빌더 Vite/개발 서버 통합 플러그인 |
| `SPEC_TRACEABILITY_SCHEMA_VERSION` | `traceability/spec-traceability.ts` | 스펙 추적성 그래프 사이드카 스키마 버전 상수 (`oa-sdk.spec-traceability.v1`) |
| `DEFAULT_TRACE_SIDECAR_FILENAME` | `traceability/spec-traceability.ts` | 기본 추적성 사이드카 파일명 상수 (`.oa-trace.json`) |
| `buildSpecTraceabilityGraph()` | `traceability/spec-traceability.ts` | OpenAPI 3.2 스펙과 TypeSpec AST/Definition Builder provenance/매니페스트를 결합해 엔드투엔드 추적성 그래프 생성 |
| `toTypegenProvenanceMap()` | `traceability/spec-traceability.ts` | 추적성 그래프에서 `generateTypes`의 JSDoc provenance 옵션용 맵 추출 |
| `querySpecTrace()` | `traceability/spec-traceability.ts` | pointer, symbol, canonicalId, trackingId, sourceFile, requirement, persona 등 다중 조건으로 추적 노드 질의 |
| `analyzeSpecImpact()` | `traceability/spec-traceability.ts` | 스펙 정의 변경 시 역방향 `$ref` 그래프(`referencedBy`)를 따라 전이적 영향 범위(Blast Radius) 분석 |
| `serializeSpecTraceabilityGraph()` | `traceability/spec-traceability.ts` | 추적성 그래프를 결정론적 JSON 문자열로 직렬화 |
| `saveSpecTraceabilitySidecar()` | `traceability/spec-traceability.ts` | `.oa-trace.json` 추적성 사이드카 파일 저장 |
| `loadSpecTraceabilitySidecar()` | `traceability/spec-traceability.ts` | `.oa-trace.json` 추적성 사이드카 파일 로드 및 스키마 버전 검증 |
| `formatSpecTraceabilityHumanReport()` | `traceability/spec-traceability.ts` | 추적 노드 및 영향도 분석 결과를 터미널용 리포트로 포맷팅 |
| `traceCommand` | `cli/commands/trace.ts` | `oa-gen trace` 스펙 정의 추적성 및 영향도 분석 CLI 커맨드 |

### 타입 (`@oa-sdk/codegen`)

| 타입 | 파일 | 용도 |
|------|------|------|
| `OutputOptions` | `types.ts` | YAML 출력 옵션 (output, grouping, merge) |
| `NamedSchema` | `types.ts` | `{ name, schema }` — writer 입력 |
| `CodegenResult` | `types.ts` | `{ components, files, warnings }` |
| `CodegenConfig` | `config.ts` | `OutputOptions & { schemas }` |
| `OaConfig` | `config.ts` | oa.config.ts 최상위 설정 인터페이스 |
| `ProfileTargetConfig` | `config.ts` | 프로파일 기반 산출물 생성 타겟 설정 |
| `GuardTargetConfig` | `config.ts` | 독립형 타입 가드 생성 타겟 설정 |
| `ConfigValidationError` | `config.ts` | oa.config 유효성 검증 오류 항목 |
| `ConfigValidationResult` | `config.ts` | oa.config 유효성 검증 결과 (valid, errors) |
| `ResolvedOaConfig` | `config.ts` | 기본값이 적용되어 완전히 해결된 OaConfig 타입 |
| `ArtifactKind` | `config.ts` | 생성 산출물 종류 유니언 타입 ('contract' \| 'client' \| 'queries' \| 'keys' \| 'guards' \| 'schemas') |
| `OutputRoutingRule` | `config.ts` | 조건부 산출물 라우팅 규칙 인터페이스 |
| `ByKindRoutingConfig` | `config.ts` | 산출물 종류별 출력 경로 매핑 구성 인터페이스 |
| `OutputRoutingConfig` | `config.ts` | 산출물 라우팅 전체 설정 인터페이스 (pattern, rules, byKind) |
| `CasingStyle` | `routing/token-resolver.ts` | 토큰 케이싱 스타일 유니언 ('kebab' \| 'camel' \| 'pascal' \| 'preserve') |
| `TokenContext` | `routing/token-resolver.ts` | 패턴 치환을 위한 토큰 컨텍스트 인터페이스 |
| `ResolveTokenOptions` | `routing/token-resolver.ts` | 토큰 해결 옵션 인터페이스 |
| `ParsedTsconfig` | `routing/import-resolver.ts` | 파싱된 tsconfig.json 컴파일러 옵션 인터페이스 |
| `ResolveImportOptions` | `routing/import-resolver.ts` | 상대 import 경로 해결 옵션 인터페이스 |
| `ManifestArtifact` | `routing/manifest-manager.ts` | 매니페스트에 기록되는 산출물 메타데이터 인터페이스 |
| `OaManifest` | `routing/manifest-manager.ts` | .oa-manifest.json 매니페스트 파일 스키마 인터페이스 |
| `WriteArtifactInput` | `routing/manifest-manager.ts` | 매니페스트 관리자 파일 작성 입력 인터페이스 |
| `WriteArtifactResult` | `routing/manifest-manager.ts` | 파일 작성 및 변경 감지 결과 인터페이스 |
| `PruneOrphansOptions` | `routing/manifest-manager.ts` | 고아 파일 정리 옵션 인터페이스 (dry run, 빈 디렉터리 정리 기준, 정리 대상 기록 범위 `scope`) |
| `PruneSkippedEntry` | `routing/manifest-manager.ts` | 3-Gate 검증 실패로 정리가 건너뛰어진 파일 항목 |
| `PruneResult` | `routing/manifest-manager.ts` | 고아 파일 정리 실행 결과 인터페이스 |
| `DispatchPathOptions` | `routing/path-dispatcher.ts` | 산출물 경로 디스패치 옵션 인터페이스 |
| `DispatchedArtifactPath` | `routing/path-dispatcher.ts` | 디스패치된 산출물의 상대/절대 경로 및 메타데이터 결과 인터페이스 |
| `LoadOaConfigOptions` | `cli/lib/config-loader.ts` | 설정 파일 로드 옵션 (cwd, configFile) |
| `LoadedOaConfig` | `cli/lib/config-loader.ts` | 로드된 OaConfig 및 해결된 파일 경로 |
| `ResolvedProfileTarget` | `cli/lib/config-loader.ts` | 절대 경로가 해결된 프로파일 타겟 |
| `ResolvedGuardTarget` | `cli/lib/config-loader.ts` | 절대 경로가 해결된 가드 타겟 |
| `FindProjectRootOptions` | `@oa-sdk/core` re-export | 프로젝트 루트 탐색 옵션 re-export |
| `GenerateZodOptions` | `zodgen/generate-zod.ts` | Zod 4 코드 생성 옵션 (exportTypes, banner, targetVersion 등) |
| `Zod4AlgebraOptions` | `zodgen/schema-to-zod.ts` | Zod 4 fold 대수 옵션 |
| `ASTDiff` | `ast-sync/diff-engine.ts` | 소스 코드와 EntitySpec 간의 단일 AST 차이 항목 |
| `ASTDiffKind` | `ast-sync/diff-engine.ts` | AST 차이 종류 (`add-property`, `remove-property`, `modify-property` 등) |
| `EntityDiscriminator` | `ast-sync/types.ts` | 엔티티 판별자 필드 명세 |
| `EntityKind` | `ast-sync/types.ts` | 엔티티 종류 ('interface', 'type-alias', 'zod-schema' 등) |
| `EntityPropertySpec` | `ast-sync/types.ts` | 엔티티 단일 속성 명세 |
| `EntitySpec` | `ast-sync/types.ts` | 소스-스키마 양방향 동기화를 위한 언어 독립적 엔티티 명세 IR |
| `PropertyConstraint` | `ast-sync/types.ts` | 속성 유효성 검증 제약조건 명세 |
| `SyncOptions` | `ast-sync/index.ts` | 소스 코드 AST 동기화 옵션 |
| `SyncResult` | `ast-sync/index.ts` | 소스 코드 AST 동기화 결과 (modifiedCode, textEdits) |
| `TextEdit` | `ast-sync/text-edit.ts` | 역오프셋 기반 텍스트 편집 단위 (start, end, newText) |
| `TypeAdapter` | `ast-sync/adapters/type-adapter.ts` | AST 구문 분석 및 코드 생성 TypeAdapter 인터페이스 |
| `GeneratedGuardArtifact` | `standalone-guards/index.ts` | 생성된 독립형 타입 가드 아티팩트 (targetName, source, outputPath) |
| `StandaloneGuardGeneratorOptions` | `standalone-guards/index.ts` | 독립형 타입 가드 생성 옵션 |
| `StandaloneGuardTarget` | `standalone-guards/index.ts` | 독립형 타입 가드 대상 스펙 및 출력 경로 설정 |
| `SchemaPipelineRunOptions` | `schema-pipeline/types.ts` | 4-Stage Transparent Schema Lifecycle Pipeline 실행 옵션 |
| `SchemaPipelineTransparencyManifest` | `schema-pipeline/types.ts` | 4-Stage Transparent Schema Lifecycle Pipeline 실행 결과 매니페스트 |
| `SchemaStage1ZodInfo` | `schema-pipeline/types.ts` | 4-Stage Pipeline Stage 1 (Zod Master Schema) 정보 |
| `SchemaStage2JsonSchemaInfo` | `schema-pipeline/types.ts` | 4-Stage Pipeline Stage 2 (JSON Schema Draft 2020-12) 정보 |
| `SchemaStage3OpenApiInfo` | `schema-pipeline/types.ts` | 4-Stage Pipeline Stage 3 (OpenAPI 문서, 버전은 `specVersion`) 정보 |
| `SchemaStage4GuardInfo` | `schema-pipeline/types.ts` | 4-Stage Pipeline Stage 4 (AJV Standalone Type Guards) 정보 |
| `DrizzleCodegenOptions` | `drizzle/index.ts` | `OutputOptions & { schemaPath, ... }` |
| `OasSchema` | **`@oa-sdk/parser` re-export** | codegen이 parser 정식 타입 사용 |
| `TypegenOptions` | `typegen/generate-types.ts` | public typegen 옵션. `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen`에서 모두 export |
| TypegenOptions | `typegen/browser.ts` | 브라우저 안전 subentry의 typegen 옵션. banner/style/includeAnnotations/refNameOverrides만 지원하며 basePath 외부 ref 분석 옵션은 포함하지 않음 |
| `SchemaToTsOptions` | `typegen/schema-to-ts.ts` | public `schemaToTs()` 옵션. `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen`에서 모두 export |
| `SchemaToTsProjection` | `typegen/schema-fidelity.ts` | 생성 TypeScript 문자열과 전체 fidelity 분석을 결합한 projection 결과 |
| `TypegenFidelity` | `typegen/schema-fidelity.ts` | exact, runtime-only, safe-widening, unsafe-narrowing, unsupported 의미 보존 등급 |
| `TypegenFidelityAnalysis` | `typegen/schema-fidelity.ts` | 최종 fidelity, pointer 진단, 등급별 count를 담는 결정적 분석 결과 |
| `TypegenFidelityDiagnostic` | `typegen/schema-fidelity.ts` | RFC 6901 schema pointer와 제약·등급·메시지를 연결한 진단 |
| `TypegenFidelityDiagnosticCode` | `typegen/schema-fidelity.ts` | enum/format/composition/index-signature 등 fidelity 진단 code taxonomy |
| `TypeRegistry` | `type-registry.ts` | 파일 단위 교체·무효화와 5종 레코드 조회/snapshot을 제공하는 독립 타입 관리 경계 |
| `TypeRegistrySnapshot` | `type-registry.ts` | artifact/declaration/relation/boundary/exposure의 결정적 전체 snapshot |
| `TypeArtifactRecord` | `type-registry.ts` | 파일·패키지·runtime·authority/observation/derived 역할과 compiler/generator provenance 기록 |
| `TypeDeclarationRecord` | `type-registry.ts` | 선언 identity, source span, export 여부와 syntax/shape/semantic hash 및 canonical IR 기록 |
| `TypeRelationRecord` | `type-registry.ts` | type-ref/extends/import/reexport/generates/projects/entrypoint 관계와 resolution 상태 기록 |
| `TypeBoundaryRecord` | `type-registry.ts` | any/unknown/assertion/non-null/deserialize 경계와 validator/suppression 근거 기록 |
| `TypeExposureRecord` | `type-registry.ts` | package export key·export name·runtime별 type/value/mixed 노출 기록 |
| `TypeArtifactFilter` | `type-registry.ts` | artifact file/package/runtime/origin/role 조회 필터 |
| `TypeDeclarationFilter` | `type-registry.ts` | declaration symbol/kind/export/hash 조회 필터 |
| `TypeRelationFilter` | `type-registry.ts` | relation source/kind/target/specifier 조회 필터 |
| `TypeBoundaryFilter` | `type-registry.ts` | unsafe boundary file/kind 조회 필터 |
| `TypeExposureFilter` | `type-registry.ts` | exposure package/export/runtime/kind 조회 필터 |
| `ApitomyReferenceAdapter` | `apitomy/index.ts` | Apitomy document I/O, reference validation, oa-sdk lint/IR 비교 probe, optional transform 계약 |
| `ApitomyReferenceAdapterOptions` | `apitomy/index.ts` | OAS 3.2 reference boundary와 Apitomy NodePath 변환 hook 옵션 |
| `ApitomyReferenceCompareOptions` | `apitomy/index.ts` | oa-sdk primary validation과 Apitomy reference validation 비교 옵션 |
| `ApitomyReferenceComparison` | `apitomy/index.ts` | oa-sdk primary, Apitomy reference, 일치/차이 진단을 함께 담는 비교 결과 |
| `ApitomyReferenceDifferenceKind` | `apitomy/index.ts` | semantic match, provider-only, path mapping, unsupported reference, serialization loss 차이 분류 |
| `ApitomyReferenceDiagnosticDifference` | `apitomy/index.ts` | 분류된 primary/reference 진단 pair와 위치·메시지 |
| `ApitomyReferenceMetadata` | `apitomy/index.ts` | adapter/provider version, input hash, OAS version, capabilities 재현성 메타데이터 |
| `ApitomyReferenceSerialization` | `apitomy/index.ts` | source object 대비 reference serialization round-trip 확인 결과 |
| `ApitomyReferenceError` | `apitomy/index.ts` | optional dependency/capability/input/output/document reference 경계 오류 |
| `ApitomyReferenceErrorCode` | `apitomy/index.ts` | Apitomy reference probe 오류 taxonomy |
| `ApitomyReferenceModule` | `apitomy/index.ts` | Library와 optional ModelType를 포함한 동적 module shape |
| `ApitomyReferenceDocument` | `apitomy/index.ts` | Apitomy document object를 opaque reference 값으로 다루는 타입 |
| `ApitomyReferenceLibrary` | `apitomy/index.ts` | compile-time dependency 없이 필요한 Apitomy Library 최소 structural contract |
| `ApitomyReferenceValidationProblem` | `apitomy/index.ts` | Apitomy native validation problem의 reference shape |
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
| `SketchEmittedArtifacts` | `sketch-emitter/index.ts` | `emitSketchArtifacts()` 결과: 파싱한 IR, JSON Schema, OpenAPI, Mermaid, TypeScript·Python 스텁 |
| `TspExportDiagnosticSeverity` | `cli/lib/tsp-export.ts` | 현재 TypeSpec export diagnostic severity union |
| `OpenApiGovernanceInterface` | `cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스용 artifact interface(`oa-gen.openapi-governance.v2`) payload 타입 |
| `OpenApiGovernanceScaffoldOptions` | `cli/lib/openapi-governance-scaffold.ts` | scaffold root/service/profile/source-command/runtime URL/standalone oaGenCommand/typegen policy/force overwrite 옵션 |
| `OpenApiGovernanceScaffoldResult` | `cli/lib/openapi-governance-scaffold.ts` | scaffold 결과의 rootDir와 생성된 파일 절대 경로 목록 |
| `OpenApiGovernanceTypegenPolicy` | `cli/lib/openapi-governance-scaffold.ts` | `verify-only` 또는 `commit-required` generated TypeScript CI ownership 정책 |
| `ArtifactCompatibilityEntry` | `cli/lib/artifact-compatibility-policy.ts` | artifact별 current/supported schema, stability, deterministic migration 경로 |
| `ArtifactCompatibilityPolicyV1` | `cli/lib/artifact-compatibility-policy.ts` | OA SDK machine-readable artifact support window policy |
| `RefProjectionArtifact` | `cli/lib/ref-projection-artifact.ts` | `oa-sdk.ref-projection.v1` artifact: schemaVersion, generator, source spec/provenance identity, nodes, edges, diagnostics |
| `RefProjectionArtifactNode` | `cli/lib/ref-projection-artifact.ts` | 선언 또는 외부 참조 대상 노드 (id, kind, name, pointer, optional filePath, identity) |
| `RefProjectionArtifactEdge` | `cli/lib/ref-projection-artifact.ts` | `$ref` occurrence 하나의 엣지 (occurrence 위치 id, source/target 노드 id, recursion) |
| `RefProjectionArtifactDiagnostic` | `cli/lib/ref-projection-artifact.ts` | 진입 문서 기준 상대 파일 경로를 쓰는 projection 진단 (resolver 진단과 `ref-source-outside-nodes` / `ref-target-outside-nodes`) |
| `RefProjectionArtifactRecursion` | `cli/lib/ref-projection-artifact.ts` | 엣지 recursion 분류 `none` / `guarded` / `unguarded` |
| `RefProjectionArtifactSourceFile` | `cli/lib/ref-projection-artifact.ts` | artifact 입력 파일 identity (path, `sha256:` contentHash) |
| `RefProjectionArtifactGenerator` | `cli/lib/ref-projection-artifact.ts` | artifact를 만든 package name/version |
| `RefProjectionNodeIdentity` | `cli/lib/ref-projection-artifact.ts` | 노드의 `mapped`(canonicalId, provenancePointer, source path/pointer/hash) 또는 `unmapped`(reason) identity |
| `RefProjectionUnmappedReason` | `cli/lib/ref-projection-artifact.ts` | `external-document` / `provenance-not-supplied` / `no-enclosing-provenance-entry` |
| `CreateRefProjectionArtifactOptions` | `cli/lib/ref-projection-artifact.ts` | `createRefProjectionArtifact()` 입력 (document, entryPath, spec identity, optional provenance map + identity, generator) |
| `RefProjectionArtifactSchemaIssue` | `cli/lib/ref-projection-artifact-schema.ts` | `validateRefProjectionArtifact()`가 반환하는 instancePath/keyword/message |
| `CodegenSourceAdapter` | `cli/lib/source-adapters.ts` | source input을 normalized OpenAPI fragment로 만드는 application-owned adapter contract |
| `CodegenSourceAdapterOptions` | `cli/lib/source-adapters.ts` | source path/pointer/metadata 공통 adapter 옵션 |
| `CodegenSourceAdapterResult` | `cli/lib/source-adapters.ts` | source fragment와 adapter diagnostic 반환 envelope |
| `DrizzleTableSourceAdapterInput` | `cli/lib/source-adapters.ts` | Drizzle tables/schema types/naming을 묶은 registry adapter 입력 |
| `DrizzleTableSourceAdapterOptions` | `cli/lib/source-adapters.ts` | Drizzle source adapter 공통 옵션 alias |
| `OpenApiProjectionEnvelopeAdapterOptions` | `cli/lib/source-adapters.ts` | Projection envelope source adapter 공통 옵션 alias |
| `PythonContractSpecSnapshotAdapterOptions` | `cli/lib/source-adapters.ts` | Python ContractSpec snapshot source adapter 공통 옵션 alias |
| `ZodSchemaSourceAdapterOptions` | `cli/lib/source-adapters.ts` | Zod schema source adapter 공통 옵션 alias |
| `ImplementationProvenanceAdapter` | `cli/lib/parallel-evidence.ts` | trusted implementation extractor의 source id/provenance kind/parser composition contract |
| `ImplementationProvenanceArtifact` | `cli/lib/parallel-evidence.ts` | explicit emits/type-ref edge를 제공해야 하는 implementation provenance structural minimum |
| `ImplementationProvenanceDeclaration` | `cli/lib/parallel-evidence.ts` | implementation declaration AST kind/source span/optional projection shape |
| `ImplementationProvenanceEdge` | `cli/lib/parallel-evidence.ts` | implementation emits 또는 resolved type-ref edge |
| `ParallelEvidenceArtifactInput` | `cli/lib/parallel-evidence.ts` | joined source artifact의 role/schema/provenance/hash identity |
| `ParallelEvidenceDeclaration` | `cli/lib/parallel-evidence.ts` | contract 또는 implementation declaration의 review-safe normalized shape |
| `ParallelEvidenceMetricDeltaV1` | `cli/lib/parallel-evidence.ts` | baseline/current metric의 stable numeric delta envelope |
| `ParallelEvidenceMetricsV1` | `cli/lib/parallel-evidence.ts` | pointer/declaration/relation/shape trend metric schema |
| `ParallelEvidenceRelation` | `cli/lib/parallel-evidence.ts` | source-specific OpenAPI ref 또는 implementation type-ref relation |
| `ParallelEvidenceReportV1` | `cli/lib/parallel-evidence.ts` | joined evidence와 optional baseline metric delta report |
| `ParallelEvidenceRole` | `cli/lib/parallel-evidence.ts` | contract-authority 또는 implementation-observation source role |
| `ParallelEvidenceSourceRange` | `cli/lib/parallel-evidence.ts` | provenance source file line/column range |
| `ParallelEvidenceSubject` | `cli/lib/parallel-evidence.ts` | exact OpenAPI pointer로 조인된 declaration review subject |
| `ParallelEvidenceSubjectStatus` | `cli/lib/parallel-evidence.ts` | matched-pointer/contract-only/implementation-only subject status |
| `ParallelEvidenceV1` | `cli/lib/parallel-evidence.ts` | TypeSpec authority를 보존하는 review-only joined evidence envelope |
| `TtscContractProvenanceV2` | `cli/lib/parallel-evidence.ts` | maintained ttsc artifact structural contract |
| `TypeSpecWireTargetAdapter` | `wire-adapter/wire-adapter-types.ts` | 플러그형 wire 타겟 어댑터 인터페이스 |
| `WireTransformationResult` | `wire-adapter/wire-adapter-types.ts` | wire 변환 결과 인터페이스 |
| `TransformationBundle` | `wire-adapter/typespec-wire-pipeline.ts` | 다중 타겟 변환 번들 인터페이스 |
| `WireSchemaModel` | `wire-adapter/wire-schema-model.ts` | TypeSpec SSOT canonical wire 스키마 중간 표현(IR) |
| `WireModel` | `wire-adapter/wire-schema-model.ts` | wire 메시지 모델 메타데이터 인터페이스 |
| `WireField` | `wire-adapter/wire-schema-model.ts` | wire 메시지 필드 태그 인덱스 및 스칼라 타입 메타데이터 |
| `WireEnum` | `wire-adapter/wire-schema-model.ts` | wire 열거형 메타데이터 인터페이스 |
| `WireEnumMember` | `wire-adapter/wire-schema-model.ts` | wire 열거형 멤버 메타데이터 인터페이스 |
| `WireService` | `wire-adapter/wire-schema-model.ts` | wire RPC 서비스 메타데이터 인터페이스 |
| `WireMethod` | `wire-adapter/wire-schema-model.ts` | wire RPC 메서드 및 스트리밍 메타데이터 인터페이스 |
| `WireFieldKind`, `WireMapValue` | `wire-adapter/wire-schema-model.ts` | wire 필드 전송 형태(scalar·enum·message·map·json)와 map 값 타입 |
| `WireParameter`, `WireParameterLocation` | `wire-adapter/wire-schema-model.ts` | wire RPC 메서드의 path·query·header·cookie 파라미터 (path-level 병합, 미선언 route 변수 포함) |
| `WirePayload` | `wire-adapter/wire-schema-model.ts` | 요청 body와 성공 응답의 media type·참조 model 이름 |
| `ExtractorOptions` | `wire-adapter/wire-schema-extractor.ts` | wire 스키마 추출 옵션 인터페이스 |
| `Proto3AdapterOptions` | `wire-adapter/adapters/proto3-target-adapter.ts` | Proto3 스키마 생성 옵션 인터페이스 |
| `ProtobufCodecAdapterOptions` | `wire-adapter/adapters/protobuf-codec-target-adapter.ts` | Protobuf TS 코덱 생성 옵션 인터페이스 |
| `RpcContractAdapterOptions` | `wire-adapter/adapters/rpc-contract-target-adapter.ts` | RPC 계약 생성 옵션 인터페이스 |
| `MessagePackAdapterOptions` | `wire-adapter/adapters/messagepack-target-adapter.ts` | MessagePack 코덱 생성 옵션 인터페이스 |
| `TspPlugin` | `plugin/types.ts` | TypeSpec SSOT 플러그인 코어 인터페이스 (setup, transform, generate, emit) |
| `TspPluginContext` | `plugin/types.ts` | 가상 파일 시스템, AST 및 진단 채널을 제공하는 플러그인 실행 컨텍스트 |
| `TspGeneratedFile` | `plugin/types.ts` | 인메모리 가상 생성 파일 메타데이터 및 내용 인터페이스 |
| `TspPluginDiagnostic` | `plugin/types.ts` | 플러그인 실행 중 보고되는 진단 메시지 인터페이스 |
| `TspConfig` | `plugin/types.ts` | TypeSpec SSOT 플러그인 파이프라인 설정 인터페이스 |
| `TspConfigInput` | `plugin/types.ts` | TypeSpec 입력 경로 또는 상세 설정 객체 유니온 |
| `TspConfigInputObject` | `plugin/types.ts` | TypeSpec 엔트리포인트 및 프로젝트 디렉터리 설정 객체 |
| `TspPluginEntry` | `plugin/types.ts` | 플러그인 단독 또는 튜플 옵션 등록 엔트리 타입 |
| `NormalizedPluginRegistration` | `plugin/sorter.ts` | 위상 정렬된 플러그인 정규화 등록 레코드 |
| `TypeSpecCompilerOptions` | `plugin/compiler.ts` | 인메모리 TypeSpec 컴파일러 옵션 인터페이스 |
| `TypeSpecCompilerResult` | `plugin/compiler.ts` | 인메모리 컴파일 결과 (Program, Document, routesCount) |
| `CreatePluginContextOptions` | `plugin/context.ts` | 플러그인 컨텍스트 생성 옵션 인터페이스 |
| `RunTspPluginPipelineOptions` | `plugin/runner.ts` | 파이프라인 러너 실행 오버라이드 옵션 인터페이스 |
| `TspPipelineResult` | `plugin/runner.ts` | 파이프라인 실행 결과 요약 인터페이스 |
| `PluginTypescriptOptions` | `plugin/plugins/typescript.ts` | TypeScript 모델 플러그인 옵션 인터페이스 |
| `PluginClientOptions` | `plugin/plugins/client.ts` | openapi-ts 클라이언트 SDK 플러그인 옵션 인터페이스 |
| `PluginTanstackQueryOptions` | `plugin/plugins/tanstack-query.ts` | TanStack Query v5 플러그인 옵션 인터페이스 |
| `PluginRouterOptions` | `plugin/plugins/router.ts` | 서버 라우터 및 계약 플러그인 옵션 인터페이스 |
| `PluginWireOptions` | `plugin/plugins/wire.ts` | 바이너리 코덱 바인딩 플러그인 옵션 인터페이스 |
| `PluginRpcOptions` | `plugin/plugins/rpc.ts` | RPC module 플러그인 옵션 (출력 경로, 이름, contract 투영 옵션) |
| `TspIntrospectedParameter` | `plugin/builder.ts` | TypeSpec 파라미터 인트로스펙션 메타데이터 |
| `TspIntrospectedResponse` | `plugin/builder.ts` | TypeSpec 응답 및 에러 상태 인트로스펙션 메타데이터 |
| `TspIntrospectedOperation` | `plugin/builder.ts` | TypeSpec 엔드포인트 연산 인트로스펙션 메타데이터 |
| `TspIntrospectedModelProperty` | `plugin/builder.ts` | TypeSpec 모델 속성 및 제약조건 인트로스펙션 메타데이터 |
| `TspIntrospectedModel` | `plugin/builder.ts` | TypeSpec 모델 스키마 인트로스펙션 메타데이터 |
| `TspIntrospectionReport` | `plugin/builder.ts` | TypeSpec 프로젝트 전체 종합 인트로스펙션 리포트 |
| `CreateTspBuilderOptions` | `plugin/builder.ts` | TspProjectBuilder 초기화 옵션 |
| `TspWatchEvent` | `plugin/builder.ts` | TypeSpec 감시 이벤트 페이로드 |
| `TspWatchOptions` | `plugin/builder.ts` | TypeSpec 빌더 감시 모드 옵션 |
| `TspWatcherHandle` | `plugin/builder.ts` | TypeSpec 파일 감시 제어 핸들 인터페이스 |
| `VitePluginTspOptions` | `plugin/vite.ts` | Vite TypeSpec 빌더 플러그인 설정 옵션 |
| `VitePluginTspResult` | `plugin/vite.ts` | Vite 호환 플러그인 구조체 인터페이스 |
| `TypegenProvenanceEntry` | `typegen/generate-types.ts` | 생성 TypeScript 코드 JSDoc에 주입할 스펙 출처/추적성 메타데이터 항목 |
| `SpecDefinitionKind` | `traceability/spec-traceability.ts` | 추적 대상 스펙 정의 종류 유니언 (`schema` \| `operation` \| `webhook` \| `parameter` \| `response` \| `requestBody` \| `header` \| `link` \| `callback` \| `securityScheme`) |
| `SpecTraceSourceOrigin` | `traceability/spec-traceability.ts` | 스펙 정의 원본 출처 종류 유니언 (`typespec-ast` \| `definition-fragment` \| `openapi-inline`) |
| `SpecTraceSourceCoordinates` | `traceability/spec-traceability.ts` | 스펙 정의의 원본 파일·포인터·심볼·라인/컬럼 소스 좌표 |
| `SpecTraceGovernanceCapabilities` | `traceability/spec-traceability.ts` | 스펙 정의에 결합된 persona, personaTraits, DPM projection, storageRef, behaviorRef, requirements 거버넌스 정보 |
| `SpecTraceArtifactKind` | `traceability/spec-traceability.ts` | 추적 대상 생성 코드 산출물 종류 유니언 (`ArtifactKind \| 'types'`) |
| `SpecTraceGeneratedArtifactMapping` | `traceability/spec-traceability.ts` | 스펙 정의로부터 파생된 생성 코드 아티팩트 종류·파일 경로·export 심볼 매핑 |
| `SpecTraceabilityNode` | `traceability/spec-traceability.ts` | 단일 스펙 정의의 엔드투엔드 추적성 노드 |
| `SpecTraceabilityEdgeKind` | `traceability/spec-traceability.ts` | 추적성 그래프 엣지 종류 유니언 (`references` \| `replaces` \| `emits-artifact`) |
| `SpecTraceabilityEdge` | `traceability/spec-traceability.ts` | 추적성 그래프 내 정의 간 참조/대체/아티팩트 방출 엣지 |
| `SpecTraceabilityDiagnosticCode` | `traceability/spec-traceability.ts` | 추적성 그래프 진단 코드 유니언 (`traceability/duplicate-tracking-id` \| `traceability/unresolved-ref` \| `traceability/unmapped-source`) |
| `SpecTraceabilityDiagnostic` | `traceability/spec-traceability.ts` | 추적성 그래프 무결성 진단 항목 |
| `SpecTraceabilitySummary` | `traceability/spec-traceability.ts` | 추적성 그래프 노드·엣지·출처 매핑·생성 심볼·진단 통계 요약 |
| `SpecTraceabilityGraph` | `traceability/spec-traceability.ts` | `oa-sdk.spec-traceability.v1` 스펙 정의 추적성 그래프 사이드카 엔벨로프 |
| `BuildSpecTraceabilityOptions` | `traceability/spec-traceability.ts` | `buildSpecTraceabilityGraph()` 입력 옵션 인터페이스 |
| `SpecTraceQuery` | `traceability/spec-traceability.ts` | `querySpecTrace()` 다중 조건 질의 필터 인터페이스 |
| `SpecImpactAnalysis` | `traceability/spec-traceability.ts` | `analyzeSpecImpact()` 전이적 역방향 영향도 분석(Blast Radius) 결과 인터페이스 |

### 내부 함수 (`@oa-sdk/codegen` — index 미노출)

| 함수 | 파일 | 용도 |
|------|------|------|
| `checkTypeSpecBundle()` | `cli/lib/typespec-bundle-check.ts` | `oa-sdk.typespec-bundle.v1` manifest를 TypeSpec compile, sidecar restore/re-extract, OpenAPI 3.2 validation, optional expected diff gate로 검증 |
| `parseTypeSpecBundleCheckArgs()` | `cli/lib/typespec-bundle-check.ts` | `typespec:bundle-check` wrapper CLI 인자를 shared bundle check 옵션으로 파싱 |
| `printTypeSpecBundleCheckSummary()` | `cli/lib/typespec-bundle-check.ts` | bundle check 결과를 human-readable summary와 optional diff Markdown으로 출력 |
| `createTypeSpecCompatibilitySidecarFromOpenApiExtensions()` | `cli/lib/typespec-oa-sdk-extensions.ts` | TypeSpec `@extension(...)`에서 emitted OpenAPI로 전달된 `oa-sdk.typespec-extensions.v5` `x-oa-sdk-*` metadata를 sidecar-equivalent restore entries로 변환 |
| `stripTypeSpecOpenApiExtensions()` | `cli/lib/typespec-oa-sdk-extensions.ts` | restore 전용 `x-oa-sdk-*` metadata를 최종 restored OpenAPI artifact에서 제거 |
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
| `ref-projection` | `packages/codegen/src/cli/commands/ref-projection.ts`, `packages/codegen/src/cli/lib/ref-projection-files.ts`, `packages/codegen/src/cli/lib/ref-projection-artifact.ts`, `packages/codegen/src/cli/lib/ref-projection-artifact-schema.ts`, `packages/codegen/src/cli/lib/provenance-report.ts` | OpenAPI YAML/JSON의 ref-preserving graph를 결정적인 `oa-sdk.ref-projection.v1` JSON artifact로 stdout 또는 `--output`에 쓰고, `--provenance`(build-spec provenance map)가 있으면 노드별 `canonicalId`를 붙인다. 출력은 쓰기 전에 schema로 검증하며 입력 누락·오류는 exit 1 |
| `normalize` | `packages/codegen/src/cli/commands/normalize.ts`, `packages/codegen/src/cli/lib/openapi-collect.ts` | 외부 OpenAPI 산출물의 의미를 바꾸지 않고 noise 제거, stable ordering, YAML anchor 제거를 적용해 diff 가능한 governance artifact를 생성한다 |
| `review` | `packages/codegen/src/cli/commands/review.ts`, `packages/codegen/src/cli/lib/review-report.ts`, `packages/codegen/src/cli/lib/artifact-review.ts`, `packages/codegen/src/cli/lib/review-sidecar-diff.ts`, `packages/codegen/src/cli/lib/review-markdown.ts`, `packages/codegen/src/cli/lib/review-policy.ts`, `packages/codegen/src/cli/lib/provenance-report.ts`, `packages/codegen/src/cli/lib/metadata-registry.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | base/head OpenAPI diff, validation, artifact freshness를 묶고 선택적으로 base/head provenance sidecar와 metadata registry sidecar 변경 entries를 report에 포함 |
| `review-bundle` | `packages/codegen/src/cli/commands/review-bundle.ts`, `packages/codegen/src/cli/lib/review-bundle.ts`, `packages/codegen/src/cli/lib/artifact-review.ts`, `packages/codegen/src/cli/lib/review-sidecar-diff.ts`, `packages/codegen/src/cli/lib/review-markdown.ts`, `packages/codegen/src/cli/lib/review-policy.ts`, `packages/codegen/src/cli/lib/provenance-report.ts`, `packages/codegen/src/cli/lib/metadata-registry.ts`, `packages/codegen/src/cli/lib/behavior-recorder.ts`, `packages/codegen/src/cli/lib/behavior-registry.ts` | base/head OpenAPI diff와 artifact freshness를 필수 section으로 묶고 선택적으로 inventory, runtime drift JSON, provenance diff, composition report JSON, metadata registry JSON, metadata registry diff, duplicate-review JSON을 stable nested section으로 포함하며 behavior JSONL/SQLite record를 append할 수 있다 |
| `scaffold-governance` | `packages/codegen/src/cli/commands/scaffold-governance.ts`, `packages/codegen/src/cli/lib/openapi-governance-scaffold.ts` | 외부 OpenAPI 서비스 루트에 config, script, docs, CI artifact/baseline workflow를 생성해 독립 실행 가능한 artifact interface를 표준화한다 |
| `target-check` | `packages/codegen/src/cli/commands/target-check.ts`, `packages/codegen/src/cli/lib/target-coverage.ts` | Definition Builder target config 또는 generated OpenAPI artifact의 emitted path surface를 include/exclude assertion으로 검증하고 실패 시 non-zero 종료 |
| `tsp-export` | `packages/codegen/src/cli/commands/tsp-export.ts`, `packages/codegen/src/cli/lib/tsp-export.ts`, `packages/codegen/src/cli/lib/typespec-sidecar.ts`, `packages/codegen/src/cli/lib/typespec-bundle-manifest.ts` | OpenAPI YAML/JSON artifact를 TypeSpec spike source, diagnostics JSON, optional OA SDK compatibility sidecar, optional bundle-local expected OpenAPI, optional `oa-sdk.typespec-bundle.v1` manifest로 변환 |
| `tsp-bundle-check` | `packages/codegen/src/cli/commands/tsp-bundle-check.ts`, `packages/codegen/src/cli/lib/typespec-bundle-check.ts`, `packages/codegen/src/cli/lib/typespec-bundle-manifest.ts`, `packages/codegen/src/cli/lib/typespec-sidecar.ts`, `packages/codegen/src/cli/lib/typespec-oa-sdk-extensions.ts` | authored/generated `oa-sdk.typespec-bundle.v1` manifest를 TypeSpec compile, sidecar 또는 `oa-sdk.typespec-extensions.v5`/`v2` metadata restore/re-extract stability, OpenAPI validation, optional expected diff gate로 검증 |
| `tsp-restore` | `packages/codegen/src/cli/commands/tsp-restore.ts`, `packages/codegen/src/cli/lib/typespec-sidecar.ts` | TypeSpec emitted OpenAPI artifact에 OA SDK compatibility sidecar를 재적용하고 restore report를 출력 |
| `upgrade` | `packages/codegen/src/cli/commands/upgrade.ts`, `packages/codegen/src/cli/lib/openapi-collect.ts` | normalized OpenAPI 3.0/3.1 artifact를 OpenAPI 3.2 analysis artifact로 파생하고 nullable 등 표현 변환 report를 남긴다 |

Governance manifest: `packages/codegen/src/cli/spec/oa-gen-governance.ts` 및 `docs/cli-spec/oa-gen.governance.json`.

---

## 어댑터 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `createNodeMockServer()` | `adapters/node-http.ts` | Node HTTP 목 서버 생성 |
| `NodeMockServer` | `adapters/node-http.ts` | Node 서버 인스턴스 타입 (override 포함) |
| `NodeMockServerOptions` | `adapters/node-http.ts` | Node 서버 옵션 타입 (port/host, server variables, route filter, request schema preflight, callback hook) |
| `OverrideResponse` | `adapters/node-http.ts` | override 응답 타입 |

## MSW 어댑터 (`@oa-sdk/mock-server/adapters/msw`, `@oa-sdk/mock-server/browser`)

`msw`는 optional peer라서 root entry point는 MSW 어댑터를 export하지 않는다. 아래 export는
`msw`가 설치된 consumer에서 `./adapters/msw`(Node, Vitest)와 `./browser`(browser bundle)로 import한다.

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `createMswHandlers()` | `adapters/msw.ts` | MSW 2.x 핸들러 배열 생성 |
| `createMswMockServer()` | `adapters/msw.ts` | MSW 핸들러 + override API 통합 |
| `MswHandlerOptions` | `adapters/msw.ts` | MSW 옵션 타입 (request hook, route filter, request schema preflight, callback hook) |
| `MswMockServer` | `adapters/msw.ts` | MSW mock 서버 타입 (handlers + override) |

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
| `MockReceivedValueSummary` | `errors/types.ts` | raw 입력을 포함하지 않는 type/length/count 진단 요약 |
| `MockErrorDetail` | `errors/types.ts` | 에러 상세 타입. received와 legacy value는 raw 입력 대신 안전한 요약만 제공 |
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

## 플러그인 (`@oa-sdk/mock-server`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `inMemoryStorePlugin()` | `plugins/in-memory-store.ts` | REST 컬렉션 CRUD 인메모리 상태 관리 플러그인 생성자 |
| `InMemoryStorePlugin` | `plugins/in-memory-store.ts` | 인메모리 스토어 플러그인 인터페이스 (컬렉션 조회 및 reset 지원) |
| `InMemoryStoreOptions` | `plugins/in-memory-store.ts` | 인메모리 스토어 초기 seed 및 ID 생성기 옵션 |
| `MockPlugin` | `core/plugin.ts` | Mock 서버 확장 플러그인 인터페이스 (onMatch, onResponse, reset) |
| `MockPluginContext` | `core/plugin.ts` | 플러그인 요청 실행 컨텍스트 |
| `MockPluginResponse` | `core/plugin.ts` | 플러그인 응답 구조체 |

---

## 함수 (`@oa-sdk/router`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `generateRouter()` | `generate-router.ts` | OAS spec → 서버 라우터 스텁 및 계약 바인딩 코드 (Hono, Express, Fastify, Elysia 지원) |
| `generateHandlerContract()` | `generate-router.ts` | OAS spec → 프레임워크 독립적인 순수 TypeScript 핸들러 계약 코드 (`*.contract.ts`) 생성 |
| `RouterTarget` | `generate-router.ts` | 대상 프레임워크 union 타입 (`'hono' \| 'express' \| 'fastify' \| 'elysia'`) |
| `RouterMode` | `generate-router.ts` | 라우터 렌더링 모드 union 타입 (`'stub' \| 'contract'`) |
| `RouterOptions` | `generate-router.ts` | 라우터 생성 옵션 타입 (RouterRenderOptions 확장, basePath 지원) |
| `RouterRenderOptions` | `generate-router.ts` | 플랫폼 중립 라우터 렌더러 옵션 인터페이스 (target, mode, typesImport, contractImport, contractName, banner) |
| `HandlerContractOptions` | `generate-router.ts` | 순수 핸들러 계약 생성 옵션 인터페이스 (typesImport, banner, contractName) |
| `generateCrdtRouter()` | `targets/crdt-router.ts` | CRDT 실시간 동기화 라우터 코드 생성 |
| `generateCrdtHandlerContract()` | `targets/crdt-router.ts` | CRDT 핸들러 계약 코드 생성 |
| `extractCrdtEntities()` | `targets/crdt-router.ts` | OAS 스키마에서 CRDT 엔터티 메타데이터 추출 |
| `CrdtRouterOptions` | `targets/crdt-router.ts` | CRDT 라우터 생성 옵션 인터페이스 |
| `CrdtContractOptions` | `targets/crdt-router.ts` | CRDT 핸들러 계약 생성 옵션 인터페이스 |
| `CrdtRouterTarget` | `targets/crdt-router.ts` | CRDT 라우터 대상 프레임워크 union 타입 |
| `CrdtEntityMeta` | `targets/crdt-router.ts` | CRDT 엔터티 메타데이터 인터페이스 |
| `CrdtFieldMeta` | `targets/crdt-router.ts` | CRDT 필드 메타데이터 인터페이스 |
| `demuxChunkStream()` | `chunk-stream.ts` | 청크 스트림 디멀티플렉싱 함수 |
| `DemuxChunkStreamOptions` | `chunk-stream.ts` | 청크 스트림 디멀티플렉싱 옵션 인터페이스 |
| `SyntheticEmptyChunk` | `chunk-stream.ts` | 합성 빈 청크 인터페이스 |
| `RouterCodecRegistry` | `codec/router-codec.ts` | 백엔드 binary wire 코덱 등록 및 content-type 해결 레지스트리 |
| `RouterCodecAdapter` | `codec/router-codec.ts` | 백엔드 binary 인코딩/디코딩 어댑터 인터페이스 |
| `negotiateResponseMediaType()` | `codec/router-codec.ts` | Accept 헤더 및 등록된 코덱 기반 응답 미디어 타입 협상 함수 |

---

## 함수 (`@oa-sdk/client`)

| 함수/타입 | 파일 | 용도 |
|-----------|------|------|
| `ClientConfig` | `client-types.ts` | 클라이언트 인스턴스 설정 인터페이스 (baseUrl, headers, middleware, timeout, retry, codecs 등) |
| `ClientError` | `error-contract.ts` | 클라이언트 HTTP 에러 클래스 (status, statusText, body, data, response) |
| `ClientMethodOptions` | `client-types.ts` | 개별 API 호출 메서드 옵션 타입 (signal, headers) |
| `ClientMiddleware` | `client-types.ts` | 클라이언트 미들웨어 인터페이스 (onRequest, onResponse, onError) |
| `ClientResponse` | `client-types.ts` | withResponse 호출 시 반환되는 래퍼 타입 (body, headers, response) |
| `BinaryCodecAdapter` | `codec/codec-types.ts` | 바이너리 직렬화/압축 코덱 어댑터 인터페이스 (mediaTypes, encode, decode) |
| `BinaryBodyInit` | `codec/codec-types.ts` | 바이너리 코덱이 반환하는 유선 페이로드 바디 타입 유니온 |
| `BinaryCodecRegistry` | `codec/codec-types.ts` | 미디어 타입 기반 바이너리 코덱 등록 및 해결 레지스트리 클래스 |
| `MessagePackAdapter` | `codec/adapters/messagepack-adapter.ts` | 0 의존성 순수 TypeScript MessagePack 바이너리 코덱 어댑터 클래스 |
| `messagePackAdapter` | `codec/adapters/messagepack-adapter.ts` | MessagePackAdapter 기본 싱글톤 인스턴스 |
| `encodeMessagePack()` | `codec/adapters/messagepack-adapter.ts` | JS 값 → MessagePack Uint8Array 바이너리 인코딩 함수 |
| `decodeMessagePack()` | `codec/adapters/messagepack-adapter.ts` | MessagePack Uint8Array/ArrayBuffer → JS 값 디코딩 함수 |
| `ProtobufAdapter` | `codec/adapters/protobuf-adapter.ts` | Protocol Buffers 직렬화/역직렬화 어댑터 클래스 |
| `createProtobufAdapter()` | `codec/adapters/protobuf-adapter.ts` | Typia AOT / protobufjs 호환 Protobuf 어댑터 팩토리 함수 |
| `ProtobufAdapterOptions` | `codec/adapters/protobuf-adapter.ts` | Protobuf 어댑터 생성 옵션 인터페이스 |
| `RawBinaryAdapter` | `codec/adapters/raw-binary-adapter.ts` | octet-stream 바이너리 패스스루 코덱 어댑터 클래스 |
| `createRawBinaryAdapter()` | `codec/adapters/raw-binary-adapter.ts` | 원시 바이너리 코덱 어댑터 팩토리 함수 |
| `apiKeyAuth()` | `client-types.ts` | API 키 인증 미들웨어 생성 팩토리 함수 |
| `basicAuth()` | `client-types.ts` | Basic 인증 미들웨어 생성 팩토리 함수 |
| `bearerAuth()` | `client-types.ts` | Bearer 토큰 인증 미들웨어 생성 팩토리 함수 |
| `isClientError()` | `error-contract.ts` | 멀티 렐름 지원 ClientError 덕 타이핑 타입 가드 함수 |
| `generateClient()` | `generate-client.ts` | OAS spec → fetch 기반 createClient() 코드. 기본 operation 메서드는 body 반환을 유지하고, 문서화된 응답 헤더가 있으면 generated typed response object를 반환하는 `withResponse.<operation>()` helper를 함께 생성 |
| `ClientOptions` | `generate-client.ts` | 클라이언트 생성 옵션 타입 |
| `generateTanstackQuery()` | `tanstack/generate-tanstack.ts` | OpenAPI 3.1/3.2 스펙으로부터 TanStack Query v5 3계층(Query Key Factory, Options Factory, Hooks) 코드 일괄 생성 |
| `generateKeyFactory()` | `tanstack/key-factory-generator.ts` | 0 의존성 계층형 쿼리 키 팩토리(userKeys.all, lists(), detail(id) 등) TypeScript 코드 생성 |
| `generateOptionsFactory()` | `tanstack/options-factory-generator.ts` | UI 프레임워크 락인 없는 순수 queryOptions() 및 mutationOptions() 팩토리 코드 생성 (SSR/Vue/Svelte 호환) |
| `generateHookFactory()` | `tanstack/hook-factory-generator.ts` | React composition hook 래퍼(useUserQuery, useUpdateUserMutation, createApiHooks) 코드 생성 |
| `isQueryOperation()` | `tanstack/key-factory-generator.ts` | HTTP 메서드 기반 Query vs Mutation 오퍼레이션 분류 헬퍼 |
| `getOperationTag()` | `tanstack/key-factory-generator.ts` | 오퍼레이션의 주 태그 추출 및 정규화 헬퍼 |
| `toKeyFactoryName()` | `tanstack/key-factory-generator.ts` | 태그명 기반 쿼리 키 팩토리 식별자 이름 생성 |
| `TanstackQueryOptions` | `tanstack/generate-tanstack.ts` | TanStack Query v5 코드 생성 옵션 인터페이스 |
| `TanstackQueryOutput` | `tanstack/generate-tanstack.ts` | 계층별(keys, queries, hooks, combined) 생성 코드 출력 인터페이스 |
| `KeyFactoryOptions` | `tanstack/key-factory-generator.ts` | 쿼리 키 팩토리 생성 옵션 인터페이스 |
| `OptionsFactoryOptions` | `tanstack/options-factory-generator.ts` | 옵션 팩토리 생성 옵션 인터페이스 |
| `HookFactoryOptions` | `tanstack/hook-factory-generator.ts` | 훅 팩토리 생성 옵션 인터페이스 |
| `JsonPrimitive<T>` | `wire-format.ts` | 유선 직렬화 응답 페이로드 재귀 유틸리티 타입 |
| `Resolved<T>` | `wire-format.ts` | 유선 직렬화 요청 바디 재귀 유틸리티 타입 |
| `generateCrdtClient()` | `crdt/generate-crdt-client.ts` | CRDT 클라이언트 SDK 코드 생성 |
| `generateCrdtClientFromParsed()` | `crdt/generate-crdt-client.ts` | 파싱된 엔터티 기반 CRDT 클라이언트 SDK 코드 생성 |
| `generateCrdtHooks()` | `crdt/generate-crdt-hooks.ts` | CRDT React Hooks 코드 생성 |
| `generateCrdtHooksFromParsed()` | `crdt/generate-crdt-hooks.ts` | 파싱된 엔터티 기반 CRDT React Hooks 코드 생성 |
| `extractCrdtEntitiesFromDoc()` | `crdt/crdt-metadata.ts` | OpenAPI 스펙에서 CRDT 엔터티 메타데이터 추출 |
| `CrdtClientRenderOptions` | `crdt/types.ts` | CRDT 클라이언트 렌더링 옵션 인터페이스 |
| `CrdtHooksRenderOptions` | `crdt/types.ts` | CRDT 훅 렌더링 옵션 인터페이스 |
| `CrdtConnectionStatus` | `crdt/types.ts` | CRDT 웹소켓 연결 상태 타입 |
| `CrdtEngineAdapter` | `crdt/types.ts` | CRDT 엔진 어댑터 인터페이스 |
| `CrdtEntityMeta` | `crdt/types.ts` | CRDT 엔터티 메타데이터 인터페이스 |
| `CrdtFieldMeta` | `crdt/types.ts` | CRDT 필드 메타데이터 인터페이스 |
| `CrdtWireMessage` | `crdt/types.ts` | CRDT 유선 메시지 인터페이스 |
| `CrdtWireMessageType` | `crdt/types.ts` | CRDT 유선 메시지 타입 열거형 |
| `LwwEntry` | `crdt/types.ts` | LWW 레지스터 엔트리 인터페이스 |
| `LwwJsonAdapter` | `crdt/types.ts` | LWW JSON 어댑터 인터페이스 |
| `LwwStateVector` | `crdt/types.ts` | LWW 상태 벡터 타입 |
| `LwwUpdatePayload` | `crdt/types.ts` | LWW 업데이트 페이로드 타입 |
| `createChunkStreamStore()` | `chunk-stream.ts` | 청크 스트림 스토어 생성 함수 |
| `createResilientChunkReader()` | `chunk-stream.ts` | 복원력 있는 청크 스트림 리더 생성 함수 |
| `createResilientNdjsonReader()` | `chunk-stream.ts` | 복원력 있는 NDJSON 스트림 리더 생성 함수 |
| `generateChunkStreamReactHooks()` | `chunk-stream.ts` | 청크 스트림 React Hooks 코드 생성 함수 |
| `retryAfterMs()` | `chunk-stream.ts` | 재시도 대기 시간 계산 헬퍼 |
| `synthesizeEmptyChunk()` | `chunk-stream.ts` | 합성 빈 청크 생성 헬퍼 |
| `ChunkFetchDescriptor` | `chunk-stream.ts` | 청크 페치 디스크립터 인터페이스 |
| `ChunkStreamReaderOptions` | `chunk-stream.ts` | 청크 스트림 리더 옵션 인터페이스 |
| `ChunkStreamState` | `chunk-stream.ts` | 청크 스트림 상태 타입 |
| `ChunkStreamStore` | `chunk-stream.ts` | 청크 스트림 스토어 인터페이스 |
| `FallbackChunkState` | `chunk-stream.ts` | 폴백 청크 상태 인터페이스 |
| `RuntimeChunkEnvelopeDescriptor` | `chunk-stream.ts` | 런타임 청크 엔벨로프 디스크립터 인터페이스 |

---

## 함수 (`@oa-sdk/core` — 공유 유틸)

| 함수 | 파일 | 용도 |
|------|------|------|
| `pascalCase()` | `strings.ts` | snake_case/kebab-case → PascalCase |
| `toTypeScriptIdentifier()` | `strings.ts` | 외부 문자열 → 안전한 TypeScript 식별자 |
| `createOperationTypeNameMap()` | `strings.ts` | operationId → 충돌 없는 타입 이름 맵 |
| `toOperationMethodName()` | `strings.ts` | operation 타입 이름 → lowerCamelCase SDK 메서드 이름 |
| `escapeKey()` | `strings.ts` | 비식별자 키 → 따옴표 이스케이프 |
| `quoteTypeScriptString()` | `strings.ts` | 제어 문자를 포함한 문자열 값을 안전한 TypeScript string literal로 이스케이프 |
| `toColonPath()` | `strings.ts` | `/users/{id}` → `/users/:id` |
| `collectTypeNames()` | `codegen-utils.ts` | operations → typegen 타입 이름 수집 (ResponseHeaders 포함) |
| `hasGeneratedErrorType()` | `codegen-utils.ts` | 4xx/5xx/default JSON error body의 typegen 생성 여부 판정 |
| `getGeneratedErrorResponseKeys()` | `codegen-utils.ts` | typegen/client가 공유하는 문서화된 JSON error response status key 수집 |
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
| `findProjectRoot()` | `root.ts` | 6단계 우선순위 기반 상향식 프로젝트 루트 디렉터리 자동 탐색 |
| `findProjectRootDetail()` | `root.ts` | 매칭된 마커 및 탐색 이유(RootResolutionReason)를 포함한 상세 루트 정보 반환 |
| `DEFAULT_CONFIG_FILES` | `root.ts` | 기본 설정 파일 마커 목록 (`oa.config.ts`, `.oarc.json` 등) |
| `DEFAULT_WORKSPACE_FILES` | `root.ts` | 기본 모노레포 워크스페이스 마커 목록 (`pnpm-workspace.yaml`, `turbo.json` 등) |
| `DEFAULT_VCS_DIRS` | `root.ts` | 기본 버전 관리 마커 목록 (`.git` 등) |
| `DEFAULT_ENV_VAR_NAME` | `root.ts` | 환경 변수 오버라이드 기본 식별자 ('OA_PROJECT_ROOT') |

### 타입 (`@oa-sdk/core`)

| 타입 | 파일 | 용도 |
|------|------|------|
| `FindProjectRootOptions` | `root.ts` | 프로젝트 루트 탐색 옵션 (cwd, markers, checkParent, envVarName) |
| `ProjectRootMarkers` | `root.ts` | 커스텀 설정/워크스페이스/VCS 마커 구성 인터페이스 |
| `ProjectRootDetail` | `root.ts` | 매칭된 마커 및 탐색 이유(RootResolutionReason)를 포함한 상세 루트 정보 |
| `RootResolutionReason` | `root.ts` | 루트 식별 이유 union ('env' \| 'config' \| 'workspace' \| 'vcs' \| 'cwd-fallback') |
| `JsonPrimitive<T>` | `wire-format.ts` | 엄격한 JSON 유선 직렬화 재귀 유틸리티 타입 (함수/메서드/심볼/프로토타입 제거, Date → string, toJSON() 해결) |
| `Resolved<T>` | `wire-format.ts` | 클래스 메서드를 제거하면서 Date/Set/Map을 보존하는 유선 유틸리티 타입 |
| `ValueOf<T>` | `wire-format.ts` | 박싱된 프리미티브 타입을 언박싱하고 리터럴을 보존하는 유틸리티 타입 |
| `ClassProperties<T>` | `wire-format.ts` | 클래스/객체에서 메서드/함수를 제외하고 데이터 프로퍼티만 추출하는 타입 |

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

---

## AST 동기화와 독립 검증기 (`@oa-sdk/ast-sync`)

EntitySpec IR과 소스 코드의 동기화, 타입 어댑터, shape 분류 및 독립 검증기 생성 API다. `./guards` subpath는 아래 guard 생성 API를 별도로 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `EntityKind`, `EntitySpec`, `EntityPropertySpec`, `EntityDiscriminator`, `PropertyConstraint` | `ast-sync/src/entity-spec.ts` | 엔터티·속성 IR |
| `TextEdit`, `ASTDiff`, `ASTDiffKind` | `ast-sync/src/entity-spec.ts` | 텍스트 편집과 AST 차이 계약 |
| `TypeAdapter` | `ast-sync/src/adapter-interface.ts` | 타입 어댑터 공통 계약 |
| `computeEntitySpecDiff` | `ast-sync/src/diff-engine.ts` | EntitySpec 간 구조 차이 계산 |
| `createInsertEdit`, `createReplaceEdit`, `createDeleteEdit`, `applyTextEdits` | `ast-sync/src/text-edit.ts` | 역방향 offset 기반 텍스트 편집 생성·적용 |
| `SyncOptions`, `SyncResult`, `syncEntitySpecWithCode` | `ast-sync/src/type-sync.ts` | 소스와 EntitySpec의 동기화 옵션·결과·실행 |
| `ZodTypeAdapter` | `ast-sync/src/adapters/zod.ts` | Zod 소스 타입 어댑터 |
| `TsAstTypeAdapter` | `ast-sync/src/adapters/ts-ast.ts` | TypeScript AST 타입 어댑터 |
| `TypiaAdapterOptions`, `TYPIA_TAG_NAMES`, `TYPIA_TYPE_TAG_NAMES`, `TypiaTypeAdapter` | `ast-sync/src/adapters/typia.ts` | Typia 태그와 타입 어댑터 |
| `JsonSchemaObject`, `JsonSchemaTypeAdapter` | `ast-sync/src/adapters/json-schema.ts` | JSON Schema 타입 어댑터와 스키마 계약 |
| `generateStandaloneGuards`, `StandaloneGuardTarget`, `StandaloneGuardGeneratorOptions`, `GeneratedGuardArtifact` | `ast-sync/src/guards/index.ts` | 독립 검증기 생성과 산출물 계약 |
| `ContractShapeFeature`, `TypeSpecProjection`, `ContractTypeShape`, `ShapeDiagnostic`, `ShapeAuditResult` | `ast-sync/src/taxonomy/features.ts` | TypeSpec 투영 가능성 및 shape 진단 계약 |
| `DIRECT_SHAPE_FEATURES`, `POLICY_REQUIRED_SHAPE_FEATURES`, `UNSUPPORTED_SHAPE_FEATURES`, `DIRECT_FEATURES`, `POLICY_REQUIRED_FEATURES`, `UNSUPPORTED_FEATURES`, `ALL_SHAPE_FEATURES`, `UTILITY_TYPE_NAMES` | `ast-sync/src/taxonomy/features.ts` | 직접 지원·정책 필요·미지원 feature 집합 |
| `AnalyzeShapeOptions`, `classifyTypeShape`, `collectShapeFeatures`, `analyzeNodeShape`, `auditTypeShapesInSource`, `getDeclarationShapesInSource`, `extractDeclarationShape` | `ast-sync/src/taxonomy/analyzer.ts` | 타입 shape 추출·분류·소스 감사 |
| `createVirtualProgram`, `createInMemoryProgram`, `createProgramFromTsconfig`, `cleanupProgram`, `getTypeChecker` | `ast-sync/src/checker/program.ts` | 가상·tsconfig 기반 TypeScript Program 수명 관리 |
| `getCanonicalSymbolId`, `resolveAlias`, `referencedSymbols`, `getNormalizedDeclarationId` | `ast-sync/src/checker/cycle-detector.ts` | 심볼 식별·별칭 해결·참조 조회 |
| `SymbolCycleResult`, `cyclicSchemaIds`, `withRecursiveReference`, `markRecursiveDeclaration`, `detectCyclesWithChecker` | `ast-sync/src/checker/cycle-detector.ts` | 순환 참조 감지 및 shape 표기 |
| `ContractCanaryOptions`, `ContractCanaryReport`, `FrictionSignal`, `FrictionSignalKind`, `checkImplementationContract` | `ast-sync/src/contract-canary.ts` | 구현 파일을 `.tsp` 계약의 operation·model 이름과 대조하고(Python은 snake_case도 인정) 시그니처 이탈·escape hatch·lock reflex·workaround 표식을 friction signal로 집계하는 구현 계약 카나리. 신호 2개 이상이면 `scrap-and-redesign-tsp`를 권고(`oa-gen sketch --action check-contract`가 사용) |
| `DetachedEvidenceReport`, `validateDetachedEvidenceMarkdown` | `ast-sync/src/contract-canary.ts` | 분리된 근거 리뷰 Markdown(`evidence/*.md`)에 필요한 `#anchor`가 있는지 코드 펜스를 제외하고 검사 |

---

## MCP·HTTP·CLI 도구 엔진 (`@oa-sdk/tools`)

도구 handler의 공개 계약은 `(ctx, input)`이다. input-first 호환은 명시적인 adapter를 사용하며, HTTP 보안과 입력 검증은 각 transport adapter가 공유한다.

| Export | 정의 | 용도 |
|---|---|---|
| `defineTool`, `defineAction` | `tools/src/index.ts` | 타입 안전한 도구 정의와 호환 별칭 |
| `ToolDefinition`, `ToolHandler`, `ToolMiddleware`, `ToolContext`, `ToolLogger` | `tools/src/types.ts` | 도구 실행·미들웨어·문맥 계약 |
| `ToolSchema`, `InferSchema`, `ToolHints`, `ToolCliConfig`, `ToolApiConfig`, `ToolMcpConfig` | `tools/src/types.ts` | 입력 스키마 추론과 adapter 설정 계약 |
| `MCP_PROTOCOL_VERSION_2026_07_28`, `McpHeaders`, `ToolTextContent`, `ToolImageContent`, `CallToolResult`, `ToolInputRequiredResult` | `tools/src/types.ts` | MCP 프로토콜 버전·헤더 및 도구 응답 계약 |
| `createToolContext`, `isToolContext`, `defaultToolLogger` | `tools/src/context.ts` | 실행 문맥과 기본 logger |
| `invokeToolHandler`, `adaptInputFirstHandler`, `composeToolMiddleware`, `executeTool` | `tools/src/context.ts` | handler 호출, input-first 호환, 미들웨어 합성과 도구 실행 |
| `JsonSchemaObject`, `JsonSchemaProperty`, `isZodSchema`, `dereferenceSchema`, `normalizeJsonSchema` | `tools/src/schema.ts` | JSON Schema 구조·정규화·참조 해결 |
| `JsonSchemaValidator`, `ValidationResult`, `createJsonSchemaValidator`, `validateToolInput` | `tools/src/schema.ts` | 단일 JSON Schema validator와 도구 입력 검증 |
| `SchemaBridgeOptions`, `createSchemaTool` | `tools/src/schema-bridge.ts` | 스키마를 입력으로 받는 도구 구성 |
| `McpServerOptions`, `McpServerInstance`, `JsonRpcRequest`, `JsonRpcResponse`, `StatelessMcpDispatcher`, `createMcpServer`, `createStatelessMcpDispatcher` | `tools/src/mcp.ts` | MCP 서버와 stateless JSON-RPC dispatcher |
| `CliAdapterOptions`, `createCli`, `promptMissingFields` | `tools/src/cli.ts` | Commander CLI 생성과 누락된 필드 입력 |
| `HttpAdapterOptions`, `createHttpApp`, `serveHttpApp` | `tools/src/http.ts` | Hono HTTP 앱 구성과 close 가능한 서버 실행 |
| `ToolRequestHeaders`, `ToolHttpSecurityOptions`, `ToolHttpError`, `readToolHeader`, `validateToolHttpOptions`, `authorizeToolHttpRequest` | `tools/src/http-boundary.ts` | 공유 인증·origin·body 크기 정책 및 안전한 HTTP 오류 |
| `ToolJsonBodySchema`, `readToolJsonRequest`, `readToolNodeJsonRequest` | `tools/src/http-boundary.ts` | Fetch·Node HTTP 요청의 크기 제한 JSON 읽기와 선택적 body schema 검증 |
| `ToolAppConfig`, `ToolApp`, `createToolApp`, `createApp` | `tools/src/app.ts` | 도구 registry와 adapter lifecycle을 묶는 앱 |
| `WebMcpPeerRecord`, `WebMcpPeerStatus`, `WebMcpPeerConfig`, `WebMcpPeerAppOptions`, `WebMcpPeerBridgeClient`, `createWebMcpPeerApp` | `tools/src/peer.ts` | WebMCP peer 연결 계약, bridge 상태 문서와 bridge client |
| `ChunkStreamToolsOptions`, `createChunkStreamTools`, `registerChunkStreamTools` | `tools/src/chunk-stream.ts` | chunk-stream 도구 생성과 앱 등록 |

---

## Surface IR 및 Forge Projection (`@oa-sdk/surface-ir`)

Target-neutral API surface IR와 Forge SDK/CLI projection·Overlay 생성.

| Export | 정의 | 용도 |
|---|---|---|
| `SURFACE_IR_VERSION` | `surface-ir/src/index.ts` | Surface IR 스키마 버전 상수 |
| `SurfaceTarget`, `SurfaceAvailability`, `SurfaceVisibility`, `SurfaceAlias`, `SurfaceArgument`, `SurfaceParamOverride`, `SurfacePagination`, `SurfaceStreaming`, `SurfaceRuntime`, `SurfaceOperation`, `SurfaceOperationOverride`, `SurfaceDiagnosticSeverity`, `SurfaceDiagnostic`, `SurfaceIr`, `SurfaceIrOptions` | `surface-ir/src/index.ts` | Surface IR 계약·런타임·진단 타입 |
| `ForgeOperationProjection`, `ForgeCommandCatalog`, `ForgeProjection`, `ForgeOverlayBundle`, `ForgeOverlay`, `ForgeOverlayAction` | `surface-ir/src/index.ts` | Forge projection 및 Overlay 번들 계약 타입 |
| `buildSurfaceIr`, `toForgeProjection`, `emitForgeOverlay`, `emitForgeOverlays` | `surface-ir/src/index.ts` | Surface IR 빌더와 Forge projection·Overlay 방출 함수 |
| `RPC_CONTRACT_VERSION`, `RPC_OPERATION_EXTENSION` | `surface-ir/src/rpc-contract.ts` | RPC contract 스키마 버전과 `@rpc` decorator가 쓰는 `x-oa-sdk-rpc` 확장 이름 |
| `RpcContract`, `RpcProcedure`, `RpcProcedureKind`, `RpcHttpBinding`, `RpcParameterBinding`, `RpcParameterLocation`, `RpcBodyBinding`, `RpcErrorResponse`, `RpcContractOptions`, `BuildRpcContractOptions` | `surface-ir/src/rpc-contract.ts` | operation을 dotted-name procedure(입력 object schema, 출력, 오류, HTTP binding)로 투영한 RPC contract 타입 |
| `buildRpcContract`, `toRpcContract` | `surface-ir/src/rpc-contract.ts` | ParsedDocument 또는 Surface IR에서 RPC contract를 만드는 함수 |
| `INTERFACE_SKETCH_IR_VERSION`, `parseTypeSpecSketch`, `detectTypeSpecProfile`, `compareSketchCandidates` | `surface-ir/src/interface-sketch.ts` | TypeSpec(`.tsp`) 모듈 인터페이스 스케치를 Interface Sketch IR(`oa-sdk.interface-sketch-ir.v1`)로 파싱, 파일의 profile(`openapi-http`·`interface-sketch`·`hybrid`) 판별, 후보 스케치(`{ name, source }`)의 인터페이스 깊이·설계 red flag 점수 비교(`oa-gen sketch`가 사용) |
| `InterfaceSketchIr`, `TypeSpecProfileKind`, `SketchModelIr`, `SketchFieldIr`, `SketchInterfaceIr`, `SketchOperationIr`, `SketchParamIr`, `SketchUnionOrEnumIr`, `DerivedLineageEdge`, `InterfaceDepthMetrics`, `DesignRedFlagId`, `DesignRedFlagFinding`, `SketchArenaCandidateScore`, `SketchArenaComparison` | `surface-ir/src/interface-sketch.ts` | Interface Sketch IR(모델·인터페이스·operation·union/enum, `@derivedFrom` 계보, 깊이 지표, red flag)과 후보 비교 결과 타입 |
| `canonicalJsonStringify`, `computeCanonicalHash`, `sha256`, `stableStringify` | `surface-ir/src/hash.ts` | RFC 8785 JSON Canonicalization Scheme (JCS) 직렬화, SHA-256 canonical hash 계산, 결정적 JSON stringify 유틸리티 |

---

## 청크 스트림 런타임 (`@oa-sdk/chunk-stream`)

청크 envelope, resilient reader, 메모리 residency, 재생 가상화와 저장소 계층의 공통 API다.

| Export | 정의 | 용도 |
|---|---|---|
| `FallbackChunkState`, `RuntimeResourceRef`, `ResourceLease`, `ResidencyRecord` | `chunk-stream/src/types.ts` | fallback·resource lease·residency 계약 |
| `RuntimeChunkEnvelopeDescriptor`, `ChunkFetchDescriptor`, `ChunkStreamReaderOptions`, `ChunkStreamState` | `chunk-stream/src/types.ts` | 청크 envelope·fetch·reader·state 계약 |
| `StreamManifestEntry`, `StreamManifest`, `PlaybackVirtualizerOptions`, `StorageTierOptions`, `ForecasterProfile` | `chunk-stream/src/types.ts` | manifest와 재생·저장소·예측 옵션 |
| `assertNoPrototypePoisoning`, `RuntimeChunkEnvelope`, `createRuntimeEnvelope` | `chunk-stream/src/envelope.ts` | prototype 오염 검증과 런타임 envelope 생성 |
| `ResidencyControllerOptions`, `ResidencyController` | `chunk-stream/src/residency.ts` | 메모리 residency 수명 관리 |
| `PlaybackVirtualizer` | `chunk-stream/src/virtualizer.ts` | 재생 위치에 맞춘 청크 가상화 |
| `TieredStoragePort` | `chunk-stream/src/storage.ts` | 계층형 청크 저장소 |
| `STANDARD_PROFILES`, `ReservationForecaster`, `BudgetLedger` | `chunk-stream/src/forecaster.ts` | 프로파일 기반 예약 예측과 예산 추적 |
| `retryAfterMs`, `synthesizeEmptyChunk`, `createResilientChunkReader`, `createResilientNdjsonReader` | `chunk-stream/src/reader.ts` | Retry-After 처리·빈 청크 합성·복원력 있는 청크 및 NDJSON reader |
| `ChunkStreamStore`, `createChunkStreamStore` | `chunk-stream/src/store.ts` | 구독 가능한 청크 스트림 상태 저장소 |
| `CHUNK_PRESETS`, `ChunkPresetName`, `MEMORY_PRESETS`, `MemoryPresetName`, `RECOMMENDED_CHUNK_BYTES`, `ChunkStreamMode`, `ChunkStreamConfigInput`, `ResolvedChunkStreamConfig`, `defineChunkStreamConfig` | `chunk-stream/src/types.ts` | 청크·메모리 프리셋 상수 및 청크 스트림 설정 정규화 빌더 |
| `GetStreamManifestContext`, `GetStreamChunkContext`, `GetPlaybackSnapshotContext`, `SeekStreamFrameContext`, `ChunkStreamRouteResponse`, `ChunkStreamServerHandlers`, `DefineChunkStreamServerOptions`, `ChunkStreamTypedServer`, `ChunkStreamNotFoundError`, `defineChunkStreamServer` | `chunk-stream/src/server.ts` | 프레임워크 중립 청크 스트림 서버 핸들러 및 라우트 응답 헬퍼 |

---

## 청크 스트림 CRDT (`@oa-sdk/chunk-stream-crdt`)

delta-state cue 병합과 vector clock 기반 누락 delta 조회를 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `VectorClock`, `CrdtMetadata`, `CrdtCue`, `CrdtDeltaEvent` | `chunk-stream-crdt/src/types.ts` | vector clock·CRDT metadata·cue·delta event 계약 |
| `compareCrdtMetadata`, `mergeCrdtCue`, `mergeVectorClocks`, `filterMissingDeltas` | `chunk-stream-crdt/src/semi-lattice.ts` | 결정적 cue 병합과 vector clock 비교 |
| `FORMAT_CRDT_DELTA`, `CrdtDeltaAdapterOptions`, `CrdtDeltaAdapter`, `createCrdtDeltaAdapter` | `chunk-stream-crdt/src/adapter.ts` | CRDT delta format과 adapter 생성 |

---

## 청크 재생과 Storyboard UI (`@oa-sdk/chunk-stream-ui`)

UI action 소비, revision 기반 요청 조정, 재생 상태 및 storyboard 청크 변환 API다.

| Export | 정의 | 용도 |
|---|---|---|
| `JsonPrimitive`, `JsonValue`, `UiAction`, `ContentPort`, `UiActionConsumeResult` | `chunk-stream-ui/src/types.ts` | JSON 값 및 UI action 소비 계약 |
| `PlaybackCursor`, `PlaybackSnapshot` | `chunk-stream-ui/src/types.ts` | 재생 cursor와 snapshot |
| `SlideActionTrigger`, `SlideActionEffect`, `SlideAction`, `SlideNode`, `Slide`, `StoryboardDocument` | `chunk-stream-ui/src/types.ts` | 슬라이드 action·node·storyboard 문서 계약 |
| `ChunkStreamManifestEntry`, `ChunkStreamManifest`, `StoryboardChunkStreamPackage`, `StoryboardChunkStreamOptions`, `StoryboardChunkBridgeOptions`, `StoryboardChunkServer` | `chunk-stream-ui/src/types.ts` | 청크 manifest와 storyboard 변환 옵션·산출물·서버 계약 |
| `UiActionAdapter` | `chunk-stream-ui/src/ui-action.ts` | 재생 가능한 UI action adapter |
| `RequestStatus`, `RevisionReceipt`, `BeginRequestOptions`, `RevisionRequest`, `RevisionFenceOptions`, `RevisionFence` | `chunk-stream-ui/src/revision-fence.ts` | revision fence 요청·receipt·상태 관리 |
| `LatestRequestContext`, `LatestRequestResult`, `LatestRequestCoordinator`, `SeekRequest`, `SeekCoordinator` | `chunk-stream-ui/src/revision-fence.ts` | 최신 요청 및 seek 조정 |
| `ChunkPlaybackLoadRequest`, `ChunkPlaybackLoadResult`, `ChunkPlaybackLoader`, `ChunkPlaybackPrepareContext`, `ChunkPlaybackConsumeContext`, `ChunkPlaybackBinding` | `chunk-stream-ui/src/playback-bridge.ts` | 청크 load·prepare·consume 계약 |
| `ChunkPlaybackError`, `ChunkPlaybackPhase`, `ChunkPlaybackBridgeState`, `ChunkPlaybackSeekOptions`, `ChunkPlaybackSeekResult`, `ChunkPlaybackBridgeOptions` | `chunk-stream-ui/src/playback-bridge.ts` | 재생 오류·phase·상태·seek 계약 |
| `ChunkPlaybackBridgeError`, `assertPlaybackSnapshot`, `ChunkPlaybackBridge` | `chunk-stream-ui/src/playback-bridge.ts` | snapshot 검증과 재생 bridge 실행 |
| `assertChunkIndexBodyParity`, `storyboardToChunkStream`, `createStoryboardChunkPlaybackBridge`, `defineStoryboardChunkServer` | `chunk-stream-ui/src/storyboard-adapter.ts` | index/body 일치 검증과 storyboard 청크·재생 bridge·서버 변환 |

---

## 청크 시계열 분석 (`@oa-sdk/chunk-stream-timeseries`)

채널 정의, 보간·외삽, downsampling과 집계 API다.

| Export | 정의 | 용도 |
|---|---|---|
| `ChannelType`, `InterpolationMode`, `ExtrapolationMode`, `ChannelDef`, `ChannelConfigInput` | `chunk-stream-timeseries/src/types.ts` | 채널 타입·설정과 보간·외삽 정책 |
| `TimeSeriesSample`, `TimeSeriesPayload`, `TimeSeriesEvaluation`, `TimeSeriesPoint`, `TimeSeriesAdapterOptions` | `chunk-stream-timeseries/src/types.ts` | 시계열 sample·payload·평가 결과와 adapter 옵션 |
| `largestTriangleThreeBuckets` | `chunk-stream-timeseries/src/lttb.ts` | LTTB downsampling |
| `DecimationMode`, `decimateTimeSeries` | `chunk-stream-timeseries/src/decimate.ts` | min/max·평균·합계·개수 집계 |
| `FORMAT_TIME_SERIES`, `interpolateLinear`, `findBoundingIndices`, `normalizeChannelDefs`, `TimeSeriesAdapter` | `chunk-stream-timeseries/src/adapter.ts` | 시계열 format, 채널 정규화와 보간 adapter |

---

## React 청크 재생 Hooks (`@oa-sdk/chunk-stream-react`)

React에서 재생 상태, peer awareness, store 구독과 telemetry를 연결한다.

| Export | 정의 | 용도 |
|---|---|---|
| `PeerPlayback`, `AwarenessPresence` | `chunk-stream-react/src/types.ts` | peer 재생과 presence 계약 |
| `UseChunkPlaybackOptions`, `UseChunkPlaybackResult`, `UsePlaybackAwarenessOptions`, `UsePlaybackAwarenessResult` | `chunk-stream-react/src/types.ts` | 재생·awareness hook 옵션과 결과 |
| `formatSecondsToTimecode`, `formatFramesToTimecode`, `formatBytes` | `chunk-stream-react/src/utils.ts` | 초·프레임·바이트 표시 형식 |
| `useChunkPlayback` | `chunk-stream-react/src/useChunkPlayback.ts` | 청크 재생 상태 hook |
| `usePlaybackAwareness` | `chunk-stream-react/src/usePlaybackAwareness.ts` | peer 재생·presence 동기화 hook |
| `useChunkStreamStore` | `chunk-stream-react/src/useChunkStreamStore.ts` | 청크 stream store 구독 hook |
| `UseChunkTelemetryOptions`, `UseChunkTelemetryResult`, `useChunkTelemetry` | `chunk-stream-react/src/useChunkTelemetry.ts` | 청크 telemetry 옵션·결과와 hook |

---

## Peer 전송과 Bridge Client (`@oa-sdk/peer-transport`)

peer registry 호출 및 deadline·session epoch·channel별 queue를 가진 P2P 전송 API다.

| Export | 정의 | 용도 |
|---|---|---|
| `WebMcpPeerRecord`, `BridgeClientConfig`, `PeerCallPayload`, `PeerCallResult` | `peer-transport/src/types.ts` | peer·bridge 설정 및 RPC 요청·응답 계약 |
| `TransportChannelType`, `DataChannelPacket`, `TRANSPORT_CHANNELS` | `peer-transport/src/types.ts` | 채널 이름과 packet envelope 계약 |
| `WebMcpBridgeClient` | `peer-transport/src/bridge-client.ts` | peer 조회·RPC·재시도 bridge client |
| `ChannelListener`, `P2pChannelConfig`, `P2pTransportChannel` | `peer-transport/src/p2p-channel.ts` | P2P channel 설정·수신 listener·전송 lifecycle |
| `PeerRole`, `SignalingPhase`, `WEBMCP_SUBPROTOCOL`, `MAX_SIGNAL_BYTES`, `MAX_RELAY_BYTES`, `DEFAULT_ROOM_TTL_MS`, `SignalMessage`, `CloudTransitCallPayload`, `CloudTransitCallResponse`, `parseSignalMessage`, `validateSdp`, `isRelayPacket` | `peer-transport/src/relay-protocol.ts` | WebMCP signaling wire protocol, SDP 검증기, 바이트 한도 및 relay 패킷 판별 |
| `WebSocketTransportAdapterOptions`, `WebSocketTransportAdapter`, `createWebSocketTransportAdapter` | `peer-transport/src/adapters/websocket-adapter.ts` | WebSocket 릴레이 기반 P2P 채널 호스트 전송 어댑터 |
| `CloudTransitClientConfig`, `CloudTransitClient`, `createCloudTransitClient` | `peer-transport/src/adapters/cloud-transit-client.ts` | Cloud Transit Proxy 경유 Streamable HTTP MCP 호출 클라이언트 |

---

## Peer Registry와 Signaling Server (`@oa-sdk/peer-server`)

peer 저장소, room registry, home MCP 도구, WebSocket signaling/packet 중계 및 Cloud Transit Proxy를 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `PeerServerOptions`, `SignalingToolCallMessage`, `SignalingPeerSocket`, `SignalingRoomEntry`, `PeerStoreData` | `peer-server/src/types.ts` | 서버·signaling peer(provider로 전달되는 tool call 메시지 포함)·room·영속 저장소 계약 |
| `FilePeerStore`, `isSafeAlias` | `peer-server/src/store.ts` | 파일 기반 peer 저장과 alias 검증 |
| `PeerRoomManagerOptions`, `PeerRoomManager` | `peer-server/src/room.ts` | peer room·세션 관리 |
| `createHomeMcpTools` | `peer-server/src/home-mcp.ts` | home MCP 도구 생성 |
| `PeerServerInstance`, `createPeerServer` | `peer-server/src/server.ts` | peer 서버 생성과 lifecycle handle |
| `SignalingRoomState`, `RoomDelivery`, `sha256Hex`, `randomHex`, `SignalingRoom` | `peer-server/src/relay/signaling-room.ts` | signaling room FSM, 티켓 인증, duplex packet relay 및 rendezvous descriptor |
| `RelaySocket`, `PeerRelayManagerOptions`, `WebSocketRelayOptions`, `PeerRelayManager`, `extractTicketFromRequest`, `attachWebSocketRelay` | `peer-server/src/relay/websocket-relay.ts` | Node.js WebSocket 릴레이 서버 및 서브프로토콜/티켓 업그레이드 핸들러 |
| `CloudTransitOptions`, `McpRpcRequest`, `McpRpcResponse`, `CloudTransitProxy`, `handleCloudTransitHttpRequest`, `handleCloudTransitWorker` | `peer-server/src/cloud/transit-proxy.ts` | Streamable HTTP MCP JSON-RPC 2.0 Cloud Transit Proxy 및 Edge/Worker 핸들러 |

---

## 협업 Workspace (`@oa-sdk/collab-workspace`)

Tree-Lattice 상태, replay watermark, 용량 제한, presence와 intent lock을 관리한다. 원격 이벤트는 transport capability와 함께 검증한다.

| Export | 정의 | 용도 |
|---|---|---|
| `EditorRole`, `EditorPresence`, `IntentLock` | `collab-workspace/src/types.ts` | 편집자 role·presence·intent lock 계약 |
| `WorkspaceLimits`, `FileChunkCue`, `CollabFolderConfig`, `RemoteChunkSource` | `collab-workspace/src/types.ts` | workspace 용량·파일 chunk·설정·원격 source 계약 |
| `WorkspaceTreeLattice` | `collab-workspace/src/tree-lattice.ts` | 파일·tombstone 상태 병합과 bounded render·compaction |
| `AiEditorConfig`, `AiEditorActor` | `collab-workspace/src/ai-editor-actor.ts` | AI 편집자 actor 설정과 동작 |
| `WorkspaceSyncer` | `collab-workspace/src/workspace-syncer.ts` | workspace 동기화·replay watermark·presence 수명 관리 |
| `RemoteTransportCapability`, `createRemoteTransportCapability`, `isRemoteTransportCapability` | `collab-workspace/src/security.ts` | opaque 원격 transport capability 생성·검증 |
| `validateRelativeFilePath`, `validateClientId`, `validateLineIndex`, `validateLineRange`, `validateContent`, `validateWorkspaceConfig`, `assertAllowedFilePath` | `collab-workspace/src/security.ts` | 경로·client ID·line·content·workspace 허용 범위 검증 |
| `MAX_LOCK_TTL_MS`, `validateIntentLock`, `validateFileChunkCue`, `validatePresence` | `collab-workspace/src/security.ts` | 최대 lock TTL과 lock·chunk·presence 검증 |

---

## MCP Mesh Registry와 Router (`@oa-sdk/mcp-mesh`)

domain skill과 session instance를 등록하고 호출을 route한다. 여러 domain에 존재하는 bare tool 이름은 aggregate에서 제외한다. `./cli` subpath는 아래 CLI API를 별도로 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `DomainSkillDefinition`, `McpSessionInstance`, `McpTransportType`, `SkillPackage` | `mcp-mesh/src/types.ts` | domain skill·session·transport·skill package 계약 |
| `MetaSkillDefinition`, `MeshRoutingDecision` | `mcp-mesh/src/types.ts` | meta skill과 routing 결정 계약 |
| `SkillRegistry`, `PeerToolCaller` | `mcp-mesh/src/skill-registry.ts` | domain·session·meta skill 등록과 조회 및 peer 도구 호출 계약 |
| `MeshRouter` | `mcp-mesh/src/mesh-router.ts` | 호출 routing과 모호하지 않은 도구 aggregate |
| `validateMeshIdentifier`, `validateToolDefinition`, `assertToolInput`, `validateWorkspaceRules` | `mcp-mesh/src/security.ts` | mesh 식별자·도구·입력·workspace rule 검증 |
| `validateDomainSkill`, `validateSession`, `validateMetaSkill`, `validatePeerPackage` | `mcp-mesh/src/security.ts` | domain·session·meta skill·peer package 검증 |
| `CliContext`, `MeshCliOptions` | `mcp-mesh/src/cli/types.ts` | CLI 설정 및 registry·server 문맥 |
| `createMeshCli` | `mcp-mesh/src/cli/index.ts` | mesh CLI 생성 |
| `formatOutput`, `formatTable` | `mcp-mesh/src/cli/formatters.ts` | CLI JSON·표 출력 |

---

## Spec Lens 관측·캐시·HTTP 서버 (`@oa-sdk/spec-lens`)

project identity, snapshot builder, source adapter, SQLite cache와 CQRS query handler를 제공한다. 공유 wire 타입은 spec-lens-contract에서 재노출한다.

| Export | 정의 | 용도 |
|---|---|---|
| `DEFINITION_BUILDER_VERSION`, `DEFINITION_BUILDER_TOOLCHAIN_FINGERPRINT`, `TYPESPEC_BUNDLE_BUILDER_VERSION`, `SPEC_LENS_DIFF_SCHEMA_VERSION`, `SPEC_LENS_SNAPSHOT_SCHEMA_VERSION` | `spec-lens/src/domain/index.ts` | 빌더와 snapshot·diff 버전 |
| `SpecProjectConfig`, `SpecProjectIdentity`, `SpecProjectKeyInput`, `SpecProjectSourceKind`, `SpecObservationAdapterKind`, `SpecObservationIdentity` | `spec-lens/src/domain/index.ts` | project·관측 source identity 계약 |
| `DefinitionBuilderProjectConfig`, `DefinitionBuilderProjectIdentity`, `DefinitionBuilderProvenance`, `TypeSpecBundleProjectConfig`, `TypeSpecBundleProjectIdentity`, `TypeSpecBundleProvenance`, `SpecProvenance` | `spec-lens/src/domain/index.ts` | project kind별 설정·identity·provenance |
| `buildManifestOrTargetDigest`, `buildSpecProjectKey`, `createSpecProjectIdentity`, `digestText`, `resolveSpecProjectConfig` | `spec-lens/src/domain/index.ts` | project identity·설정·digest 생성 |
| `SpecFileEntry`, `SpecRevision`, `SpecSnapshotDiagnostic`, `SpecSourceKind` | `spec-lens/src/domain/index.ts` | 공유 revision·파일·source·snapshot 진단 계약 |
| `DefinitionBuilderSpecSnapshot`, `TypeSpecBundleSpecSnapshot`, `SpecSnapshot`, `SpecSnapshotStored` | `spec-lens/src/domain/index.ts` | project kind별 snapshot과 저장 계약 |
| `DefinitionBuilderSpecTimelineDiff`, `TypeSpecBundleSpecTimelineDiff`, `SpecTimelineDiff`, `SpecTimelineEntry` | `spec-lens/src/domain/index.ts` | project kind별 timeline diff·entry |
| `SpecPathEntry`, `SpecPathsResult`, `SpecGraph`, `SpecGraphEdge`, `SpecGraphNode` | `spec-lens/src/domain/index.ts` | path와 dependency graph 계약 |
| `GetDiffHandler`, `GetGraphHandler`, `GetPathsHandler`, `GetSnapshotHandler`, `GetTimelineHandler` | `spec-lens/src/application/index.ts` | CQRS snapshot·diff·graph·paths·timeline 조회 handler |
| `GetDiffQuery`, `GetGraphQuery`, `GetPathsQuery`, `GetSnapshotQuery`, `GetTimelineQuery` | `spec-lens/src/application/index.ts` | CQRS 조회 query 계약 |
| `CachePort`, `SpecSourcePort`, `SnapshotBuilderPort` | `spec-lens/src/application/index.ts` | cache·source·builder port 계약 |
| `GetFileEntriesOptions`, `ListPathsOptions`, `ListRevisionsOptions`, `SpecSourceReadBudget`, `ListTimelineOptions` | `spec-lens/src/application/index.ts` | source 파일·path·revision·timeline 조회 제한 |
| `BuildSnapshotOptions`, `DefinitionBuilderBuildSnapshotOptions`, `TypeSpecBundleBuildSnapshotOptions` | `spec-lens/src/application/index.ts` | project kind별 snapshot build 옵션 |
| `RefreshTimelineHandler`, `RefreshTimelineOptions`, `RefreshTimelineResult`, `DefinitionBuilderRefreshTimelineOptions`, `TypeSpecBundleRefreshTimelineOptions` | `spec-lens/src/application/index.ts` | timeline refresh handler·옵션·결과 |
| `FileDiffAdapter`, `FileDiffAdapterConfig`, `LocalGitAdapter`, `LocalGitAdapterConfig` | `spec-lens/src/infrastructure/index.ts` | 파일 및 로컬 Git source adapter |
| `GithubAdapter`, `GithubAdapterConfig`, `GithubApiAdapter`, `GithubApiAdapterConfig`, `GitlabAdapter`, `GitlabAdapterConfig` | `spec-lens/src/infrastructure/index.ts` | GitHub·GitLab source adapter |
| `DefaultTokenProvider`, `GitlabTokenProvider`, `TokenProvider`, `TokenProviderConfig` | `spec-lens/src/infrastructure/index.ts` | source 인증 token provider |
| `SnapshotBuilder`, `TypeSpecBundleSnapshotBuilder`, `selectSnapshotBuilder`, `SnapshotBuilderSelection`, `TypeSpecBundleCompiler`, `SqliteCache`, `buildTargetConfigDigest` | `spec-lens/src/infrastructure/index.ts` | snapshot builder 선택·TypeSpec compiler·SQLite cache |
| `computeTsconfigUniverse`, `computeTsconfigUniverseDigest`, `createEmptyTsconfigUniverse`, `ContractConfigDigest`, `ContractConfigUniverse` | `spec-lens/src/infrastructure/cache/sqlite/cache-key.ts` | transitive tsconfig universe와 cache digest |
| `parseJsonc`, `stripJsonComments`, `removeTrailingCommas`, `configurationClosure`, `resolveConfigurationFile`, `ConfigurationClosure` | `spec-lens/src/infrastructure/cache/sqlite/cache-key.ts` | JSONC 읽기와 configuration closure 탐색 |
| `createSpecLensServer`, `serveSpecLens`, `DefinitionBuilderSpecLensServerConfig`, `SpecLensServerConfig`, `TypeSpecBundleSpecLensServerConfig` | `spec-lens/src/presentation/http/server.ts` | HTTP 서버 구성·실행과 project kind별 설정 |
| `runScenarioCli`, `verifyAllScenarios`, `ScenarioCliOptions` | `spec-lens/src/scenario-cli.ts` | 시나리오 CLI 실행기·검증기 및 옵션 |

---

## TypeSpec 확장 Decorators (`@oa-sdk/typespec-decorators`)

OpenAPI component, persona, DPM 및 CRDT 메타데이터를 TypeSpec에서 선언한다.

| Export | 정의 | 용도 |
|---|---|---|
| `namespace` | `typespec-decorators/src/decorators.ts` | TypeSpec decorator namespace |
| `$oaUseResponseComponent`, `$personaCapability`, `VALID_PERSONA_TRAITS` | `typespec-decorators/src/decorators.ts` | 공유 response component와 persona capability decorator |
| `$pseudonymize`, `VALID_DPM_TRANSFORMS`, `VALID_DPM_ROLES` | `typespec-decorators/src/decorators.ts` | DPM projection decorator와 허용 transform·role |
| `$crdt`, `$crdtEntity` | `typespec-decorators/src/decorators.ts` | CRDT field·entity decorator |
| `VALID_CRDT_TYPES`, `VALID_CRDT_RESOLUTIONS`, `VALID_CRDT_ENGINES`, `VALID_CRDT_ROLES`, `VALID_CRDT_COMPACTIONS` | `typespec-decorators/src/decorators.ts` | CRDT type·resolution·engine·role·compaction 허용값 |
| `$actorInput`, `$machineContext`, `$eventPayload`, `$behaviorRef` | `typespec-decorators/src/decorators.ts` | XState / Behavior 런타임 데이터 스키마 decorator |
| `$storageRef`, `$storageCatalog` | `typespec-decorators/src/decorators.ts` | Atlas DB 물리 카탈로그 증거 및 컬럼 바인딩 decorator |
| `$traceId`, `$replaces`, `$requirement`, `TRACE_EXTENSION`, `VALID_TRACE_ID_PATTERN`, `VALID_REPLACES_ID_PATTERN`, `VALID_REQUIREMENT_ID_PATTERN` | `typespec-decorators/src/governance.ts`, `typespec-decorators/src/constants.ts` | 스펙 정의 불변 추적 ID, 마이그레이션 대체 ID, 요구사항 연결 데코레이터(`x-oa-sdk-trace`) 및 정규식 상수 |
| `$evidence`, `$evidenceReview`, `$intent`, `$derivedFrom`, `extractHeadingFormEvidence`, `EVIDENCE_EXTENSION`, `INTENT_EXTENSION`, `DERIVED_FROM_EXTENSION`, `VALID_INTENT_ID_PATTERN`, `VALID_DOC_ANCHOR_PATTERN` | `typespec-decorators/src/evidence-and-intent-decorators.ts`, `typespec-decorators/src/constants.ts` | 근거 locator(`x-oa-sdk-evidence`)·분리된 근거 리뷰 문서 연결, Intent-Unit ID와 `@doc` 앵커 선언(`x-oa-sdk-intent`), `model B is A` 파생 계약 계보 선언(`x-oa-sdk-derived-from`; 모두 `x-oa-sdk-trace`에 병합), doc comment의 `## @evidence <path#anchor>` 추출 및 ID·앵커 정규식 상수 |
| `$protobuf`, `$field`, `$rpc`, `$wireFormat` | `typespec-decorators/src/protobuf.ts` | Protocol Buffers 및 RPC wire format 데코레이터 |
| `$chunkStream`, `CHUNK_STREAM_EXTENSION`, `CHUNK_STREAM_PRESET_BYTES`, `CHUNK_MEMORY_PRESET_BYTES`, `VALID_CHUNK_STREAM_PRESETS`, `VALID_CHUNK_MEMORY_PRESETS`, `VALID_CHUNK_STREAM_MODES` | `typespec-decorators/src/chunk-stream.ts` | 청크 스트림 프로젝션 데코레이터 및 프리셋·모드 상수 |
| `PROTOBUF_EXTENSION`, `PROTOBUF_FIELD_EXTENSION`, `RPC_EXTENSION`, `WIRE_FORMAT_EXTENSION` | `typespec-decorators/src/constants.ts` | OpenAPI x-oa-sdk wire 확장 프로퍼티 키 |
| `VALID_WIRE_FORMATS`, `VALID_RPC_STREAMING`, `VALID_PROTOBUF_SCALAR_TYPES` | `typespec-decorators/src/constants.ts` | Wire format, RPC 스트리밍, Protobuf 스칼라 타입 허용값 |
| `$lib`, `reportDiagnostic` | `typespec-decorators/src/lib.ts` | TypeSpec library와 diagnostic 보고 |

---

## OpenAPI 배포 자산 (`@oa-sdk/schemas`)

TypeSpec에서 빌드한 OpenAPI 문서를 JSON·YAML package asset으로 제공한다. TypeScript symbol API는 없으며 package export key와 파일 경로를 검증한다.

| Export | 자산 | 용도 |
|---|---|---|
| `.` | `./dist/openapi.json` | 기본 OpenAPI JSON 문서 |
| `./openapi.json` | `./dist/openapi.json` | 명시적 JSON 문서 entrypoint |
| `./openapi.yaml` | `./dist/openapi.yaml` | 명시적 YAML 문서 entrypoint |

---

## 설계 주도 텔레메트리와 XState 인스펙터 (`@oa-sdk/telemetry`)

추적 심볼(Tracking Symbol) 레지스트리, XState v5 비침습 라이프사이클 인스펙터, DPM 결정론적 관계 보존 가명화 브릿지 및 다중 프로바이더(GTM/Sentry/OTel) 디스패처를 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `SymbolLayer`, `PiiLevel`, `KpiDimension`, `ParsedTrackSymbol`, `SymbolRoutingConfig`, `SymbolDefinition` | `telemetry/src/symbols/types.ts` | 추적 심볼 문법 계층, PII 처리 등급, KPI 차원, 라우팅 메타데이터 계약 |
| `TRACK_SYMBOL_REGEX`, `isValidTrackSymbol`, `parseTrackSymbol`, `formatTrackSymbol` | `telemetry/src/symbols/grammar.ts` | 추적 심볼 정규식 및 파싱/포맷/유효성 검증 함수 |
| `SymbolRegistryOptions`, `SymbolRegistry`, `createSymbolRegistry` | `telemetry/src/symbols/registry.ts` | 닫힌 심볼 카탈로그 레지스트리 및 등록/조회 팩토리 |
| `TelemetryContext`, `TelemetryEnvironment`, `TelemetryEnvelope` | `telemetry/src/envelope/types.ts` | 실행 컨텍스트(W3C Trace), 환경, 표준 텔레메트리 엔벨로프 계약 |
| `generateTraceId`, `generateSpanId`, `CreateEnvelopeOptions`, `createTelemetryEnvelope` | `telemetry/src/envelope/builder.ts` | W3C 분산 추적 ID 생성 및 엔벨로프 합성 빌더 |
| `TelemetryIdentity`, `setGlobalTelemetryIdentity`, `getGlobalTelemetryIdentity`, `clearGlobalTelemetryIdentity`, `subscribeTelemetryIdentity` | `telemetry/src/identity/identity.ts` | 전역/세션 사용자 식별자 및 가명 토큰 바인딩/구독 |
| `DpmTokenOptions`, `DpmTelemetryAdapterOptions`, `DpmTelemetryAdapter` | `telemetry/src/dpm/types.ts` | DPM 가명화 옵션 및 어댑터 인터페이스 |
| `createDpmTelemetryAdapter` | `telemetry/src/dpm/adapter.ts` | PII 민감키 마스킹 및 관계 보존 결정론적 가명화 토큰 어댑터 팩토리 |
| `TelemetryDispatcher` | `telemetry/src/dispatcher/types.ts` | 다중 프로바이더 텔레메트리 디스패처 공통 인터페이스 |
| `GtmDispatcherOptions`, `createGtmDispatcher` | `telemetry/src/dispatcher/gtm.ts` | Google Tag Manager dataLayer 푸시 및 GA4 이벤트 포맷팅 디스패처 |
| `SentryLikeClient`, `SentryDispatcherOptions`, `createSentryDispatcher` | `telemetry/src/dispatcher/sentry.ts` | Sentry Breadcrumbs 누적, Context 갱신 및 Exception 캡처 디스패처 |
| `OtelLikeSpan`, `OtelLikeTracer`, `OtelDispatcherOptions`, `createOtelDispatcher` | `telemetry/src/dispatcher/otel.ts` | OpenTelemetry Span 생명주기 및 이벤트 기록 디스패처 |
| `createCompositeDispatcher` | `telemetry/src/dispatcher/composite.ts` | 다중 프로바이더 동시 브로드캐스트 합성 디스패처 |
| `XStateInspectorOptions`, `ActorRefLike`, `SnapshotLike`, `InspectionEventLike`, `createTelemetryInspector` | `telemetry/src/xstate/inspector.ts` | XState v5의 inspect 훅에 연결되는 비침습 중앙집중식 인스펙터 팩토리 |

---

## TypeSpec 계약 RPC 런타임 (`@oa-sdk/rpc`)

Surface IR RPC contract를 소비해 typed procedure client/server, JSON-RPC 2.0, 원래 REST route binding을 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `RpcContract`, `RpcProcedure`, `RpcProcedureTypes`, `RpcProcedureShape`, `UntypedProcedures`, `RpcCallOptions`, `RpcProcedureCaller`, `RpcClient`, `RpcHandler`, `RpcHandlerContext`, `RpcHandlers`, `RpcValidationIssue`, `RpcSchemaCheck`, `RpcValidator`, `RpcTransport`, `RpcTransportRequest`, `RpcHeadersInit` | `rpc/src/types.ts` | contract, dotted name 기반 client/handler 중첩 타입, validator·transport 계약 |
| `RpcError`, `RpcErrorCode`, `RpcErrorOptions`, `isRpcError`, `toRpcError`, `statusForCode`, `codeForStatus` | `rpc/src/errors.ts` | 코드·HTTP status·payload를 가진 RPC 오류와 status 매핑 |
| `createRpcServer`, `RpcServer`, `RpcServerOptions`, `RpcServerCallOptions`, `RpcServerCallArgs` | `rpc/src/server.ts` | handler 바인딩, 입력·출력 검증, 내부 오류 은닉 서버 |
| `createRpcClient`, `createRpcCaller`, `createLocalTransport`, `RpcCaller`, `RpcClientOptions` | `rpc/src/client.ts` | 중첩 client, 이름 기반 caller, 같은 프로세스 transport |
| `createHttpTransport`, `createRestFetchHandler`, `errorFromHttpResponse`, `HttpTransportOptions`, `RestFetchHandlerOptions`, `RpcFetchHandler` | `rpc/src/http.ts` | OpenAPI style/explode 직렬화로 원래 REST route를 호출·제공하는 binding |
| `handleJsonRpc`, `createJsonRpcFetchHandler`, `createJsonRpcTransport`, `toJsonRpcError`, `fromJsonRpcError`, `JsonRpcId`, `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcErrorObject`, `JsonRpcHandleOptions`, `JsonRpcFetchHandlerOptions`, `JsonRpcTransportOptions` | `rpc/src/json-rpc.ts` | JSON-RPC 2.0 message 처리(batch·notification), HTTP endpoint와 transport |

---

## WebMCP Peer 3-Tier Server Routing (`@oa-sdk/webmcp-peer`)

룸 기반 Streamable HTTP MCP 라우터(`/p/:id/mcp`), WebSocket 시그널링 데몬(`/p/:id/provider`, `/p/:id/client`), 브라우저/호스트 Provider, 외부 에이전트/CLI 세션 클라이언트 및 초대/설정 프로필 유틸리티를 기능 의도 단위 모듈로 제공한다.

| Export | 정의 | 용도 |
|---|---|---|
| `WEBMCP_SUBPROTOCOL`, `WEBMCP_PEER_CONFIG_TYPE`, `DEFAULT_EXTERNAL_CONSENT_PREFIX`, `WebMcpPeerConfigProfile`, `CreatePeerConfigProfileOptions`, `WebMcpParsedInvitationUrl`, `ParsedPeerConfig`, `ParsePeerConfigResult`, `PeerServerPublicConfig`, `PeerHealthState`, `PeerHealthResult`, `PeerHealthMessages`, `PeerHealthProbeOptions` | `webmcp-peer/src/config/types.ts` | 서브프로토콜·설정 프로필·초대 링크·헬스 프로브 타입 계약 |
| `normalizePeerUrl`, `normalizePeerConfigUrl`, `isLocalPeerUrl`, `externalConsentKey`, `parseInvitationUrl`, `buildInvitationUrl` | `webmcp-peer/src/config/invitation.ts` | 피어 서버 URL 정규화, 로컬/외부 출처 판별, `#invite=...` 초대 링크 파싱·생성 |
| `createPeerConfigProfile`, `stringifyPeerConfigProfile`, `parsePeerConfig` | `webmcp-peer/src/config/profile.ts` | 피어 설정 프로필 JSON 생성·직렬화 및 URL/JSON 유연 파싱 |
| `probePeerHealth`, `fetchPeerServerConfig` | `webmcp-peer/src/config/probe.ts` | 연결 전 `/health` 가용성 프로브 및 `/config` 공개 설정 조회 |
| `DEFAULT_SERVER_URL`, `PROTOCOL_VERSION`, `PeerMcpTransportMessage`, `PeerMcpTool`, `PeerMcpSessionState`, `PeerMcpCatalogSnapshot`, `PeerMcpSessionInfo`, `PeerMcpStore`, `PeerMcpTransportCallbacks`, `PeerMcpTransport`, `PeerMcpSessionOptions`, `PeerMcpRequestOptions`, `PeerMcpCallOptions`, `PeerMcpListener`, `PeerMcpCatalogListener`, `DiscoverPeerCatalogOptions`, `DiscoveredPeerCatalog`, `JoinPeerRoomOptions`, `JoinedPeerRoom`, `PeerSessionStatusOptions`, `WaitForPeerApprovalOptions`, `RotatePeerRoomOptions` | `webmcp-peer/src/client/types.ts` | 외부 에이전트/CLI MCP 세션, 카탈로그 스냅샷, 전송 어댑터 및 룸 수명주기 계약 |
| `PeerMcpError`, `PeerMcpRpcError`, `PeerMcpCatalogChangedError`, `canonicalRpcErrorCode`, `isCatalogChangedRpcError` | `webmcp-peer/src/client/errors.ts` | 피어 MCP 클라이언트 에러 계층, JSON-RPC 에러의 정규 코드명 해석, 카탈로그 드리프트(-32010/-32027 전용) 판별 및 Fail-Closed 예외 |
| `hashTools`, `normalizeTools` | `webmcp-peer/src/client/catalog-hash.ts` | 순서 무관 결정론적 SHA-256 도구 카탈로그 해시 및 도구 기술자 검증 |
| `normalizeServerUrl`, `websocketUrl`, `parseRoomId` | `webmcp-peer/src/client/transport.ts` | Streamable HTTP MCP(`/p/:id/mcp`) 및 WebSocket(`/p/:id/client`) 엔드포인트·전송 어댑터 |
| `PeerMcpSession`, `createPeerMcpSession` | `webmcp-peer/src/client/session.ts` | 단일 룸 MCP JSON-RPC 세션 상태 머신(`initialize`, `tools/list`, `tools/call`, 티켓 폐기) |
| `PeerMcpService`, `createPeerMcpService`, `JsonPeerMcpStore`, `createJsonPeerMcpStore` | `webmcp-peer/src/client/service.ts` | 다중 피어 세션 레지스트리, 활성 세션 라우팅 및 원자적 JSON 파일 카탈로그 저장소 |
| `discoverPeerCatalog`, `joinPeerRoom`, `getPeerSessionStatus`, `waitForPeerApproval`, `rotatePeerRoom` | `webmcp-peer/src/client/room-lifecycle.ts` | 원격 룸 카탈로그 탐색, 초대 토큰 조인, 승인 대기 폴링 및 룸 로테이션 |
| `MCP_PROTOCOL_VERSION`, `MCP_PROTOCOL_VERSIONS`, `MCP_INITIALIZE_PROTOCOL_VERSIONS`, `CommitReceipt`, `isUtcTimestamp`, `isCommitReceipt` | `webmcp-peer/src/provider/commit-receipt.ts` | 호스트 커밋 영수증(`CommitReceipt`) 판별 유니온 및 런타임 타입 가드 |
| `AiRunPhase`, `AiRollbackStatus`, `AiRunPoint`, `AiRunStep`, `AiRunRollbackSummary`, `AiRunSnapshot`, `AiRollbackStepResult`, `AiRunController` | `webmcp-peer/src/provider/ai-run-controller.ts` | 다단계 AI 실행 수명주기, 커서 궤적 기록 및 역순 스텝 롤백 코디네이터 |
| `AiRunReceiptStatus`, `AiRunRollbackStatus`, `AiRunLedgerDisposition`, `AiRunOperationRecord`, `AiRunLedgerWriteStatus`, `AiRunLedgerWriteResult`, `AiRunLedgerWriteOptions`, `AiRunLedgerStore`, `AiRunReceiptInput`, `AiRunRollbackInput`, `AiRunLedgerErrorCode`, `AiRunLedgerError`, `AiRunLedger`, `InMemoryAiRunLedgerStore`, `aiRunLedgerDisposition` | `webmcp-peer/src/provider/ai-run-ledger.ts` | AI 오퍼레이션 멱등성 원장, 상태 역행/충돌 검출 및 인메모리 저장소 |
| `FRAMEBOOK_PRODUCTION_SIGNALING_URL`, `resolveDefaultSignalingUrl`, `WebMcpCrdtTransport`, `WebMcpPeerState`, `WebMcpPeerApprovalState`, `WebMcpPeerSessionInfo`, `WebMcpToolSummary`, `WebMcpWireToolDescriptor`, `toWireToolDescriptor`, `WebMcpHostServerInfo`, `WebMcpHostAdapter`, `WebMcpPeerConnectOptions`, `WebMcpPeerClientOptions` | `webmcp-peer/src/provider/types.ts` | 호스트 애플리케이션 도구 어댑터, CRDT 전송 브리지, Provider 세션 옵션 계약 및 `register`·`tools/list`·`server/discover` 공통 도구 기술자 직렬화 |
| `WebMcpPeerClient` | `webmcp-peer/src/provider/peer-client.ts` | 브라우저/호스트 Provider 런타임(룸 생성, F5 리스 복구, 승인 게이트, WebSocket MCP 중계 및 WebRTC DataChannel 프레이밍) |
| `PeerSocket`, `MAX_WEBSOCKET_FRAME_BYTES`, `MAX_WEBSOCKET_MESSAGE_BYTES`, `upgradeWebSocket` | `webmcp-peer/src/server/ws-upgrade.ts` | 무의존성 RFC 6455 WebSocket 업그레이드 핸드셰이크, 마스킹, 단편화 파서 및 프레이밍 |
| `withFileLockSync`, `appendDurableLineSync`, `readDurableJsonLinesSync` | `webmcp-peer/src/server/durable-file.ts` | 프로세스 간 파일 잠금(`O_CREAT \| O_EXCL`) 및 `fsync` append-only JSONL 헬퍼 |
| `PublishRateLimitRequest`, `PublishRateLimitDecision`, `PublishRateLimitStore`, `validatePublishRateLimitDecision`, `InMemoryPublishRateLimitStore`, `FilePublishRateLimitStore`, `SqlitePublishRateLimitStore`, `createPublishRateLimitStoreFromEnv` | `webmcp-peer/src/server/rate-limit.ts` | 룸 생성/발행 슬라이딩 윈도우 속도 제한기 및 Memory/File/SQLite 저장소 |
| `DeploymentCatalogSnapshot`, `DeploymentCatalogInput`, `hashDeploymentCatalog`, `loadDeploymentCatalog`, `normalizeToolCatalog` | `webmcp-peer/src/server/deployment-catalog.ts` | 콜드 스타트 정적 배포 도구 카탈로그 부트스트랩, 정규 SHA-256 해시 및 클라이언트 계약과 동일한 도구 카탈로그 검증 |
| `PeerServerConfig`, `CliParsedArgs`, `DEFAULT_ALLOWED_ORIGINS`, `DEFAULT_ALLOWED_HOSTS`, `DEFAULT_PUBLISH_RATE_LIMIT_WINDOW_MS`, `DEFAULT_PUBLISH_RATE_LIMIT_MAX`, `loadEnvFile`, `autoLoadEnvFiles`, `parseCliArgs`, `findConfigFile`, `loadConfigFile`, `resolvePeerServerConfig`, `isOriginAllowed`, `isHostAllowed` | `webmcp-peer/src/server/server-config.ts` | 서버 CLI 인자·`.env`·JSON 설정 파서 및 와일드카드 Origin/Host 허용 목록 검증기 |
| `FileAiRunLedgerStore`, `SqliteAiRunLedgerStore` | `webmcp-peer/src/server/ledger-stores.ts` | `AiRunLedger`용 파일 JSONL 및 SQLite WAL 영속 저장소 |
| `PeerCapability`, `ClientSessionStatus`, `ClientSessionTicket`, `PendingApprovalRequest`, `PendingMcpRequest`, `RoomEntry`, `WebMcpPeerServerOptions` | `webmcp-peer/src/server/types.ts` | 서버 룸 엔트리, 클라이언트 세션 티켓, 승인 대기열 및 커스텀 HTTP/WS 확장 훅 계약 |
| `WebMcpPeerServer`, `createWebMcpPeerServer` | `webmcp-peer/src/server/peer-server.ts` | 룸 제어 평면, Streamable HTTP MCP 라우터(`/p/:id/mcp`), WebSocket 시그널링 중계 및 확장 훅 실행 서버 |

