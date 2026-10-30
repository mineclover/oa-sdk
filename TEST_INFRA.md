# E2E Test Infrastructure: Output Path Routing Customization Engine & TanStack Query v5 3-Tier Generator

현재 실행 결과·기능별 보장·결함 상태는 [검증 관리](docs/internal/verification/README.md)와
[자동 생성 현황](docs/internal/verification/status.md)에서 관리한다. 이 문서의 테스트 설계·단계 분류는 실행 완료나 운영 보장을 뜻하지 않는다.


## Test Philosophy & Methodology
- **Opaque-Box, Requirement-Driven Testing**: All test assertions, interface contracts, and expected behaviors are derived directly from authoritative requirements:
  1. `ORIGINAL_REQUEST.md` (section timestamped `2026-09-12T16:15:58Z`, Requirements §R1–§R5)
  2. `PROJECT.md` (Features 1–14 across Milestones M1–M5)
  3. Authoritative architectural surveys in `.agents/explorer_survey_1/`, `.agents/explorer_survey_2/`, and `.agents/explorer_survey_3/`
  4. Developer Output Path Routing Sovereignty: support arbitrary target layouts (Feature-Sliced Design `src/features/{tag}/api/`, Clean Architecture / DDD `src/domain/`, `src/infrastructure/`, or Multi-Package Monorepos `apps/server/`, `apps/web/`) through `pattern`, `rules`, and `byKind` configurations.
  5. 3-Gate Safety Invariants for Safe Orphan Pruning:
     - Gate 1: Historical Manifest Provenance (in `.oa-manifest.json`).
     - Gate 2: Disk SHA-256 Hash Parity (unmodified by developer).
     - Gate 3: Auto-Generated Banner Verification (contains `@oa-sdk` banner).
     Guarantees developer code is **NEVER overwritten or deleted**.
  6. TanStack Query v5 3-Tier Client Architecture:
     - Tier 1: Hierarchical Query Key Factory (`*Keys` with `all`, `lists()`, `list(filters)`, `details()`, `detail(id)`). Pure tuples, zero framework dependencies.
     - Tier 2: Pure Query & Mutation Options Factory (`queryOptions()`, `mutationOptions()`). Pure functional layer, zero UI framework lock-in, reusable across React, Vue, Svelte, and Next.js App Router SSR / `prefetchQuery()`.
     - Tier 3: Client Composition Hook Helpers (optional ergonomic wrappers `use*Query`, `use*Mutation`).
  7. Zero Framework Runtime Leaks: `@oa-sdk/client` maintains strictly 0 `@tanstack/react-query` runtime dependencies.
  8. Full-Stack Wire Synchronization Parity: 100% type symmetry between `@oa-sdk/router` handler contracts (`*.contract.ts`) and frontend TanStack Query options (`*.queries.ts`) with `JsonPrimitive<T>` and `Resolved<T>`.

---

## Feature Inventory Coverage Matrix (Features 1–14)

| # | Feature Name | Milestone | Tier 1 (Happy Path) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Real-World) |
|---|--------------|:---------:|:-------------------:|:-------------------:|:----------------------:|:-------------------:|
| **F1** | `OutputRoutingConfig` Schema | M1 | T1-F01-1 to T1-F01-5 | T2-B01-1 to T2-B01-5 | T3-01, T3-02 | T4-S1, T4-S2 |
| **F2** | Token Substitution Engine | M1 | T1-F02-1 to T1-F02-5 | T2-B02-1 to T2-B02-5 | T3-03, T3-04 | T4-S1 |
| **F3** | Relative Import Path Resolver | M1 | T1-F03-1 to T1-F03-5 | T2-B03-1 to T2-B03-5 | T3-05, T3-06 | T4-S1, T4-S4 |
| **F4** | Safe Manifest & Orphan Pruning | M1 | T1-F04-1 to T1-F04-5 | T2-B04-1 to T2-B04-5 | T3-07, T3-08 | T4-S3 |
| **F5** | Tier 1 Query Key Factory | M2 | T1-F05-1 to T1-F05-5 | T2-B05-1 to T2-B05-5 | T3-09, T3-10 | T4-S1, T4-S2 |
| **F6** | Tier 2 Pure Options Factory | M2 | T1-F06-1 to T1-F06-5 | T2-B06-1 to T2-B06-5 | T3-11, T3-12 | T4-S1, T4-S2 |
| **F7** | Tier 3 Hook Helpers | M2 | T1-F07-1 to T1-F07-5 | T2-B07-1 to T2-B07-5 | T3-13, T3-14 | T4-S2 |
| **F8** | Zero Runtime Dependency Leaks | M2 | T1-F08-1 to T1-F08-5 | T2-B08-1 to T2-B08-5 | T3-15 | T4-S5 |
| **F9** | `oa-gen generate:tanstack` CLI | M3 | T1-F09-1 to T1-F09-5 | T2-B09-1 to T2-B09-5 | T3-16 | T4-S1 |
| **F10** | CLI Governance Spec Parity | M3 | T1-F10-1 to T1-F10-5 | T2-B10-1 to T2-B10-5 | T3-17 | T4-S5 |
| **F11** | Router Handler Contract Parity | M3 | T1-F11-1 to T1-F11-5 | T2-B11-1 to T2-B11-5 | T3-18 | T4-S4 |
| **F12** | Onboarding Playbook Recipes | M4 | T1-F12-1 to T1-F12-5 | T2-B12-1 to T2-B12-5 | T3-19 | T4-S1 |
| **F13** | Agent Skill Synchronization | M4 | T1-F13-1 to T1-F13-5 | T2-B13-1 to T2-B13-5 | T3-20 | T4-S5 |
| **F14** | E2E Test Suite & Governance Gates | M5 | T1-F14-1 to T1-F14-5 | T2-B14-1 to T2-B14-5 | T3-20 | T4-S5 |

---

## 4-Tier Test Suite Architecture

### Tier 1: Category-Partition Feature Coverage (70 Tests, 5 Tests per Feature Area)
- **F1: `OutputRoutingConfig` Schema**: Validates configuration schema under `product.outputRouting` and root alias `outputRouting`. Tests `pattern`, `byKind`, and `rules` fields with zero-throw `validateOaConfig` diagnostics.
- **F2: Token Substitution Engine**: Validates deterministic replacement of `{tag}`, `{kind}`, `{operationId}`, `{method}`, and `{group}` with casing styles (`kebab`, `camel`, `pascal`, `preserve`).
- **F3: Relative Import Path Resolver**: Validates `path.relative` POSIX computation between emitter and target files, leading `./` preservation, `.js` ESM extensions, and tsconfig path aliases.
- **F4: Safe Manifest & Orphan Pruning**: Validates `.oa-manifest.json` generation, SHA-256 fingerprinting, artifact tracking, and safe obsolete artifact pruning.
- **F5: Tier 1 Query Key Factory**: Validates hierarchical query key trees (`all`, `lists()`, `list(filters)`, `details()`, `detail(id)`) as pure TypeScript tuples (`as const`) without runtime imports.
- **F6: Tier 2 Pure Options Factory**: Validates pure `queryOptions()` and `mutationOptions()` generation with HTTP verb classification (GET -> query, POST/PUT/DELETE -> mutation) and wire-format typing.
- **F7: Tier 3 Hook Helpers**: Validates thin React hook wrappers (`use*Query`, `use*Mutation`) with open generics for `select` transform inference and options overrides.
- **F8: Zero Runtime Dependency Leaks**: Validates that `@oa-sdk/client` package.json strictly contains 0 `@tanstack/react-query` in `dependencies`.
- **F9: `oa-gen generate:tanstack` CLI**: Validates CLI command execution with options (`--spec`, `--output`, `--tier`, `--types-import`, `--client-import`).
- **F10: CLI Governance Spec Parity**: Validates option symmetry across `commands.ts`, `oa-gen-governance.ts`, and `docs/cli-spec/oa-gen.governance.json`.
- **F11: Router Handler Contract Parity**: Validates 100% parameter and response wire typing parity between `@oa-sdk/router` contracts and TanStack Query options.
- **F12: Onboarding Playbook Recipes**: Validates `docs/guides/onboarding-playbook.md` containing FSD routing, Monorepo distribution, TanStack Query v5 3-tier adoption, and Next.js SSR recipes.
- **F13: Agent Skill Synchronization**: Validates `.agents/skills/oa-codegen/SKILL.md` and `.agents/skills/oa-onboarding/SKILL.md` synchronization.
- **F14: E2E Test Suite & Governance Gates**: Validates execution of all monorepo governance gates (`check:docs`, `check:cli-spec`, `check:api-index`, `check:release-policy`, `typecheck:all`).

### Tier 2: Boundary Value Analysis & Corner Cases (35+ Tests)
- **B1 (Missing Tag Fallbacks)**: Operations without tags defaulting to first URL path segment (`group`), root endpoints (`/`) defaulting to `'default'`, and multi-tag operations selecting primary `tags[0]`.
- **B2 (Special Characters & Casing)**: Hyphenated tags, tags with spaces, camelCase/PascalCase operation IDs, and sanitization of filesystem-forbidden characters (`:`, `*`, `?`, `"`, `<`, `>`, `|`).
- **B3 (Cross-Platform Path Normalization)**: Windows backslash `\` inputs strictly converted to POSIX forward slashes `/`, deduplication of redundant consecutive slashes.
- **B4 (Manifest 3-Gate Safety Invariants)**:
  - Unlisted file: Gate 1 provenance check prevents deletion.
  - Modified file: Gate 2 hash mismatch check skips pruning and logs warning.
  - Banner stripped: Gate 3 banner check refuses deletion.
  - Bit-identical rerun: skips rewriting to preserve filesystem mtime.
- **B5 (Operation Parameter Edge Cases)**:
  - 0 parameters (parameterless GET).
  - Path-only parameters.
  - Query-only parameters.
  - Body-only operations.
  - Headers-only operations.
- **B6 (Response Shape Edge Cases)**:
  - 204 No Content / void responses.
  - Binary streaming responses (`AsyncGenerator<Uint8Array>`).
  - Optional request body (`body?: Resolved<T>`).
- **B7 (Self-Import & Cyclic Directory Guards)**:
  - Emitter and target resolving to same directory.
  - Prevention of self-importing (`fromFilePath === toFilePath`).

### Tier 3: Pairwise Combinatorial Testing (20 Tests)
- **T3-01**: Feature-Sliced Design (FSD) Layout (`src/features/{tag}/api/{tag}.{kind}.ts`) importing schemas and client.
- **T3-02**: Clean Architecture / DDD Layout (`src/domain/{tag}/`, `src/infrastructure/api/{tag}.client.ts`).
- **T3-03**: Multi-Package Monorepo Layout (`apps/server/src/contracts/` vs `apps/web/src/api/`).
- **T3-04**: Output Routing with Conditional Rules overriding global `pattern`.
- **T3-05**: Output Routing with `byKind` mapping overriding global `pattern`.
- **T3-06**: Casing Transformation `pascal` combined with FSD directory structure.
- **T3-07**: Casing Transformation `camel` combined with Flat directory structure.
- **T3-08**: Relative Import Specifiers across 4 directory depth levels (`../../../../shared/`).
- **T3-09**: Tsconfig Path Alias Resolution (`@features/*`, `@shared/*`) in generated queries.
- **T3-10**: Manifest Safe Pruning with mixed unmodified, developer-modified, and hand-written files.
- **T3-11**: Tier 1 Keys + Tier 2 Options in single file mode (`--split false`).
- **T3-12**: Tier 1 Keys + Tier 2 Options + Tier 3 Hooks in split multi-file mode (`--split true`).
- **T3-13**: Query Options with Parameterless GET and Typed Mutation POST in same entity.
- **T3-14**: TanStack Options with Custom Query Package (`@tanstack/vue-query` / `@tanstack/svelte-query`).
- **T3-15**: Next.js 15 App Router Server Component SSR prefetching options (`prefetchQuery`).
- **T3-16**: Router Contract (`*.contract.ts`) and Query Options (`*.queries.ts`) generated from same OAS 3.2 spec.
- **T3-17**: CLI `--dry-run` with Output Path Routing and Manifest comparison.
- **T3-18**: Full-Stack Wire Typing Parity (`JsonPrimitive<T>` and `Resolved<T>`) across backend contract and frontend client.
- **T3-19**: Multiple Spec Targets with distinct output routing configurations.
- **T3-20**: Monorepo Governance Manifest Parity + Skill Syntax Validation.

### Tier 4: Real-World Workload Scenarios (5 Scenarios)
- **T4-S1: Full-Scale Feature-Sliced Design (FSD) Web Application**:
  - Simulates large production FSD app with `Users`, `Orders`, `Products` domains.
  - Routes artifacts to `src/features/{tag}/api/` with types in `src/shared/types/`.
  - Verifies dynamic relative imports compile cleanly with `tsc --noEmit`.
- **T4-S2: Next.js 15 App Router Full-Stack SSR Hydration**:
  - Implements Server Component with `queryClient.prefetchQuery(getUserQueryOptions(client, { id: '1' }))`.
  - Implements Client Component with `useGetUserQuery` and `useHydrateAtoms` / `HydrationBoundary`.
  - Proves zero runtime dependency leak of React Query in `@oa-sdk/client` and zero loading flash.
- **T4-S3: End-to-End Spec Evolution & Safe Orphan Pruning**:
  - Spec v1: 3 endpoints (`/users`, `/users/{id}`, `/legacy-reports`). Generates artifacts and `.oa-manifest.json`.
  - Developer edits `users.queries.ts` (adds custom helper).
  - Developer adds hand-written `custom-utils.ts` in generated directory.
  - Spec v2: Removes `/legacy-reports`, updates `/users`.
  - Verifies: `/legacy-reports` is safely pruned; modified `users.queries.ts` is preserved (Gate 2); `custom-utils.ts` is untouched (Gate 1).
- **T4-S4: Full-Stack Contract Sync: Fastify / Hono Router to Frontend TanStack Query**:
  - Generates backend Fastify/Hono handler contracts (`*.contract.ts`) and frontend query options (`*.queries.ts`) from single OpenAPI 3.2 spec.
  - Mathematically asserts 100% type symmetry between backend context parameters and frontend query options parameters.
- **T4-S5: Monorepo Governance & Release Zero-Leak Audit**:
  - Executes comprehensive verification: `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm check:docs`, `pnpm typecheck:all`.

---

## Test Execution Commands

```bash
# 1. Standalone test runner for Output Routing & TanStack Query E2E suite
pnpm vitest run tests/e2e/output-routing-tanstack

# 2. Execute individual tier test suites
pnpm vitest run tests/e2e/output-routing-tanstack/tier1-feature-coverage.test.ts
pnpm vitest run tests/e2e/output-routing-tanstack/tier2-boundaries.test.ts
pnpm vitest run tests/e2e/output-routing-tanstack/tier3-combinations.test.ts
pnpm vitest run tests/e2e/output-routing-tanstack/tier4-scenarios.test.ts

# 3. Direct test file entrypoints
pnpm vitest run tests/e2e/e2e-output-routing.test.ts
pnpm vitest run tests/e2e/e2e-tanstack-query.test.ts
pnpm vitest run tests/e2e/e2e-router-client-parity.test.ts
```

## 패키지 단위 브라우저 E2E

`@oa-sdk/popup-bridge`는 실제 Chromium으로 서로 다른 Origin 3개를 띄우는 E2E(`packages/popup-bridge/e2e`)를 갖는다. `playwright-core`와 그 버전의 Chromium이 필요해 기본 `test`·CI lane에는 넣지 않고 따로 실행한다.

```bash
corepack pnpm --filter @oa-sdk/popup-bridge test:e2e
```
