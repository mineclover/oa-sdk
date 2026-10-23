# Backlog Handoff — cross-repo projection / DPM runtime

Last updated: 2026-10-23
Status: review complete; no implementation started
Scope: [MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md),
[Shared OpenAPI Projection Validation](../../tasks/prd-shared-openapi-projection-validation.md),
[DPM runtime/storage follow-up](./goals/goal-5-dpm-runtime-storage-integration.md)

## 결론

두 항목 모두 **oa-sdk에서 바로 구현을 시작할 작업은 아니다.**

| 항목 | 판단 | 먼저 필요한 것 |
| --- | --- | --- |
| cross-repo bun-graph-db/MCP projection | 구현은 대부분 존재하지만 **submodule pin이 원격에 없는 로컬 commit**을 가리킨다 | bun-graph-db commit 정리·push, pin 재고정, PRD 상태 reconciliation |
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
배포되어 있다. PRD 문서는 US-001 vocabulary reconciliation과 US-008–US-013 cross-repo wiring을
아직 open으로 표시하지만, **bun-graph-db 쪽 구현은 이미 origin/main에 올라가 있다.**

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

`bun-graph-db/package.json`은 `@oa-sdk/openapi-projection-contract`를 `0.2.0`으로 의존한다.
즉 published contract package를 사용하는 cross-repo 경계는 이미 연결되어 있다.

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

1. **부모 repo가 원격에 없는 submodule commit을 pin하고 있다.**
   - 부모 pin: `cecef25f94e02dc8ecd368547e7d2c071788812e`
   - `cecef25`는 bun-graph-db `origin/main`에 없다.
   - 로컬 submodule은 `origin/main`보다 **92 commits ahead**다.
   - 따라서 fresh clone에서 `git submodule update --init`을 하면 pin을 checkout하지 못할 수 있다.
   - projection feature 자체는 `origin/main`에 있다(`5f2e4b2`, `d3007dd` 등).
     pin이 가리키는 92개 local commit에는 projection 외 MCP/VCS/schema 작업도 포함되어 있다.

2. **PRD 상태가 실제 구현과 어긋난다.**
   - `prd-shared-openapi-projection-validation.md`는 US-008–US-013을 open으로 표시한다.
   - bun-graph-db origin/main에는 dependency, adapters, MCP tools, smoke tests가 이미 있다.
   - US-001 vocabulary reconciliation이 실제로 끝났는지는 별도 확인이 필요하다.

3. **oa-sdk CI는 submodule을 검사하지 않는다.**
   - `.github/workflows/ci.yml`은 `submodules: false`로 checkout한다.
   - cross-repo projection 회귀는 oa-sdk CI에서 잡히지 않는다.
   - 현재는 `references/bun-graph-db`의 focused test를 수동으로 실행해야 한다.

4. **contract release 경계가 있다.**
   - bun-graph-db는 published `@oa-sdk/openapi-projection-contract@0.2.0`을 쓴다.
   - contract type/validator를 바꾸면 새 contract release와 bun-graph-db dependency bump가 필요하다.
   - 이 작업은 oa-sdk의 일반 patch release와 별도로 조정해야 한다.

### A.5 권장 다음 작업

1. **submodule 정책을 먼저 결정한다.**
   - (a) `references/bun-graph-db`를 read-only reference로 둔다면: 로컬 92 commits를 버리고
     origin/main의 pushed commit으로 pin을 재고정한다.
   - (b) contributing submodule로 유지한다면: 로컬 92 commits를 review·push하고, 그 pushed commit으로
     pin을 갱신한다.
   - 어느 쪽이든 **원격에서 resolve 가능한 commit**만 pin해야 한다.

2. **PRD 상태를 reconciliation한다.**
   - bun-graph-db origin/main 기준으로 US-008–US-013의 실제 완료 여부를 체크한다.
   - US-001 vocabulary reconciliation이 남아 있으면 별도 작은 작업으로 분리한다.
   - 완료된 story에는 test/commit evidence를 PRD에 기록한다.

3. **cross-repo verification을 문서화하거나 CI에 추가한다.**
   - 최소한 `bun run typecheck` + focused 3 test files를 release 전 수동 gate로 문서화한다.
   - CI에 넣는다면 submodule checkout과 bun setup이 필요하므로 별도 job으로 분리한다.

4. **parent pin과 문서를 함께 갱신한다.**
   - `references/bun-graph-db` pin
   - `docs/internal/todo.md`의 backlog 문구
   - `HANDOFF.md`의 cross-repo 상태
   - 필요하면 `@oa-sdk/openapi-projection-contract` release note

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

1. cross-repo submodule pin 정책 결정 (A.5.1)
2. pushed commit으로 pin 재고정 + PRD reconciliation (A.5.2–A.5.4)
3. DPM은 owner decision 전까지 **no-op** 유지 (B.4)
4. GitHub Actions billing 복구 후 source CI를 다시 활성화

## 참고

- [MCP OpenAPI Projection Tools PRD](../../tasks/prd-mcp-openapi-projection-tools.md)
- [Shared OpenAPI Projection Validation PRD](../../tasks/prd-shared-openapi-projection-validation.md)
- [DPM runtime/storage integration](./goals/goal-5-dpm-runtime-storage-integration.md)
- [DPM master roadmap](./goals/dpm-master-roadmap.md)
- [Platform scope — DPM temporary reactivation](./platform-scope.md#dpm-temporary-reactivation--2026-07-14)
- [Release preparation guide](../guides/release-preparation.md)
