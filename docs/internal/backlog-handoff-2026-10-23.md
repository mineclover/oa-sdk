# Backlog Handoff — cross-repo projection / DPM runtime

Last updated: 2026-10-23
Status: cross-repo projection complete (shared PRD US-001–US-013, MCP PRD US-001–US-009); DPM remains owner-gated
Scope: [MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md),
[Shared OpenAPI Projection Validation](../../tasks/prd-shared-openapi-projection-validation.md),
[DPM runtime/storage follow-up](./goals/goal-5-dpm-runtime-storage-integration.md)

## 결론

두 항목 모두 **oa-sdk에서 바로 구현을 시작할 작업은 아니다.**

| 항목 | 판단 | 먼저 필요한 것 |
| --- | --- | --- |
| cross-repo bun-graph-db/MCP projection | **완료 (2026-10-23).** pin 재고정, PRD reconciliation, US-013 full gate 통과 | 소스 저장소 GitHub Actions billing 복구만 남음 |
| DPM runtime/storage | Goal 5의 storage/runtime integration은 완료됐고, 남은 것은 **명시적으로 oa-sdk 범위 밖인 production data-plane**이다 | `mineclover/data-governance`의 owner decision/PRD, security·deployment 계약 |

## 현재 기준 상태

- `docs/internal/todo.md`에 열린 `[ ]` 항목은 없다. 두 항목은 active task가 아니라 backlog다.
- oa-sdk와 `oa-sdk-releases`는 clean, `origin/main`과 동기화되어 있다.
- 최신 릴리스는 `2026-10-23-tools-v0.2.2`이며 OIDC trusted publishing으로 배포됐다.
- 소스 저장소 GitHub Actions는 billing 문제로 시작되지 않는다. `pnpm ci:local`이 gate다.

---

## A. cross-repo bun-graph-db / MCP projection

### A.1 범위

이 backlog는 두 PRD로 나뉜다.

- [MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md): bun-graph-db의
  table-scoped MCP server에 `get-openapi-projection-{tableId}` tool을 추가하고
  `{ projection, validation }`을 반환한다.
- [Shared OpenAPI Projection Validation](../../tasks/prd-shared-openapi-projection-validation.md):
  OA SDK와 bun-graph-db가 `@oa-sdk/openapi-projection-contract`의
  `OpenApiProjectionResult`/`validateOpenApiProjection()`을 공유한다.

oa-sdk 쪽 contract work(US-002–US-007)는 완료되어 `@oa-sdk/openapi-projection-contract@0.2.0`으로
배포되어 있다. shared PRD US-001–US-013와 MCP PRD US-001–US-009는 완료로 정리했고,
**bun-graph-db 쪽 구현은 이미 origin/main에 올라가 있다.**

### A.2 확인된 구현

`references/bun-graph-db` submodule에서 확인한 파일:

- `src/core/schema/TableSchemaOpenApiProjection.ts`
- `src/core/schema/BunGraphDbOpenApiDocument.ts`
- `src/core/schema/RootMcpToolOpenApiProjection.ts`
- `src/presentation/mcp/factory/TableMcpServer.ts`
  - `get-openapi-projection-{tableId}` tool 등록
  - `openapi-projection/invalid-profile`, `service-unavailable`, `export-failed` 오류
- `src/presentation/mcp/schema/SchemaMapper.ts`
- tests:
  - `tests/unit/mcp-openapi-projection-tool-handler.test.ts`
  - `tests/integration/mcp-table-projection-tools-list.test.ts`
  - `tests/integration/projection-graphql-mcp-smoke.test.ts`

`bun-graph-db/package.json`은 `@oa-sdk/openapi-projection-contract`를
`file:../../packages/openapi-projection-contract`로 의존한다. 이는 published npm artifact가 아니라
같은 workspace layout의 OA SDK 패키지(version `0.2.0`)를 가리키는 의도된 개발용 경로다.
bun-graph-db의 `scripts/ci-versions.ts`와 CI workflow도 이 parent layout을 검증하므로,
두 저장소는 이 경계를 그대로 유지한다.

### A.3 검증 결과

`references/bun-graph-db`에서 실행:

```bash
bun run typecheck
bun test \
  tests/unit/mcp-openapi-projection-tool-handler.test.ts \
  tests/integration/mcp-table-projection-tools-list.test.ts \
  tests/integration/projection-graphql-mcp-smoke.test.ts
```

결과:

- `bun run typecheck`: 통과
- focused tests: **15 pass, 0 fail, 301 expect() calls, 3 files**

### A.4 발견된 정합성 문제 (우선순위 순)

1. ~~**부모 repo가 원격에 없는 submodule commit을 pin하고 있다.**~~ **Resolved 2026-10-23.**
   - 기존 부모 pin: `cecef25f94e02dc8ecd368547e7d2c071788812e` (bun-graph-db `origin/main`에 없음)
   - 정책: `references/bun-graph-db`를 **read-only reference**로 유지한다.
   - 로컬 92개 commit은 `backup/local-2026-10-23` branch에 보존했다(pin에는 포함하지 않음).
   - 부모 pin을 **`c065557` (`origin/main`)** 로 재고정했다. fresh clone에서 resolve 가능하다.
   - `origin/main`에서 `bun run typecheck`와 focused 3 tests(15 tests, 301 assertions)가 통과한다.
   - projection feature 자체는 원래부터 `origin/main`에 있었다(`5f2e4b2`, `d3007dd` 등).

2. ~~**PRD 상태가 실제 구현과 어긋난다.**~~ **Resolved 2026-10-23.**
   - `prd-shared-openapi-projection-validation.md`의 US-001–US-012를 실제 구현 기준으로 `[x]` 처리했다.
   - bun-graph-db origin/main에는 dependency, adapters, MCP tools, smoke tests가 이미 있다.
   - US-001 vocabulary reconciliation은 OA SDK adapter test와 양쪽 vocabulary 문서를 직접 확인해
     완료로 판정했다. bun-graph-db boundary doc은 package.json과 일치하므로 수정이 필요 없었다.

3. **oa-sdk CI는 submodule을 검사하지 않는다.**
   - `.github/workflows/ci.yml`은 `submodules: false`로 checkout한다.
   - cross-repo projection 회귀는 oa-sdk CI에서 잡히지 않는다.
   - 현재는 `references/bun-graph-db`의 focused test를 수동으로 실행해야 한다.

4. **contract release 경계가 있다.**
   - bun-graph-db는 OA SDK workspace의 contract 패키지(현재 version `0.2.0`)를 file dependency로 쓴다.
   - contract type/validator를 바꾸면 bun-graph-db는 같은 트리에서 즉시 영향을 받고,
     배포 소비자는 새 contract release가 필요하다.
   - published consumer용 contract release는 oa-sdk의 일반 patch release와 별도로 조정한다.

### A.5 권장 다음 작업

1. ~~**submodule 정책을 먼저 결정한다.**~~ **Done 2026-10-23.** read-only reference로 결정했다.
   - 부모 pin을 `origin/main`의 `c065557`로 재고정했다.
   - 로컬 92개 commit은 `backup/local-2026-10-23` branch에만 남겼다.

2. **PRD 상태를 reconciliation한다.** (완료)
   - shared PRD US-001–US-013와 MCP PRD US-001–US-009를 `[x]`로 표시했다.
   - MCP PRD는 typecheck/build/lint와 focused tests까지 완료됐다.
   - US-001 vocabulary reconciliation은 OA SDK 쪽 확인만으로 닫혔다. bun-graph-db boundary doc의
     local-file dependency 예시는 실제 `package.json` 및 `scripts/ci-versions.ts`와 일치하며,
     published package 사용 서술은 OA SDK handoff 문서 쪽 오류였다.

3. **cross-repo verification을 문서화하거나 CI에 추가한다.** (수동 gate 추가)
   - `scripts/check-cross-repo-projection.sh`와 `pnpm check:cross-repo-projection`을 추가했다.
   - 이 gate는 submodule HEAD가 `origin/main`에 있는지 확인한 뒤 typecheck와 focused 3 tests를 실행한다.
   - parent CI는 여전히 `submodules: false`이므로 자동 CI에는 넣지 않았다.

4. **parent pin과 문서를 함께 갱신한다.** (완료)
   - `references/bun-graph-db` pin
   - `docs/internal/todo.md`의 backlog 문구
   - `HANDOFF.md`의 cross-repo 상태
   - `tasks/prd-shared-openapi-projection-validation.md`, `tasks/prd-mcp-openapi-projection-tools.md`

### A.6 Final verification (2026-10-23)

- OA SDK: `pnpm ci:local` → `LOCAL CI: ALL PASS`.
- OA SDK schema: `pnpm schema:validate` 통과 (`oa-gen validate --require-32`, 0 warnings, 0 infos).
- Definition builder: 7개 target(`public`, `admin`, `internal`, `book-notebook`, `local/staging/production parity`)에 대해
  `oa-gen build-spec` + `oa-gen validate --profile full-api-document --require-32` 통과, diagnostics 0.
- bun-graph-db: `bun run typecheck`, `bun run build`, `bun run lint --max-diagnostics=20` 통과
  (lint는 Biome schema-version info 1건, 오류 없음).
- bun-graph-db projection/runtime/smoke: 11개 파일 **77 pass, 0 fail, 989 assertions**.
- `pnpm check:cross-repo-projection`: **15 pass, 0 fail, 301 assertions**, submodule HEAD = `origin/main` (`c065557`).
- worktree에는 이번 문서 변경만 남았고 temporary generated output은 남기지 않았다.

---

## B. DPM runtime/storage 후속

### B.1 현재 상태

[DPM runtime/storage integration](./goals/goal-5-dpm-runtime-storage-integration.md)은
**2026-07-01 complete**다. 포함된 범위:

- DPM-11: Postgres canonical registry schema/repository
- DPM-12: PostgreSQL read-only catalog profiler
- DPM-13: gateway runtime adapter (validate/compile/dry-run)
- DPM-14: job/validation report persistence
- storage-backed demo/smoke gate

`@oa-sdk/dpm`은 private, maintenance-only package이며 changeset/release track에서 제외되어 있다.
최신 local CI에서 dpm suite 121 files가 통과했다.

### B.2 남은 것으로 오해하기 쉬운 범위

[DPM master roadmap](./goals/dpm-master-roadmap.md)과
[platform scope](./platform-scope.md#dpm-temporary-reactivation--2026-07-14)는 다음을 **명시적
비범위**로 둔다.

- production token vault
- tokenization worker / row rewrite
- source DB mutation / physical FK creation
- control-plane search/edit/authoring/publish workflow (Phase 8)
- Phase 10 data-plane runtime 전체

Phase 10은 별도 runtime owner, security model, deployment authority가 필요한 **별도 제품**이다.
oa-sdk의 DPM temporary reactivation도 “production vault, tokenization worker, row rewrite,
physical FK mutation, control-plane search/edit/publish”를 활성화하지 않는다고 못박고 있다.

### B.3 소유권과 release 경계

- canonical external owner: `mineclover/data-governance`
- oa-sdk `@oa-sdk/dpm`은 extraction candidate / compatibility implementation
- public package metadata, registry publication, breaking removal은 owner-approved `T1` release gate
- 현재 no scope reactivation authorized

### B.4 권장 다음 작업

1. **oa-sdk에서는 코드를 시작하지 않는다.**
   - Goal 5 이후의 “runtime/storage”는 이미 완료된 storage integration이 아니라 production
     data-plane이므로, 새 PRD/decision 없이 `packages/dpm`에 추가하면 scope 위반이다.

2. **진행하려면 `mineclover/data-governance`에서 decision record를 먼저 만든다.**
   - user problem과 대상 dataset
   - runtime owner와 deployment authority
   - vault/tokenization security model
   - source DB read-only boundary와 rollback
   - data contract/versioning과 migration window
   - exit criteria와 release/CI 책임

3. **oa-sdk 쪽 역할을 명확히 한다.**
   - contract/compatibility adapter만 유지
   - 새 persisted schema, gateway workflow, cross-repo resolver, search/edit workflow는 owner 승인 전
     추가하지 않는다.

4. **Phase 8/9와 Phase 10을 섞지 않는다.**
   - search/edit/authoring(Phase 8)과 extraction rehearsal(Phase 9)은 owner-gated future branch다.
   - production data-plane(Phase 10)은 별도 runtime program이다.

---

## C. 공통 상태와 권장 순서

### 공통 블로커

- GitHub Actions billing이 복구되지 않아 소스 저장소 CI가 시작되지 않는다.
  `pnpm ci:local`이 현재 gate다.
- `NPM_TOKEN`은 OIDC-only workflow에서 사용되지 않으며 만료되도록 두었다.

### 권장 순서

1. ~~cross-repo submodule pin 정책 결정~~ — read-only reference, `c065557` pin (2026-10-23)
2. ~~pushed commit으로 pin 재고정~~ — 완료. ~~US-001 vocabulary reconciliation~~ — 완료.
   ~~US-013 full build/lint gate~~ — 완료 (A.6)
3. ~~cross-repo gate 실행: `pnpm check:cross-repo-projection` (수동)~~ — 완료
4. DPM은 owner decision 전까지 **no-op** 유지 (B.4)
5. GitHub Actions billing 복구 후 source CI를 다시 활성화

## 참고

- [MCP OpenAPI Projection Tools PRD](../../tasks/prd-mcp-openapi-projection-tools.md)
- [Shared OpenAPI Projection Validation PRD](../../tasks/prd-shared-openapi-projection-validation.md)
- [DPM runtime/storage integration](./goals/goal-5-dpm-runtime-storage-integration.md)
- [DPM master roadmap](./goals/dpm-master-roadmap.md)
- [Platform scope — DPM temporary reactivation](./platform-scope.md#dpm-temporary-reactivation--2026-07-14)
- [Release preparation guide](../guides/release-preparation.md)
