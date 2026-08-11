# Changelog

릴리스 단위가 아닌, 굵직한 surface 변경이 떨어졌을 때 한 항목으로 기록한다. 자세한 구현 상태는 [spec.md](./internal/spec.md), API 단일 소스는 [api-index.md](./internal/api-index.md), 기능↔테스트는 [feature-test-matrix.md](./internal/feature-test-matrix.md) 참조.

## 2026-08-10 — TypeSpec extension vocabulary v5 consolidation

Sidecar-less authored bundle의 extension vocabulary를 v5 하나로 통합하고, 완료된
roundtrip 이관 계획을 현재 운영 자료로 정리했다.

- `oa-sdk.typespec-extensions.v1`부터 v4까지의 parser support, fixture manifest, extension 문서를
  제거했다. bundle check는 v5 이외의 extension schema version을 거부한다.
- current source-of-truth는 v5 schema, authoring ownership guide, production operations로 구성한다.
  완료된 평가·migration·versioned roadmap 문서는 제거했고 ADR과 이 changelog는 결정 이력으로 보존한다.
- production TypeSpec source와 canonical fixture는 v5 manifest를 사용한다. 이 변경은 contract
  version이나 npm package version을 올리지 않는다.

## 2026-08-10 — Release policy v4 and documentation alignment

현재 release policy를 v4로 승격하고, policy manifest를 기준으로 문서의 workspace 분류와
버전 표기를 정렬했다.

- Core Platform은 `@oa-sdk/typespec-decorators`를 포함한 8개 package이며, Downstream 3개를
  더한 11개 package가 release-tracked다. 10개 maintenance/app workspace는 ignored 상태를 유지한다.
- npm distribution candidate는 core, openapi-projection-contract, typespec-decorators, parser,
  codegen의 5개다. 이 변경은 publish 승인이나 package version bump를 수행하지 않는다.
- `pnpm check:release-policy`는 release-management의 정책 스냅샷을 manifest에서 재계산해
  검증하므로, 이후 수동 count 표기 drift를 gate에서 차단한다.
- OAS 3.2 reference 분할본의 source·appendix 링크를 복구하고 이를 docs gate에 포함했다.
  ADR-004는 canonical 3.2 authoring과 generated 3.1 compatibility output의 경계를 분명히 한다.
- `@oa-sdk/schemas`의 기본 build와 prepack은 canonical TypeSpec contract에서 3.1 bundle을
  생성한다. CI는 bundle을 canonical 3.1 artifact와 비교해 stale package export를 차단한다.
- 사용자 가이드의 contract version 예시와 persona 도구의 merged-spec 복구 안내를
  TypeSpec-first 생산 경로로 정렬했다.
- persona check와 bundle artifact 비교 예제도 rollback source가 아닌 canonical TypeSpec
  artifact를 사용하도록 정리했다.

## 2026-07-25 — TypeSpec external observation evidence

spec-lens의 외부 경로 관측을 typed `observationInputs`로 승격했다.

- `candidate-only`는 revision 후보만 확장하고, `evidence-only`는 revision별 SHA-256 또는
  `missing`/`unreadable` 상태를 TypeSpec snapshot provenance에 보존한다.
- Local Git, GitHub, GitLab, file-diff adapter는 evidence를 data로만 bounded read한다. 이 입력은
  compiler entry, revision `tspconfig`, arbitrary emitter config로 절대 승격되지 않는다.
- 입력은 최대 16개이며, evidence는 파일 최대 4개(각 2 MiB, 총 8 MiB)를 adapter당 동시 2개씩
  읽는다. directory evidence는 `unreadable`로, 없는 경로는 `missing`으로 남긴다.
- 기존 `watchPaths`는 `candidate-only` 호환 별칭으로 유지한다. 실제 TypeSpec emitter fixture와
  adapter/cache/contract 회귀 테스트로 이 경계를 검증한다.

## 2026-07-24 — TypeSpec ownership, trusted helpers, and deployment projections

Production TypeSpec source의 composition/metadata/runtime 관측 경계를 명시적으로
분리했다.

- `main.tsp`는 composition root로 축소하고, service/info/server/tag,
  security scheme, reusable component metadata를 각각 `typespec/metadata/`의 owner
  module로 이동했다.
- `@oa-sdk/typespec-decorators`는 arbitrary JSON extension helper 대신 v5 response
  component reference를 검증하는 좁은 `@oaUseResponseComponent` helper를 제공한다.
  spec-lens는 이 trusted package의 source/lib/dist digest를 toolchain evidence에 포함한다.
- `oa-sdk.typespec-projections.json`과 `schema:project-typespec:{local,staging,production}`은
  restored TypeSpec contract에서 `servers`만 바꾼 gitignored deployment artifact를 만든다.
  이 projection은 승인 snapshot 또는 두 번째 contract source가 아니다.
- spec-lens TypeSpec project는 `observationInputs`로 lockfile, root package, trusted decorator
  package 변경을 관측한다. `evidence-only` lockfile은 hash/status provenance만 남기며, 모든
  observed path와 revision `tspconfig`는 compiler workspace에 실행/주입하지 않는다.

현재 기본 자동 감지 TypeSpec project의 `observationInputs`는 `package.json`, `pnpm-lock.yaml`,
`packages/typespec-decorators`다. 운영 절차는 [TypeSpec authoring conventions](./guides/typespec-authoring-conventions.md),
[basic spec usage](./guides/basic-spec-usage.md), [spec-lens](./spec-lens/README.md)에 정리했다.

## 2026-07-11 — Markdown과 GitLab agent operations 저장소 분리

Core schema/spec management가 아닌 제품 surface를 두 독립 Git 저장소로 물리 추출했다.

- `markdown-editor`: `@oa-sdk/markdown-editor`, GLFM reference, editor PRD와 자체 CI/lockfile을 소유한다.
- `gitlab-agent-ops`: `@oa-sdk/infra-gitlab`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/orchestrator-gitlab-ui`, GitLab context 설계와 운영 백로그를 소유한다. Markdown source는 복제하지 않고 `markdown-editor` submodule을 소비한다.

추출 이력은 각 저장소에 보존했다. `oa-sdk`에서는 네 workspace와 관련 product 문서를 제거하고,
release policy를 version 3의 네 track으로 축소했다: Core Platform 6, Downstream 3,
Maintenance 3, Applications 4. Changesets는 기존 9개 release-tracked package와 남은 7개 ignored
workspace만 관리한다. `spec-lens`의 GitLab source adapter는 spec observation 책임이므로 Core에 유지한다.

## 2026-06-22 — TypeSpec-first schema source switch (`@oa-sdk/codegen` 0.3.0)

ADR-009의 TypeSpec-first authoring 결정을 production schema build path에 반영했다. `packages/schemas/typespec/`가 production TypeSpec source bundle이고, 기본 `pnpm schema:validate`, `pnpm schema:bundle`, `pnpm schema:preview`, package-level `build`가 TypeSpec compile + OA SDK extension restore + expected/reference drift gate로 `packages/schemas/src/.merged.yaml`을 생성한다.

OpenAPI/Definition Builder path는 제거하지 않고 explicit rollback/reference command로 유지한다:

- `pnpm schema:validate:openapi`
- `pnpm schema:bundle:openapi`
- `pnpm schema:preview:openapi`
- `pnpm --filter @oa-sdk/schemas run build:openapi`

주요 게이트:

- `pnpm schema:validate` — TypeSpec source path + downgrade + Spectral/Redocly + strict OA SDK OpenAPI 3.2 validate.
- `pnpm schema:rollback-check` — TypeSpec gate와 OpenAPI/Definition Builder rollback gate 동시 검증.
- `pnpm schema:downstream-check` — TypeSpec-restored artifact를 parser/codegen/router/client/mock-server와 synthetic webhook/header compile smoke에 통과.
- `pnpm schema:bundle` — TypeSpec-derived 3.1 artifact를 `dist/openapi.{yaml,json}`으로 bundle.

현재 accepted restored-vs-reference drift는 0 entries다. reusable component identity는 `oa-sdk.typespec-extensions.v5`로 복원했고, response wrapper projection schemas, component schema metadata drift, operation/path metadata drift를 TypeSpec authoring 및 restore normalization으로 제거했다.

운영 정책은 `docs/internal/typespec-roundtrip/production-operations.md`로 분리했다. 당시 `@oa-sdk/codegen` `0.3.0`은 npm publish 대상이 아닌 내부 milestone이었고, rollback command 제거는 별도 deprecation/removal ADR 전까지 보류한다. 이후 제한된 레지스트리 배포 준비 상태는 release management 문서에서 별도로 관리한다.

## 2026-04-28 — SQLite driver priority inverted: prefer node:sqlite

`loadSqliteDriver()`가 `better-sqlite3` → `node:sqlite` 순서로 시도하던 정책을 뒤집어, 사용 가능한 런타임에서는 `node:sqlite`(Node 22.5+ 추가, Node 22.13+에서는 플래그 없이 사용 가능)를 우선 시도하고 `better-sqlite3`는 fallback으로만 사용한다.

근거 — 두 신호로 정책 변경 정당화 (자세한 내역은 `docs/internal/todo.md` "운영 관찰: SQLite optional native dependency 설치성"):

1. **Forced fallback functional**: `packages/codegen/src/__tests__/workspace-index-fallback.test.ts`가 `Module._load`를 monkey-patch해 두 driver 각각 / 양쪽 모두 require 실패시키며 `loadSqliteDriver` + `createSQLiteWorkspaceIndex` lifecycle을 검증. 5 cases pass — fallback 경로에 hardening 필요한 결함 없음.
2. **Driver benchmark**: `packages/codegen/scripts/bench-sqlite-driver.ts`가 75 file × 5 components × 5 refs 워크로드를 cold/warm 단계로 측정 (Node 24.15 / darwin arm64 / median of 3):
   - cold: better-sqlite3 22.2ms vs node:sqlite 26.6ms — 15-17% 차이 (≥30% 임계 미달)
   - warm: better-sqlite3 11.5ms vs **node:sqlite 7.9ms** — node:sqlite가 40-46% 더 빠름

Incremental 도구의 일반 동작은 warm path이므로 두 번째 결과가 더 결정적. 추가 효과: `better-sqlite3`는 native optional dep이라 환경별 install 실패 가능성이 있는데, node:sqlite를 우선하면 그 경로를 거의 타지 않는다.

호환성 영향:
- 기존 SQLite cache는 driver name이 meta에 저장되어 있어 첫 실행 시 `cache invalidation + full rebuild` 1회 발생. 이후 정상 동작.
- Node <22 환경에서는 자동으로 `better-sqlite3` fallback으로 감 (설치되어 있다면).

## 2026-04-27 — External OpenAPI Artifact Governance Scaffold

NestJS Swagger / FastAPI처럼 외부 프레임워크가 생성한 OpenAPI 산출물을 oa-sdk 계약 관리 파이프라인에 표준 방식으로 연결하는 일련의 도구가 추가되었다.

### CLI surface

`@oa-sdk/codegen`에 4개 명령 추가 (oa-gen CLI 명령 17 → 21):

- `oa-gen scaffold-governance --root <서비스> --service <이름> --profile <generic|nestjs-swagger|fastapi> [--source-command "..."] [--runtime-openapi-url "..."]` — `openapi-governance.config.json`(`oa-gen.openapi-governance.v1` schema), `scripts/openapi-governance.sh`, `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다.
- `oa-gen collect --spec <raw> --normalized <out> --upgraded <out> [--report <out>] [--raw <copy>] [--profile <profile>]` — raw 보존 + normalized governance artifact + OpenAPI 3.2 분석 artifact + collect report를 한 번에 생성.
- `oa-gen normalize --spec <raw> [--output <out>] [--profile <profile>]` — 의미 보존 normalize만(stable diff용).
- `oa-gen upgrade --spec <normalized> [--output <out>] [--report <out>]` — 3.0/3.1 → 3.2 변환만.

### Reference implementation

두 개의 작동하는 레퍼런스가 같은 scaffold 출력을 사용한다 — profile만 다름:

- `apps/nestjs-ref/` — NestJS 10 + Swagger 7 (TypeScript / pnpm), `--profile nestjs-swagger`.
- `apps/fastapi-ref/` — FastAPI 0.115 + Pydantic 2 (Python / uv), `--profile fastapi`.

두 곳 모두 `bash scripts/openapi-governance.sh all`이 collect → check-artifact → review → typegen → validate-upgraded까지 통과한다. `review-bundle`/`inventory`/`drift`/`update-baseline`도 별도 타깃으로 노출. FastAPI/NestJS profile은 빈 `info.contact` / 루트 `servers` / 루트 `tags` noise 제거 동작을 공유한다 (generic profile은 보존).

### Hardening

여러 라운드에 걸친 안정화:

- **Upgrade 재귀 보강**: `nullable: true`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}` 어디에 있어도 3.2 null union으로 변환. 이전엔 `#/components/schemas`만 처리해 inline schema가 누락되었음.
- **Clone 안전성**: `cloneJson`이 `structuredClone` 사용 — `JSON.parse(JSON.stringify())`로 인한 undefined/NaN 손실 제거.
- **Repo root 자동 감지**: 스크립트가 `git rev-parse --show-toplevel` 우선, 기존 `apps/<service>` 2-deep 가정은 fallback. 다른 깊이에서도 동작.
- **Friendly missing-baseline**: 첫 실행 시 baseline 없으면 `update-baseline` 힌트와 함께 exit 1.
- **Shell hardening**: `OA_GEN` env가 `read -ra OA_GEN_CMD <<<`로 split되어 glob 확장 없음. `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- **Runtime URL 검증**: `--runtime-openapi-url`을 scaffold time에 `URL` 파서로 검증, http(s) 외 protocol 거절.
- **Drift 인자 forwarding**: `bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"`처럼 추가 인자 그대로 전달.
- **Consumers field가 source of truth**: rendered 스크립트가 `consumers.{governance,review,typegen,inventory,validate,driftManaged}` 매핑을 셸 변수명으로 해소해 baked. 알 수 없는 mapping은 scaffold time 거절.
- **Config fingerprint**: 렌더링된 스크립트 헤더 `# config fingerprint: <16자 sha256>` 라인이 profile/source/artifacts/consumers 정렬 직렬화 해시. JSON hand-edit 후 re-scaffold 누락 시 visible 신호. `fingerprintGovernanceConfig()` public helper로 외부 도구가 재계산 가능.

### Public API

`@oa-sdk/codegen` root entry에 추가 export:

- 함수: `parseOpenApiCollectProfile`, `normalizeOpenApiDocument`, `upgradeOpenApiDocumentTo32`, `stringifyOpenApiYaml`, `createOpenApiCollectReport`, `createOpenApiGovernanceInterface`, `scaffoldOpenApiGovernance`, `formatScaffoldResult`, `fingerprintGovernanceConfig`
- 타입: `OpenApiCollectProfile`, `OpenApiCollectReport`, `OpenApiTransformWarning`, `OpenApiUpgradeReport`, `OpenApiGovernanceInterface`, `OpenApiGovernanceScaffoldOptions`, `OpenApiGovernanceScaffoldResult`

### Docs

- 신규: [`docs/guides/use-cases/nestjs-swagger-governance.md`](./guides/use-cases/nestjs-swagger-governance.md), [`apps/nestjs-ref/README.md`](../apps/nestjs-ref/README.md).
- 갱신: [`docs/guides/openapi-governance-service-template.md`](./guides/openapi-governance-service-template.md)(Adoption Checklist를 external-artifact / Definition Builder 두 경로로 분리), [`docs/guides/cli-setup.md`](./guides/cli-setup.md), [`README.md`](../README.md), [`docs/internal/api-index.md`](./internal/api-index.md), [`docs/internal/feature-test-matrix.{md,json}`](./internal/feature-test-matrix.md), [`docs/internal/spec.md`](./internal/spec.md).

### Gates

- 47 test files / 648 tests passing.
- `pnpm check:cli-spec` — 22 command entities (oa-gen 15 + oa-contract 7 manifest entries; the runtime CLI itself exports 21 commands, of which 15 are governance-tracked).
- `pnpm check:api-index` — exports와 문서 정합.
- `pnpm check:feature-tests` — 23 features / 86 test paths (신규 `external-openapi-governance-scaffold` 항목 등록).
