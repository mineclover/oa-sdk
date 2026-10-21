# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.
> 현재 Core Platform 우선순위는 [plan.md](./plan.md), artifact release 판단은
> [release-readiness.md](./release-readiness.md)를 따른다. 이 문서의 완료 항목은 구현·결정
> 이력이며, 현재 제품 roadmap 자체가 아니다.
> 증분 설계: [ADR-006 — SQLite 기반 증분 Workspace Index](./architecture/006-incremental-workspace-index.md)
> 다음 PRD: DPM runtime/storage 후속은 [Data Pseudonymization Manifest](../../tasks/prd-data-pseudonymization-manifest.md)와 [Goal 5](./goals/goal-5-dpm-runtime-storage-integration.md)를 참조. 외부 연동 backlog는 [MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md)를 참조.

---

## 현재 후속 판단

Definition Builder PRD(US-001~014), Domain Backfill PRD(US-001~009), Aggregation Governance PRD,
OA SDK-side Projection Contract work는 완료 이력이다. 현재 production `.merged.yaml`은
TypeSpec source에서 materialize하며, Definition Builder fragments/targets는 rollback/reference
경로로만 유지한다. legacy `merge.ts`는 제거됐다.

현재 release 또는 roadmap 판단에서 확인할 항목:

- public artifact 후보를 실제로 내보낼 때 package version, Changeset, release note와 external
  artifact repository review를 함께 확정한다.
- cross-repo bun-graph-db/MCP projection export 연동은 bounded Core integration backlog로 유지한다
  ([MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md)).
- DPM runtime/storage/API-DB 연결 후속은 maintenance/extraction context이며, 새 feature 착수에는
  [Platform Scope](./platform-scope.md)의 scope-reactivation decision이 필요하다.

OA SDK 기본 기능 안정화의 현재 작업은 문서·gate drift 감시와 bounded cross-repo projection
integration이다.

### [x] Historical — OpenAPI definition builder: current-domain fragment backfill
배경: 당시 migration plan에서 `packages/schemas/src/fragments`와 `packages/schemas/src/targets`를
Definition Builder authoring 경로로 사용했다. 이후 production authoring은 TypeSpec-first로
전환됐으며, 실행 상세는 [Definition Builder Domain Backfill PRD](../../tasks/prd-definition-builder-domain-backfill.md)를 따른다.
완료: 모든 구현 순서 완료. builder target은 `common`, `auth`, `health`, `me`, `users` 도메인까지
확장됐고 `build:merged`는 76 fragments, 63 selected nodes, 0 errors/warnings/infos 상태였다. 이
artifact 경로는 현재 rollback/reference evidence로 유지한다.
구현 순서:
1. 완료: `src/profiles/{local,staging,production}.yaml`의 `servers`를 profile별 parity target config로 복제하고, local parity target config selection을 테스트한다.
2. 완료: `src/domains/common/spec.yaml`의 schemas/responses/parameters/securitySchemes를 `shared/common` fragments로 분리하고 local refs를 `oa://...` canonical refs로 바꿨다.
3. 완료: `src/domains/health/spec.yaml`의 `/health`, `/health/stream`, `HealthStatus`를 path/schema fragments로 옮기고 shared response refs를 canonical refs로 연결했다.
4. 완료: `src/domains/users/spec.yaml`의 `/users`, `/users/{id}`, `User`, `CreateUserRequest`, `UpdateUserRequest`를 path/schema fragments로 옮겼다.
5. 완료: `oa-gen build-spec`로 canonical artifact와 diagnostics/collision reports를 생성한다.
6. 완료: Builder artifact를 기존 `downgrade-3.1.ts`, Redocly, Spectral, `oa-gen validate`, typegen 비교, router/client generation, mock-server handler/adaptor 생성 gate에 통과시켰다.
7. 완료: builder active path, `.merged.3.1.yaml` sidecar compatibility, and replacement gates를 문서화한다.
완료 기준 충족: 당시 builder가 `.merged.yaml`을 직접 생성하며 zero diagnostics 상태를 유지했다.
`.builder/local-parity-api.3.1.yaml` compatibility, downstream compatibility report, rollback-safe script
boundaries를 확인했다. 현재 production source의 기준은 TypeSpec validation이다.

## 2026-10-19 안정화 후속

2026-10-19 안정화 pass([최근 완료](#x-2026-10-19-시스템-안정화-pass))에서 고치지 않고 남긴 항목이다.

### [ ] `@traceId` trackingId를 공유하는 OpenAPI variant (설계 결정 필요)
배경: `x-oa-sdk-trace.trackingId`는 선언한 type과 그 mutator clone에 붙는다. 그래서 한 OpenAPI 문서 안에서 `@typespec/openapi3`의 visibility variant(`WidgetCreate`, `WidgetUpdate`)와 `MergePatchUpdate<T>` variant(`WidgetMergePatchUpdate`, 참조된 model의 `PartMergePatchUpdate`)가 원본과 같은 id를 갖고, `oa-gen trace --verify`가 `traceability/duplicate-tracking-id`를 보고한다. decorator 시점에는 merge-patch clone과 versioned snapshot clone을 구분할 수 없다. 이 한계는 [`packages/typespec-decorators/README.md`](../../packages/typespec-decorators/README.md)에 적혀 있다. 이 repo에는 `@traceId`와 `MergePatchUpdate`·`@versioned`를 함께 쓰는 `.tsp`가 없어 CI gate는 영향을 받지 않는다.
작업:
1. 같은 선언에서 나온 variant가 id를 공유하는 것을 허용할지, variant별 id를 파생할지 결정한다.
2. 공유를 허용하면 `packages/codegen/src/traceability/spec-traceability.ts`의 duplicate grouping이 TypeSpec provenance가 같은 선언으로 해소되는 중복 explicit id를 받아들이게 한다.
완료 기준: `@traceId`를 visibility·`MergePatchUpdate` variant와 함께 쓰는 fixture에서 `oa-gen trace --verify`가 결정한 정책대로 동작하는 테스트가 있다.

### [ ] 공유 type과 파생 scalar로 퍼지는 `@traceId`
배경: TypeSpec은 `interface B extends A`가 복제한 operation의 `parameters`와 `op b is a`·`model B is A`의 익명 body·return·property type을 복제하지 않고 공유한다. 그래서 그런 type의 member에 붙인 `@traceId`가 파생된 모든 operation·schema 아래에 나타난다. inline parameter와 property는 trace graph node가 아니라 `oa-gen trace --verify`도 이를 보고하지 않는다. 또 `@typespec/openapi3`는 `scalar B extends A`의 schema를 A의 extension과 함께 만들어 두 schema가 같은 trackingId를 갖고, `oa-gen trace --verify`가 `traceability/duplicate-tracking-id`를 보고한다. 두 경우 모두 이번 pass 전부터 있었고, [`packages/typespec-decorators/README.md`](../../packages/typespec-decorators/README.md)와 `lib/governance.tsp`에 known limit으로 적었다.
작업:
1. id를 가진 parameters model이나 익명 type이 둘 이상의 concrete operation·model에서 도달 가능하면 `$onValidate`에서 진단할지 결정한다(`operationsByParameters`가 공유 관계를 이미 안다).
2. 파생 scalar는 trace 쪽에서 base scalar provenance로 중복을 해소할지, decorator가 경고할지 결정한다.
완료 기준: 두 경우의 fixture에서 결정한 정책대로 진단하거나 `oa-gen trace --verify`가 통과하는 테스트가 있다.

### [x] `@oa-sdk/client` TanStack `TError`에 transport 오류 포함
배경: `packages/client/src/tanstack/options-factory-generator.ts`와 `hook-factory-generator.ts`는 error model이 있으면 query·mutation error 타입을 `<Op>Error`로만 둔다. 실제로 reject될 수 있는 네트워크 오류, abort, `ApiClientResponseError`는 `TError`에 없다. 지금은 [client and query consumption](../guides/client-and-query-consumption.md) 가이드가 `instanceof`로 좁히는 방법을 안내한다.
작업: `TError`를 `<Op>Error | Error`로 넓힐지 결정하고, 넓히면 두 생성기, 생성 결과 테스트, 가이드를 함께 바꾼다.
완료 (2026-10-22): 두 생성기의 error model 타입을 `<Op>Error | Error`로 넓혔다. 옵션 팩토리·훅·생성 결과 테스트와 [client and query consumption](../guides/client-and-query-consumption.md) 7.3절을 함께 바꿨다.

### [ ] `ScenarioMachineContext.customData`의 TypeSpec 정의
배경: `packages/spec-lens-contract/src/scenario/types.ts`의 `ScenarioMachineContext`에는 `customData?: Record<string, unknown>`이 있지만 `scenario.tsp`의 `model ScenarioMachineContext`에는 없다. 이번 pass 전부터 있던 TS·TypeSpec drift다.
작업: `scenario.tsp`에 `customData?: Record<unknown>;`(필요하면 `@doc`)을 추가할지, TS field를 없앨지 결정한다.
완료 기준: 두 정의의 field 집합이 같다.

### [ ] ast-sync에 남은 type boundary
배경: 이번 pass의 대상 밖이라 그대로 둔 boundary다. `packages/ast-sync/src/adapters/json-schema.ts`의 `read()`·`patch()`와 `adapters/typia.ts`의 `default` tag 값은 `JSON.parse` 결과를 검증 없이 쓴다. `checker/cycle-detector.ts`(TypeScript `symbol.id`, `__tempDir`), `checker/program.ts`(`__tempDir`), `guards/generator.ts`(Ajv·standalone default export, format validator)에는 명시적 `any`가 남아 있다.
작업: `JSON.parse` 결과를 이름 있는 validator로 검증하고, `any` 접근을 modeled type이나 guard로 바꾼다.
완료 기준: `pnpm type-registry:check`의 boundary evidence에 이 파일들이 나오지 않는다.

### [ ] `oa-gen generate:tanstack --tier hooks`의 vue·svelte hook
배경: `packages/codegen/src/cli/commands/generate-tanstack.ts`는 `--tier hooks`이면 `--framework vue|svelte`에서도 `includeHooks`를 켠다. `@oa-sdk/client`의 hook 생성기는 React 형식의 `use*` hook을 만들기 때문에, 그 출력이 `@tanstack/vue-query`·`@tanstack/svelte-query`를 import하면서 React 전용 API 형태를 쓴다. 이번 pass 전부터 있던 동작이며 문서에 없다.
작업: vue·svelte에서 `--tier hooks`를 거부할지, framework별 hook 생성기를 둘지 결정하고 CLI 도움말과 [CLI command reference](../guides/cli-command-reference.md)를 맞춘다.
완료 기준: vue·svelte target의 `--tier hooks` 결과가 해당 패키지에 대해 type-check되거나, 명확한 오류로 거부된다.

## spec-lens 잔여 항목

### [x] RefreshTimeline 병렬 revision 처리
완료: Promise.all로 전체 캐시 조회 병렬화, withConcurrency(4)로 미캐시 빌드 병렬화, 저장은 SQLite WAL 제약상 순차 유지. snapshots 배열은 원래 순서 재조합하여 diff 계산 보존.

### [x] GitLab 어댑터 검증
배경: `GitlabAdapter`(REST API 기반)는 구현되었으나 실제 GitLab 인스턴스 대상 통합 테스트가 없었다.
완료 (2026-04-27): 로컬 GitLab CE 인스턴스(`http://localhost:8929`)에서 4 케이스 통합 테스트 추가 — `listRevisions`(fragments path filter + branch + commits 정렬), `getFileEntries`(tree pagination + file content + sha256 contentHash), 연속 revision 간 content drift 감지, 401/403 auth 에러 메시지 정합성. 테스트는 `GITLAB_INTEGRATION_{HOST,PROJECT_ID,TOKEN,FRAGMENTS_DIR}` 환경변수가 모두 있을 때만 실행되고 그 외엔 깨끗하게 skip — CI 안전. 운영 가이드는 [packages/spec-lens/README.md](../../packages/spec-lens/README.md) 참조.
REST vs bare-clone 결정: REST API 방식 유지. 이유는 (1) 4 케이스 모두 통과해 refresh/timeline 흐름이 검증됨, (2) bare-clone 전환은 `getFileEntries`의 tree pagination 비용을 한 번에 줄일 수는 있지만 git 의존성을 추가하고 GitLab 토큰 → SSH/HTTPS 자격 매핑이 추가 복잡도를 가져옴, (3) GithubAdapter가 bare-clone으로 간 이유는 GitHub API rate limit이 좁기 때문이고 self-hosted GitLab은 같은 압력이 없음. 변환은 rate limit 압력이 실제로 발생할 때 재고려.
완료 기준 충족: 실제 GitLab 레포 대상으로 refresh + 타임라인 + diff 흐름 모두 통과 (`gitlab-adapter.integration.test.ts`).

---

## 추출된 GitLab agent operations 기록

2026-07-11에 infra, orchestrator, UI와 관련 운영 백로그를 독립 `gitlab-agent-ops` 저장소로 옮겼다.
이 저장소의 TODO는 schema/spec platform과 남아 있는 maintenance package만 관리한다.

## 잔여 보완 작업

### [x] 외부 OpenAPI artifact governance scaffold (NestJS Swagger, FastAPI 등)
배경: NestJS Swagger / FastAPI처럼 코드퍼스트로 OpenAPI를 생성하는 외부 프레임워크 산출물을 oa-sdk governance 파이프라인에 표준 방식으로 연결할 수단이 없었다.
완료 (2026-04-27): `oa-gen scaffold-governance` / `collect` / `normalize` / `upgrade` CLI 4종을 `@oa-sdk/codegen`에 추가. scaffold는 `openapi-governance.config.json` (artifact interface + consumer 매핑), `scripts/openapi-governance.sh` (collect/check/review/review-bundle/typegen/inventory/validate-upgraded/drift/update-baseline/all), `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다. `apps/nestjs-ref`(NestJS 10 + Swagger 7, `--profile nestjs-swagger`)와 `apps/fastapi-ref`(FastAPI 0.115 + Pydantic 2, `--profile fastapi`)를 두 레퍼런스 구현으로 추가했다 — 두 profile 모두 빈 `info.contact`/루트 `servers`/루트 `tags` noise 제거 동작을 공유한다.
하드닝:
- 스크립트가 `git rev-parse --show-toplevel`로 repo root를 자동 감지하고, baseline 미존재 시 `update-baseline` 힌트와 함께 친절한 exit 1을 낸다.
- `OA_GEN` 환경변수 split이 glob 확장하지 않도록 `read -ra OA_GEN_CMD <<<` 사용.
- `--runtime-openapi-url`을 scaffold 시 `URL` 파서로 검증해 http(s) 아닌 값을 거절.
- `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- `upgradeOpenApiDocumentTo32`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}`를 모두 재귀 순회하여 nullable 변환을 빠뜨리지 않는다.
- `cloneJson`은 `structuredClone` 사용으로 undefined 손실 방지.
완료 기준: 레퍼런스 앱에서 `bash scripts/openapi-governance.sh all`이 collect → check → review → typegen → validate-upgraded까지 통과하고, 신규 4 CLI는 manifest/api-index/feature-test-matrix gates와 정합. 신규 helper 4개와 type 8개를 `@oa-sdk/codegen` public surface로 등록함.

### [x] OAS 3.2 coverage table drift 정리
배경: `docs/internal/oas32-coverage.md`의 런타임 지원 표가 일부 최신 구현을 반영하지 못한다. `Webhooks`는 parser/router/client/mock-server 쪽 테스트가 있고, `Encoding`도 multipart field-level handling 구현이 완료됐지만 표에는 일부 `—`로 남아 있다.
작업:
1. `docs/internal/oas32-coverage.md`의 `Webhooks`, `Encoding`, 관련 parser/mock-server/codegen/router/client 칸을 실제 구현 상태와 맞춘다.
2. 근거 테스트 파일을 `feature-test-matrix.json` 또는 표 주석에 연결할지 결정한다.
3. `pnpm check:feature-tests`를 실행한다.
완료: `docs/internal/oas32-coverage.md`의 `Webhooks`와 `Encoding` row를 실제 parser/mock-server/codegen/router/client 지원 상태에 맞추고, 보강 근거 테스트 파일을 표 아래에 추가함.
완료 기준: coverage 표가 `docs/internal/spec.md`와 모순되지 않고, 지원 범위와 non-goal이 구분된다.

### [x] Feature-test matrix assertion depth 보강 검토
배경: `pnpm check:feature-tests`는 경로 존재와 glob 매칭을 검증하지만, 각 capability가 실제 assertion으로 보호되는지는 검증하지 않는다.
작업:
1. matrix feature별로 대표 테스트 1~2개가 핵심 assertion을 포함하는지 샘플 리뷰한다.
2. assertion gap이 큰 feature에는 더 구체적인 `testPaths`를 추가하거나 신규 테스트를 작성한다.
3. 필요하면 JSON schema 수준의 필드 규칙을 강화한다.
완료: `feature-test-matrix.md`에 assertion depth policy를 추가해 drift guard와 semantic test runner의 역할을 분리하고, broad glob row는 대표 테스트 파일을 명시해야 한다는 관리 규칙을 문서화함.
완료 기준: matrix가 단순 파일 존재표가 아니라 회귀 방지 의도를 설명하는 수준으로 유지된다.

### [x] Preview app coverage 정책 결정
배경: `apps/preview`는 문서에 노출되어 있지만 현재 feature-test matrix의 핵심 검증 대상에는 포함하지 않았다. 현재 cross-package E2E 증명은 `apps/playground`가 담당한다.
작업:
1. `apps/preview`를 제품 surface로 볼지, 데모/수동 확인 surface로 볼지 결정한다.
2. 제품 surface라면 최소 smoke test 또는 build/typecheck script를 추가한다.
3. 데모 surface라면 docs에 자동 검증 범위 밖임을 명시한다.
완료: `apps/preview`는 브라우저 수동 프리뷰 surface로 두고, 자동 E2E 보증은 `apps/playground`가 담당한다고 `docs/README.md`에 명시함.
완료 기준: preview app의 품질 책임이 문서와 CI에서 모호하지 않다.

### [x] JSON-RPC batch support 결정
배경: bun-graph-db MCP OpenAPI full document는 현재 single JSON-RPC request만 문서화한다. 서버도 batch request를 처리하지 않는다.
작업:
1. MCP server가 batch를 지원해야 하는지 결정한다.
2. 지원한다면 `McpHttpServer`와 table-scoped MCP server 모두에 batch 처리와 tests를 추가한다.
3. 지원하지 않는다면 docs에 single-request only 정책을 유지한다.
완료: 현재 정책은 single JSON-RPC request only로 유지한다. `bun-graph-db projection 소비` 가이드에 batch가 필요하면 서버 구현과 static OpenAPI document를 함께 확장해야 한다고 명시함.
완료 기준: static OpenAPI document와 실제 MCP server 동작이 계속 일치한다.

### [x] GraphQL OpenAPI wrapper 범위 결정
배경: bun-graph-db full document는 stable REST/MCP endpoint discovery에 집중한다. GraphQL introspection 또는 selected GraphQL operation wrapper는 future question으로 남아 있다.
작업:
1. `/graphql` 자체만 문서화할지, selected GraphQL operation을 REST/OpenAPI wrapper로 제공할지 결정한다.
2. wrapper가 필요하면 별도 PRD로 분리한다.
완료: 현재 static full document는 selected GraphQL operation을 OpenAPI wrapper로 확장하지 않는다. GraphQL은 projection fetch transport 중 하나로 유지하고, stable endpoint/client/mock 생성은 `GET /api/openapi` 또는 table projection snapshot을 기준으로 한다고 문서화함.
완료 기준: GraphQL과 OpenAPI full document의 경계가 문서상 모호하지 않다.

### [x] 운영 관찰: SQLite optional native dependency 설치성
배경: `better-sqlite3`는 증분 WorkspaceIndex의 primary driver지만 native optional dependency라 환경별 설치 실패 가능성이 있음.
이전 정책 (2026-04-17 ~ 2026-04-28): 설치 성공 시 `better-sqlite3` 사용, 실패 시 `node:sqlite`, 둘 다 실패하거나 DB 오류가 나면 full rebuild fallback + CLI warning.
현재 정책 (2026-04-28~): 사용 가능한 런타임에서는 `node:sqlite`(Node 22.5+ 추가, Node 22.13+에서는 플래그 없이 사용 가능)를 우선 시도하고 `better-sqlite3`는 fallback. 지원 범위의 Node 22.0–22.12 일반 실행에서는 fallback이 적용될 수 있다. 호환성 영향: 기존 cache는 driver name meta가 다르므로 첫 실행 1회 cache invalidation + full rebuild이 일어나고 그 이후 정상.
시그널 #1 — Forced fallback 동작 검증 (2026-04-28): `packages/codegen/src/__tests__/workspace-index-fallback.test.ts`가 `Module._load`를 monkey-patch해 두 driver를 각각 / 양쪽 모두 require 실패시키며 `loadSqliteDriver()` + `createSQLiteWorkspaceIndex` lifecycle을 검증. 5 cases (better-sqlite3 fail → node:sqlite, full lifecycle, persistence across reopen, 양쪽 모두 fail 시 진단 메시지, node:sqlite fail → better-sqlite3) 모두 pass — fallback 경로에 hardening 필요한 결함 없음.
시그널 #2 — Driver 벤치마크 (2026-04-28, Node 24.15 / darwin arm64, 75 files × 5 components × 5 refs, median of 3): cold = better-sqlite3 22.2ms vs node:sqlite 26.6ms (15-17% 차이, 임계 30% 미달); warm = better-sqlite3 11.5ms vs **node:sqlite 7.9ms** (40-46% 더 빠름). 측정/스크립트는 `packages/codegen/scripts/bench-sqlite-driver.ts`, JSON은 `packages/codegen/.bench/sqlite-driver.json`(gitignored). 워크로드의 warm 경로가 incremental 도구의 일반 동작이라는 점에서 "better-sqlite3 우선" 정책의 perf 정당성이 사라짐 → 우선순위 inversion 결정.
완료 기준 충족: 두 시그널 확보 + 정책 변경 + 테스트/문서 갱신, codegen 655 tests / 48 files pass, repo gates(check:cli-spec/api-index/feature-tests) green.

### [x] 운영 관찰: Spectral response-example 힌트 4건
배경: `pnpm schema:validate`는 통과하지만 Spectral `response-example-recommended` hint가 4건 남아 있음.
현재 처리: 0 error / 0 warning / 4 hint로 문서화. schema correctness에는 영향 없음.
후속 기준: Prism/mock 예제 품질을 더 강화하기로 하면 `paths./users.get.responses[200]`, `components.schemas.Error`, `HealthStatus`, `User` 예제를 보강.
완료: `users` 목록 응답 inline schema와 `Error`, `HealthStatus`, `User` component schemas에 singular `example`을 추가해 Spectral `response-example-recommended` hint를 제거함. `pnpm --filter @oa-sdk/schemas run validate`, `pnpm --filter @oa-sdk/schemas test`, `pnpm check:feature-tests` 통과.

### [x] 운영 관찰: node:sqlite experimental warning in tests
배경: 실제 `SQLiteWorkspaceIndex`는 `better-sqlite3`를 primary로 잡지만, 일부 테스트 헬퍼가 DB meta 확인용으로 `node:sqlite`를 직접 열어 warning이 출력됨.
현재 처리: 기능 실패는 아니며 `better-sqlite3` driver 사용은 수동 검증 완료.
후속 기준: 테스트 로그 소음을 줄여야 하면 테스트 헬퍼도 selected driver adapter를 재사용하도록 정리.
완료: `workspace-index.test.ts`의 SQLite meta 확인 helper가 직접 `node:sqlite`를 require하지 않고 `loadSqliteDriver().open()`을 사용하도록 변경함. `pnpm --filter @oa-sdk/codegen test -- src/__tests__/workspace-index.test.ts`와 `pnpm --filter @oa-sdk/codegen typecheck` 통과, experimental warning 출력 없음.

---

## 완료된 실행 항목

### [x] Definition Builder Domain Backfill: legacy merge source inventory
배경: legacy domain specs를 fragment equivalents로 backfill하기 전에 기존 merge input surface를 빠짐없이 고정해야 함.
완료: [domain-merge-inventory.md](./domain-merge-inventory.md)에 `src/profiles/{local,staging,production}.yaml`, `src/domains/{common,health,users}/spec.yaml`, common shared components, health/users path operations, `.merged.yaml`/`.merged.3.1.yaml` artifact path, validation commands, and source-section-to-fragment-kind mapping을 기록함.
완료 기준: 후속 parity target, common fragment, health fragment, users fragment stories가 동일 checklist를 기준으로 migration completeness를 검증할 수 있음.

### [x] OpenAPI definition builder: migration comparison plan
배경: Definition Builder replacement가 승인되어 legacy `packages/schemas/scripts/merge.ts`를 제거함.
완료: `docs/internal/spec.md`에 legacy domain merge path와 `oa-gen build-spec` builder path를 side-by-side로 문서화하고, 기존 `openapi.yaml`/profile/domain sections가 어떤 fragment/target source로 이동하는지 정의함. `.merged.yaml`은 OpenAPI 3.2 canonical validation input으로, `.merged.3.1.yaml`은 기존 downgrade sidecar contract로 유지해야 한다는 compatibility gate를 명시함.
완료 기준: rollback은 git revert로 수행하며, builder output은 fragment/target source에서 `.merged.yaml`을 직접 생성함.

### [x] OpenAPI definition builder: WorkspaceIndex metadata integration
배경: large spec build에서 fragment-level 변경이 모든 target bundle을 무조건 dirty 처리하지 않도록, builder가 target/fragment dependency metadata를 WorkspaceIndex에 남겨야 함.
완료: `@oa-sdk/codegen`에 builder index adapter를 추가해 target config와 definition fragment source 파일을 scan하고, fragment id/content hash는 `definition-fragment` component row로, target bundle은 `definition-target` component row로 기록한다. Fragment source `$ref`는 fragment file → target fragment file `refs` edge로 저장하고, target config는 direct path root fragment로 향하는 edge를 저장한다.
완료 기준: schema fragment 변경이 fragment ref graph를 거쳐 dependent target만 dirty 처리되는 테스트, target config 변경이 해당 target만 dirty 처리되는 테스트, no-op fallback에서 scanned target을 full rebuild 대상으로 취급하는 테스트가 통과함. SQLite schema shape는 변경하지 않아 existing ADR-006 driver fallback/full rebuild 원칙을 유지한다.

### [x] OpenAPI definition builder: CLI artifact build entry
배경: target selection과 OpenAPI emit이 parser에 구현되었으므로 로컬/CI에서 target config를 지정해 builder artifact와 sidecar reports를 생성할 entry가 필요함.
완료: `@oa-sdk/codegen` CLI에 `oa-gen build-spec --target ...` 커맨드를 추가함. Target config sibling `../fragments`를 기본 fragment root로 사용하고 `--fragments`로 override할 수 있으며, valid build는 `--output` OpenAPI YAML artifact 또는 stdout으로 출력한다. `--diagnostics`는 registry/target/output-name/emit diagnostics JSON을 실패 시에도 기록하고, `--collision-report`는 target-local naming collision report row array를 machine-readable JSON으로 기록한다. `--metadata-registry`는 output pointer별 internal metadata, identity/stable key, tracking id, source refs, example source pointers를 기록하고 duplicate output pointer/tracking/stable key, invalid tracking id, invalid replacement id를 diagnostics로 승격한다.
완료 기준: duplicate canonical id, missing/unsupported source ref, target disallowed ref, output name collision, unrewritten ref, emitted document validation error가 있으면 output artifact를 쓰지 않고 exit code 1로 종료함. CLI tests가 success artifact/report 생성, duplicate canonical ID failure, unresolved required ref failure를 검증함. Public package exports는 변경하지 않아 `docs/internal/api-index.md` 업데이트는 불필요함.

### [x] OpenAPI definition builder: OpenAPI document emit
배경: target selection 결과를 기존 `.merged.yaml` 교체 없이 병렬 검증 가능한 OpenAPI 3.2 artifact로 만들 수 있어야 함.
완료: `emitDefinitionOpenApiDocument()`가 selected target result를 받아 root `openapi`/`info`/`servers`/`paths`/`webhooks`/`components` document를 생성함. Emit은 target-local output name allocation을 ref rewrite에 주입하므로 output에는 local OpenAPI `$ref`만 남고, source ref가 남으면 `definition-openapi-emit/unrewritten-ref` error diagnostic으로 실패함. `itemSchema`, `dataValue`, `serializedValue` 같은 OAS 3.2 field는 content filter 없이 보존하며, renamed definition alias metadata는 `x-oa-sdk-definition-aliases` root extension과 result sidecar report에 포함함.
완료 기준: emitted document가 `validateDocument()`를 통과하는 parser 테스트, book/notebook `Note` source-name collision이 `BookNote`/`NotebookNote`로 materialize되는 테스트, public book+notebook fixture target 검증이 통과함. 기존 `.merged.yaml` 교체는 후속 CLI/migration story로 남김.

### [x] OpenAPI definition builder: target bundle configuration and selection
배경: public/admin/internal target별로 선택된 scopes, domains, servers, paths만 후속 OpenAPI emit에 넘길 수 있어야 함.
완료: `DefinitionTargetConfig` format을 `name`, `scopes`, `domains`, `servers`, `includePaths`, optional `namingPolicy.aliases`로 고정하고, `selectDefinitionTarget()`가 exact path match에서 시작해 registry ref edge를 재귀 순회함. Shared + target-specific scopes를 함께 선언할 수 있으며, configured scope/domain 밖의 recursive ref는 `definition-target/disallowed-ref`, 매칭되지 않는 include path는 `definition-target/path-not-found` error diagnostic으로 보고함. Selection 결과는 selected nodes/refEdges/directPathIds와 target-local `allocateDefinitionOutputNames()` 결과를 함께 제공함.
완료 기준: public/admin target selection이 각각 직접 매칭된 path와 shared + target-specific schema/parameter/response/requestBody refs를 포함하고 반대 target node를 제외하는 parser 테스트, target-local naming alias가 다른 target으로 새지 않는 parser 테스트, public/admin/internal target fixture shape 검증이 통과함.

### [x] OpenAPI definition builder: duplicate and dedupe policy
배경: structural similarity가 semantic identity를 암시하지 않도록 canonical id, output name, schema hash 중복 정책을 명시해야 함.
완료: registry가 duplicate canonical id를 계속 error로 처리하고, 같은 schema content hash가 다른 canonical id에서 발견되면 기본 `info` severity의 `definition-registry/structural-duplicate` diagnostic만 생성하도록 함. `nodes`와 `nodeById`는 canonical id별로 유지되어 동일 shape라도 다른 의미의 정의는 자동 병합되지 않음. 의도적 semantic dedupe는 `metadata.semanticAliasOf`가 등록된 canonical id 또는 `oa://...` ref를 가리킬 때만 `semanticAliases`로 기록됨.
완료 기준: 동일 shape/different meaning이 별도 registry node로 남고 info diagnostic만 생성되는 테스트, explicit semantic alias metadata만 structural duplicate warning을 suppress하고 alias metadata를 생성하는 테스트, 기존 duplicate output name collision/naming policy 테스트가 통과함.

### [x] OpenAPI definition builder: path flattening guard simulation
배경: `schema:public/a/Name`과 `schema:public/aname/Name`처럼 canonical path가 다른 정의가 naive flattened output name에서 같아져도 semantic identity가 같다고 추론하면 안 됨.
완료: `schema:public/a/Name`, `schema:public/aname/Name`, `schema:public/a-name/Name`, `schema:admin/a/Name` fixture를 추가하고 public/admin target fixture에 포함함. Parser 테스트는 네 canonical ID가 registry에서 모두 distinct node로 유지되는 것을 확인한 뒤, 세 public fixture가 모두 attempted output name `AName`으로 매핑되는 flattened naming simulation을 실행해 `definition-output-name/collision` diagnostic과 `collisionReport`의 `output-name-collision` error row를 검증함.
완료 기준: collision diagnostic은 attempted output name과 모든 colliding canonical IDs를 포함하며, default fail-on-collision policy에서 builder가 semantic dedupe나 임의 rename 없이 실패함.

### [x] OpenAPI definition builder: output naming and collision simulation
배경: 같은 local name `Note`라도 book note와 notebook note는 의미가 다를 수 있어 source 정의를 바꾸지 않고 output naming으로 충돌을 해결해야 함.
완료: `allocateDefinitionOutputNames()`가 target에 포함된 component-like registry node 집합 안에서 output name을 할당함. Explicit alias가 있으면 우선 적용하고, alias가 없는 unique local name은 preserve-if-unique로 보존하며, 같은 kind/local name이 target 안에서 충돌하면 domain-prefix로 `BookNote`/`NotebookNote`처럼 분리함. 결과는 canonical id → output name map, canonical id → policy reason 포함 alias metadata map, target name/scope/domain/localName/outputName/reason/severity를 담은 machine-readable collision report를 제공하고, 최종 output name collision은 자동 병합하지 않고 `definition-output-name/collision` error diagnostic으로 보고함.
완료 기준: unique name preserve, cross-domain local name collision, explicit alias, public/admin target fixture 기반 target-local report, output ref rewrite 연동이 parser/schemas 테스트로 검증됨. Full target fixture emit은 다음 target bundle emit 단계에서 다룸.

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

### [x] WebMCP relay protocol 안정화
배경: `packages/webmcp-peer`의 코드와 테스트에서 relay protocol 초안 [webmcp-relay-protocol.md](./webmcp-relay-protocol.md)를 추출했고, 초안은 코드끼리, 또는 코드와 문서가 어긋난 곳 60건(O-01~O-60)을 열린 문제로 올렸다.
결정과 완료 (2026-10-20): 권고안을 모두 채택하고 0.1.0에서 breaking wire 변경을 냈다. 8개 cluster(공유 상수, 오류 모델, 만료·rotate, 승인·lease, MCP 라우팅, signaling, WebSocket, HTTP 보안)가 O-01~O-58을 구현했고, 문서 단계가 O-59·O-60을 마쳤다: spec을 [정본 표](../spec-governance/README.md)와 `.ai/spec-loader.yaml`에 올리고, README·api-index·relay guide·개념 문서·보안 감사가 요약하며 spec을 링크하게 했으며, spec 10장을 결정 기록(결정마다 commit·changeset)과 남은 열린 문제 O-61~O-68로 바꿨다. 테스트가 없던 요건에 회귀 테스트를 더했고 남은 둘(R-HTTP-016, R-HTTP-017)의 이유를 O-60에 적었다. `packages/webmcp-peer/test/protocol-spec.test.ts`가 spec과 코드·테스트의 일치를 검사하고, [feature-test matrix](./feature-test-matrix.md)에 `webmcp-relay-protocol-conformance` row로 올렸다. 동작 변경은 [changelog](../changelog.md)와 `.changeset/webmcp-peer-protocol-c1-foundation.md`~`c9-docs.md`에 있다.
검증: `pnpm --filter @oa-sdk/webmcp-peer typecheck`·`test:ci`, `check:docs`, `check:spec-governance`, `test:docs-gates`, `check:feature-tests`, `check:api-index`, `type-registry:check`가 통과한다. 적합성 검사는 spec에 결함(중복·미정의 ID, 없는 테스트 제목, 틀린 상한 값 등)을 하나씩 넣었을 때 해당 검사가 실패함을 확인했다.
후속: O-61(rotate의 rate limit)은 review 수정에서 결정하고 구현했다(spec 10.1). review가 spec 10.2에 올린 O-62~O-69(WebSocket id 없는 `tools/call`, provider의 `list_changed`, client와 relay의 pending 수, 만료가 덮어쓰는 ticket status, 401 challenge와 OAuth discovery, revoke의 왕복, provider의 방어용 오류, 두 번째 session이 다시 쓰는 넘겨받은 `transport`의 `onMessage`)도 2026-10-21에 결정하고 구현해 spec 10.1로 옮겼다. O-66은 사용자가 relay가 bearer ticket만 쓰고 OAuth discovery를 제공하지 않는 안을 골랐다. 동작 변경은 `.changeset/webmcp-peer-protocol-c10-open-problems.md`에 있다. 그 구현과 재확인 수정들의 검증이 재현한 O-70~O-77 가운데 agent client의 O-73~O-77(답이 이미 온 늦은 send와 다른 session의 늦은 send, 끝난 connect가 늦게 다시 연 넘겨받은 `transport`의 실패한 connect와 바뀐 `PeerMcpService` session, transport를 얻는 동안 온 종료 frame)은 2026-10-21에 transport와 요청 id의 모델 하나(transport 객체마다 살아 있는 연결 하나, 붙든 연결만 닫는 transport, 연결과 함께 끝나는 id와 slot, 연결을 마치기 전에 끝난 connect의 실패)로 결정하고 구현해 spec 10.1로 옮겼다. 남은 provider와 요건 문장의 O-70~O-72(끝난 연결의 답을 막는 검사와 보내는 곳 사이, run을 알릴 때 던지는 host의 CRDT transport, R-PEER-013의 JSON-RPC 오류 문장)도 2026-10-21에 권고대로 결정하고 구현해 spec 10.1로 옮겼다(검사한 turn에 보내는 답, 기록만 하는 run 알림의 실패, params 무효와 host 호출 밖의 예외만 JSON-RPC 오류로 적는 R-PEER-013). 그 결정들의 재확인이 재현한 낮은 심각도의 결함(넘겨받은 `transport`에 `onMessage`를 달지 못한 connect, transport를 얻기 전에 연결이 끝난 connect의 transport 호출, 연결이 끝난 connect 시도를 돌려주는 `connect()`, 기록 없이 버린 DataChannel `tools/call`의 transport 예외)과 코드와 다르게 적은 요건 문장(R-PEER-016, R-PEER-045)도 같은 날 고쳤다(spec 11장). spec 10.2에 남은 열린 문제는 없다.

### [x] Feature-test matrix에 없는 영역
배경: [feature-test-matrix.json](./feature-test-matrix.json)에 row가 없어 이번 pass에 추가한 회귀 테스트 일부가 matrix에 연결되지 않는다.
- `@oa-sdk/telemetry`: `packages/telemetry/test/*.test.ts`(새 `hmac-sha256.test.ts` 포함)
- chunk-stream 계열 5개 package와 `@chunkStream` decorator: 새 `packages/typespec-decorators/src/chunk-stream.test.ts`
- spec traceability와 governance decorator: `packages/codegen/src/__tests__/traceability/*.test.ts`(새 `typespec-trace-id-copies.test.ts`), `packages/typespec-decorators/src/governance*.test.ts`
- TypeSpec plugin pipeline 중 rpc·wire 밖의 부분: `packages/codegen/src/__tests__/plugin/*.test.ts`, `test/e2e/typespec-plugin/**`(새 `tier3-combinations/shipped-plugins-typecheck.test.ts`)
- Spec-Lens UI scenario navigation: 새 `apps/spec-lens/src/App.test.tsx`, `scenario/navigation.test.ts`, `scenario/views/ScenarioFlowModal.test.tsx`
작업: 영역마다 feature row를 추가하고 [feature-test-matrix.md](./feature-test-matrix.md)에 대표 테스트를 적은 뒤 `pnpm check:feature-tests`를 실행한다.
완료 (2026-10-20): `feature-test-matrix.json`에 `telemetry-runtime`, `chunk-stream-runtime`, `spec-traceability-governance`, `typespec-plugin-pipeline`, `spec-lens-scenario-navigation` row 5개를 추가하고 `feature-test-matrix.md`에 같은 순서로 대표 테스트를 적음. `typespec-plugin-pipeline`의 plugin glob은 `plugin-rpc`·`plugin-wire` 테스트도 매칭하지만 그 기능의 소유 row는 기존 `typespec-rpc-contract-runtime`, `wire-binary-codecs`로 유지한다.
완료 기준: 이번 pass의 새 테스트 파일이 모두 matrix row에 연결된다.

### [x] WebMCP relay 남은 강화 항목
배경: 2026-10-19 relay 메시지 상한 작업([최근 완료](#x-webmcp-relay-메시지-상한과-register-크기)) 뒤에 남은 다섯 항목이다.
완료 (2026-10-20, [changelog](../changelog.md)):
1. relay는 room마다 마지막으로 평가한 `register` frame의 fingerprint(`registerSeq`를 뺀 frame의 SHA-256)와 그 frame이 남긴 room catalog(version·hash)를 기억한다. 같은 frame은 room catalog가 그대로인 동안 다시 정규화·hash하지 않고 같은 답(거부면 그 frame의 `registerSeq`를 담은 같은 거부)을 돌려준다. catalog를 바꾸지 않는 frame(거부되거나 이미 가진 catalog)은 room마다 한 번에 8개(`REGISTER_EVALUATION_BURST`), 그 뒤로 초당 1개까지만 평가하고, 그 사이에 온 frame은 기다리다가 provider의 다음 `register`로 바뀐다. 마지막 frame은 늦게라도 항상 평가되므로 rate 때문에 거부하는 새 오류가 없고 provider SDK는 바뀌지 않는다. budget은 room에 속해 provider socket을 바꿔도 초기화되지 않는다. 테스트: `server-register-evaluation.test.ts`.
2. relay는 `requestId`가 JSON 1 KiB(JSON-RPC id와 같은 상한, 이제 `PEER_RELAY_MAX_REQUEST_ID_BYTES`로 server·client가 공유하는 내부 상수)를 넘는 offer를 전달하지 않고 `{ type: "offer.refused", error: REQUEST_ID_TOO_LARGE }`(id는 되돌려 주지 않음)로 답한다. provider의 `answer`·`release`가 그 id를 되풀이한다. 테스트: `relay-message-limit.test.ts`. provider 쪽 방어(상한을 넘는 `answer`를 보내지 않음)는 그 bound가 없는 relay를 가정한 `provider-register-limit.test.ts`가 계속 확인한다.
3. 결정: queue한다. `PeerMcpSession`은 relay socket(`raw`가 아닌 transport)에서 진행 중 요청을 `PEER_RELAY_MAX_PENDING_REQUESTS`(64, `./config`와 root에서 export하고 relay도 같은 값을 쓴다)개까지만 보내고, 나머지는 순서대로 기다렸다 앞선 요청이 답을 받으면 보낸다. relay가 답할 때까지 요청을 세므로 호출자가 timeout으로 포기한 요청도 답이 올 때까지 자리를 차지한다(client 기본 timeout 10초가 relay의 30초보다 짧다). 기다린 시간은 요청 timeout에 들어가고 `disconnect()`·transport 종료는 기다리는 요청도 끝낸다. relay가 id 없이 답하는 1 KiB 초과 id는 자리를 영영 돌려받지 못하므로 보내기 전에 `REQUEST_ID_TOO_LARGE`로 거부한다. Streamable HTTP transport(`raw`)는 POST마다 답을 받으므로 제한하지 않는다. 테스트: `client-pending-limit.test.ts`.
4. `upgradeWebSocket`은 호출 시점에 파기됐거나, peer가 이미 FIN을 보냈거나(`readableEnded`), 더 쓸 수 없는 socket에 101을 보내지 않고 파기하며, `send`는 곧바로 `'closed'`를 돌려주고 `onClose`는 반환 뒤 한 번 실행된다. 테스트: `server-ws-frames.test.ts`.
5. 결정: 넣는다. live demo provider의 `register`는 SDK처럼 증가하는 `registerSeq`를 담고, 거부를 그 번호로 frame에 맞춘다. 1번 이후 relay는 반복된 frame에 마지막 답을 다시 보내고 기다리는 동안 대체된 frame에는 답하지 않으므로 답의 순서로는 frame을 맞출 수 없다. 마지막 frame에 대한 거부만 Provider 배지(`catalogRefusal`)에 표시하고, 대체된 frame에 대한 거부는 wire log에 무시했다고 남긴다. 테스트: `live-demo.e2e.test.ts`.
검증: `pnpm --filter @oa-sdk/webmcp-peer test:ci`·`typecheck`, `type-registry:check`, `check:api-index`, `check:docs`, `check:feature-tests`가 통과하고, 새 테스트는 이전 코드에서 실패함을 확인했다.

### [x] root-level operationId `client`와 `client.ts`의 `ClientResponse` 충돌
배경: `pluginClient`는 예약어나 `client.ts`가 선언하는 binding과 겹치는 함수 이름에 `_`를 붙이므로 root-level operation `client`의 함수는 `client_`가 된다. 하지만 type 이름은 escape하지 않았다. 성공 응답이 있으면 `client.ts`가 types 파일에서 import하는 `ClientResponse`가 `client.ts`의 generic helper `ClientResponse<...>` 선언과 충돌하고, 성공 응답이 없으면 fallback `export type ClientResponse = void`가 같은 helper와 중복됐다.
결정과 완료 (2026-10-20): typegen이 아니라 client renderer에서 고쳤다. typegen의 operation type 이름(`<Base>Response` 등)은 `@oa-sdk/client`, router target, TanStack adapter, traceability가 `createOperationTypeNameMap()`으로 같은 규칙을 다시 계산해 쓰므로, typegen에서 바꾸면 그 소비자 모두를 함께 바꿔야 하고 `pluginClient`를 쓰지 않는 사용자의 types 파일도 달라진다. 대신 `client.ts`의 per-operation type(types 파일에서 import하는 이름과 `client.ts`가 선언하는 `<Fn>Data`·`<Fn>Response`·`<Fn>Errors`·fallback 등)은 module-scope type 예약 집합(`clientModuleScopeTypeNames(clientName)`: client class, helper type 8개, `client.ts`가 type 위치에서 참조하는 global type)과 겹치면 함수 이름처럼 `_`(이어서 `_2`, ...)를 붙인다. 겹치는 import는 `import type { ClientResponse as ClientResponse_ }`로 alias하고, star re-export에서 helper에 가려지므로 `export type { ClientResponse_ }`로 다시 export한다. 성공 응답이 없으면 fallback은 `export type ClientResponse_ = void`다. 예약 집합은 함수 이름 집합처럼 TypeScript checker로 생성 module에서 도출해 테스트가 고정한다. `clientName`과 같은 operation type 이름(`clientName: 'ListItemsResponse'`)도 같은 규칙으로 escape된다.
검증: `packages/codegen/src/__tests__/plugin/plugin-client.test.ts`의 root-level `client` fixture(성공 응답 있음·없음 × `clientClass` true·false)가 types 파일·`client.ts`·consumer 파일과 함께 type-check되고(escape를 끄면 실패), `test/e2e/typespec-plugin/fixtures/reserved-names`에 root-level `op client`를 더해 types·client·TanStack·adapter·hono router 조합이 type-check된다.

### [x] `pluginClient({ clientName })` 이름 검증
배경: `pluginClient`는 operation 함수 이름이 생성 module이 참조하는 global(`fetch`, `Response`, `Headers` 등)과 module binding을 가리지 않도록 escape하지만, 사용자가 준 `clientName`은 검증하지 않았다. `clientName: 'Response'`는 global `Response`를 가리는 class를 선언했다.
완료 (2026-10-20): `clientName`이 식별자가 아니거나, 예약어·TypeScript predefined type 이름(`string` 등)이거나, `client.ts`가 선언하는 다른 이름(value: `createClient`·`defaultClient` 등, type: `ClientConfig`·`ClientResponse` 등)이거나, 참조하는 global value·type(`fetch`, `Response`, `Record`, `RequestInit` 등)이거나, `client.ts`가 class를 참조하는 자리에서 묶는 이름(`TData`·`TError` type parameter, `createClient`의 `config` parameter)이면 `pluginClient`가 `CLIENT_INVALID_CLIENT_NAME` 오류 진단을 내고 `client.ts`와 `client:sdk` manifest를 만들지 않는다. renderer도 같은 메시지로 throw한다. operation 이름과 겹치는 `clientName`은 허용하고 operation 쪽 이름을 escape한다.
검증: `plugin-client.test.ts`의 `pluginClient clientName` 테스트가 `clientName: 'Response'`의 진단 전체를 확인하고, 예약 value·type 집합, checker로 도출한 class 참조 위치의 이름, 예약어, predefined type 이름, 식별자가 아닌 이름이 모두 거부되며, 그 밖의 이름(Unicode 식별자, operation과 같은 이름 포함)은 생성 코드가 type-check됨을 확인한다.

### [x] WebMCP relay 메시지 상한과 `register` 크기
배경: relay는 fragment로 나눈 message를 256 KiB까지 받았지만 frame 하나가 128 KiB를 넘으면 socket을 닫았다. 브라우저와 Node WebSocket client는 message를 frame 하나로 보내므로 실제 상한은 128 KiB였고, provider socket이 닫히면 room의 모든 agent가 끊겼다. provider는 `register` 크기를 확인하지 않아 큰 catalog가 auto-reconnect 아래에서 ready → register → close를 반복할 수 있었다.
결정과 완료 (2026-10-19): 상한은 하나다. relay 메시지는 단일 frame이든 단편화든 양방향 모두 `PEER_RELAY_MAX_MESSAGE_BYTES`(256 KiB)이고(`MAX_WEBSOCKET_FRAME_BYTES` = `MAX_WEBSOCKET_MESSAGE_BYTES`), relay는 받은 쪽에서 넘는 message에 RFC 6455 close code 1009로 socket을 닫는다. 대신 relay는 남의 message 때문에 받는 쪽 socket을 닫지 않는다. `PeerSocket.send`가 `'sent' | 'too-large' | 'busy' | 'closed'`를 돌려주고, relay는 보낸 쪽에 `REQUEST_TOO_LARGE`(HTTP 413)·`RESULT_TOO_LARGE`·재시도 가능한 `PROVIDER_BUSY`(HTTP 503)·`PROVIDER_UNAVAILABLE`로 답하며 agent traffic 때문에 provider를 끊지 않는다. agent 요청 상한은 보낸 그대로 `PEER_RELAY_MAX_REQUEST_BYTES`(256 KiB - 1 KiB)로, relay의 stamp와 wire id 재작성을 항상 담는다. `PeerMcpSession`은 `PROVIDER_BUSY`를 요청 timeout 안에서 재시도한다. provider는 relay 소켓으로 보내는 모든 frame을 미리 재고, `PEER_RELAY_MAX_CATALOG_BYTES`(256 KiB - 4 KiB)를 넘는 `register`를 보내지 않으며 `CATALOG_TOO_LARGE`를 남긴다. relay는 알림이 `PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`(256 KiB - 2 KiB)를 넘는 catalog를 거부하고, 거부는 `registerSeq`로 해당 `register`에 매칭된다. 같은 작업에서 relay WebSocket codec을 streaming parser로 다시 썼고(fragment 수 상한, 1002/1003/1007/1011 close code, 송신 queue 상한 1 MiB에서 닫지 않는 `'busy'`와 30초 정체 뒤 1013, 반쯤 닫힌 socket 파기와 close timeout, 한 번만 호출되는 `onClose`), agent가 요청한 응답을 늦게 읽는 agent에게도 순서대로 전달하는 outbox, 전달하는 모든 `mcp` envelope의 `from`/`sessionId` stamp, WebSocket `tools/list`의 relay catalog fallback, async upgrade hook 중 연결 reset으로 process가 죽던 문제를 더했으며, HTTP body를 끝까지 읽어 버려 413·`BODY_TOO_LARGE`가 실제로 도착하게 했으며, 크기를 넘거나 JSON object가 아닌 body로 approval·revoke·rotate가 실행되던 문제, request id·socket당 pending·ticket당 socket 상한, catalog hash의 `__proto__` 누락, client의 unhandled rejection을 함께 고쳤다. 동작은 [webmcp-peer README](../../packages/webmcp-peer/README.md)와 [changelog](../changelog.md)에 있다.
검증: `packages/webmcp-peer`의 `tsc --noEmit`과 vitest 전체(22 file)가 통과하고, 새 테스트(`server-ws-frames`, `relay-message-limit`, `relay-backpressure`, `server-http-body`, `provider-register-limit`, `client-request-limit`, `client-busy-retry`)는 이전 코드에서 실패함을 확인했다.

### [x] 2026-10-19 시스템 안정화 pass
배경: 전수 코드 리뷰에서 확인한 결함 146건(F001–F146)을 10개 cluster로 나눠 고쳤다. cluster는 TypeSpec plugin(`@oa-sdk/codegen/plugin`), codegen governance(trace·sketch·storage drift·`@traceId`), 바이너리 wire, webmcp-peer client·provider, webmcp-peer server, peer-server·peer-transport·mcp-mesh, telemetry, chunk-stream, rpc·router·client codec, Spec-Lens scenario·EWIC interop이다.
완료 (2026-10-19): 134건은 수정했고, 11건은 cluster 소유 파일 안에서 부분 수정한 뒤 다른 파일의 잔여분을 central 정리와 후속 cluster 작업으로 마무리했으며, 1건(F064, api-index 위치)은 문서 정리로 분류했다. 신규 테스트 파일 34개와 기존 suite 보강으로 회귀를 고정했다. `@oa-sdk/telemetry`, `@oa-sdk/webmcp-peer`, `@oa-sdk/peer-server`, `@oa-sdk/peer-transport`, `@oa-sdk/typespec-decorators`에는 Type Registry boundary evidence(명시적 `any`, 이중 assertion, 미검증 deserialize)가 남지 않았다. Type Registry gate는 명시적 `any` 249 → 134, 이중 assertion 37 → 27, 미검증 deserialize 175 → 118로 줄었고, budget을 그 값으로 낮췄다. 남은 detector false positive 9건(string→string percent-decoder `decode`, `TextDecoder.decode`, `unknown`을 돌려주는 generic JSON body codec)은 owner·만료일(2027-04-30)과 함께 [type-registry-policy.json](./type-registry-policy.json) allowlist에 올렸고, baseline은 review 후 `pnpm type-registry:write`로 갱신했다. `test/e2e/typespec-plugin`은 root script `pnpm test:e2e:typespec-plugin`으로 CI에 연결했다. `tests/e2e/output-routing-tanstack`이 2026-10-18 skill 재배치 뒤에도 옛 `.agents/skills/` 경로를 보던 것을 `.agents/skills-optional/`로 맞췄다. 동작 변경과 API 변경은 [changelog 2026-10-19 항목](../changelog.md)에, 구현 현황은 [spec.md](./spec.md)의 TypeSpec 계약 RPC와 바이너리 wire 절에, 새 테스트 등록은 [feature-test-matrix.md](./feature-test-matrix.md)(새 `webmcp-peer-routing` row 포함)에 반영했다.
검증 (2026-10-19 working tree): `build:all`(35 task), `build:scripts`, `typecheck:all`(56 task), `test:core:ci`, `test:downstream:ci`, `test:maintenance:ci`, `test:internal:ci`, `test:integration`, `test:e2e:typespec-plugin`, `test:e2e`가 통과한다. CI gate인 `type-registry:check`, `check:docs`·`test:docs-gates`, `check:cli-spec`, `check:api-index`·`test:api-index`, `check:codegen-boundaries`, `check:feature-tests`, `check:spec-governance`, `check:workspace-scope`(release policy·preflight), `check:dpm-surface`, codegen `smoke:pack`, schema validate(Spectral·Redocly·`--require-32`)·schemas test·freshness·rollback·`schema:downstream-check`, browser runtime smoke, `bench:parser`, public runtime smoke(Node 24·26), `check:ts7`, NestJS·FastAPI reference governance(`openapi-governance.sh ci`)도 통과한다.
잔여: 고치지 않은 후속은 [2026-10-19 안정화 후속](#2026-10-19-안정화-후속)에 둔다.

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
두 공개 커맨드는 공통 CLI incremental helper를 통해 scan → dirty detect → refs.to_file reverse invalidation → output generation → index refresh 순서를 공유. 기존 `dev` watch command는 private downstream 결합 제거 시 공개 registry에서 폐기했다.
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
- [x] 1676 테스트 (core 52, parser 230, codegen 495, mock-server 580, playground 114, router 36, client 39, schemas 77, typia-mock 53)

</details>
