# TEST_READY: TypeSpec SSOT Plugin System & openapi-ts Client

## Overview
A 4-Tier, requirement-driven E2E test suite covering Features 1–10 across the TypeSpec (.tsp SSOT) Plugin Engine, Configuration, Kahn's Topological Sorter & Cycle Defense, In-Memory TypeSpec Compiler, openapi-ts Client SDK (`{ path, query, body, headers }` & `{ data, error, response }`), TypeScript Models, TanStack Query v5 3-Tier Suite, Server Router Contracts (`*.contract.ts`), Binary Wire Codecs (Protobuf / MessagePack), and Monorepo Governance Gates.

The client, TanStack and runner tests exercise the **shipped plugins** (`pluginTypescript`, `pluginClient`, `pluginTanstackQuery`, `pluginRouter`, `pluginWire`) through the real pipeline (`runTspPluginPipeline`). The generated SDK modules are loaded at runtime from a temporary directory (`fixtures/generated-sdk.ts`), and the generated TypeScript is compiled with the TypeScript compiler API (strict, NodeNext, `exactOptionalPropertyTypes`) against the real `@tanstack/react-query` and `hono` typings (`packages/codegen/src/__tests__/plugin/helpers/typecheck-generated.ts`). There is no hand-written reference client.

- **Primary Test Directory**: `test/e2e/typespec-plugin/`
- **Package Integration Test**: `packages/codegen/src/__tests__/plugin/e2e-contracts.test.ts`
- **Test Fixtures**: `test/e2e/typespec-plugin/fixtures/` (`petstore`, `storefront`, `edge-cases`, `reserved-names`, `wire-namespaces`, `syntax-error`, `cycles`, `protobuf`, plus the `generated-sdk.ts` pipeline helper)
- **Primary Test Runner Commands**:
  - `pnpm test:e2e:typespec-plugin` (same as `pnpm vitest run test/e2e/typespec-plugin`)
  - `pnpm --filter @oa-sdk/codegen test src/__tests__/plugin/e2e-contracts.test.ts`
- **Total Test Cases**: 138 (130 in `test/e2e/typespec-plugin` + 8 in `packages/codegen`)
- **Total Test Files**: 18 (17 in `test/e2e/typespec-plugin` + 1 in `packages/codegen`)
- **CI status**: CI runs the suite with the root script `pnpm test:e2e:typespec-plugin` (`vitest run test/e2e/typespec-plugin`) in the `Essential build, typecheck & test` job, right after `pnpm test:integration`. The root `test:e2e` script targets the separate `tests/e2e` tree.

---

## Test Count per Tier

| Tier | Category | Scope | Test Count |
|---|---|---|:---:|
| **Tier 1** | Feature Coverage (Happy Path) | Features 1–10 | 53 |
| **Tier 2** | Boundary & Corner Cases | 4 Boundary Suites | 50 |
| **Tier 3** | Cross-Feature Combinations | 10 Multi-Plugin Pairwise Pipelines + 11 shipped-plugin type-check pipelines | 21 |
| **Tier 4** | Real-World Application Scenarios | 6 Application Workflows | 6 |
| **Contracts** | Package Public Interface Contracts | Engine CRUD, Sorter, Compiler, Types | 8 |
| **Total** | **Full E2E Suite** | **All Tiers (1–4) & Contract Entrypoints** | **138** |

---

## Feature Checklist & Coverage Matrix

| # | Feature Name | Source | Tier 1 Tests | Tier 2 Boundaries | Tier 3 Combinations | Tier 4 Scenarios |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **F1** | Core Plugin Engine Interfaces | ORIGINAL_REQUEST §R1 | `f1-plugin-engine.test.ts` (5) | `boundary-config-and-sorter` (8) | `cross-feature-pipelines` | `Scenario 1` |
| **F2** | Topological Plugin Sorter | ORIGINAL_REQUEST §R1 | `f2-topological-sorter.test.ts` (5) | `boundary-config-and-sorter` (7) | `cross-feature-pipelines` | `Scenario 6` |
| **F3** | In-Memory TypeSpec Compiler | ORIGINAL_REQUEST §R1 | `f3-in-memory-compiler.test.ts` (5) | `boundary-compiler.test.ts` (12) | `cross-feature-pipelines` | `Scenario 1, 2` |
| **F4** | openapi-ts Style Client SDK (generated `client.ts`) | ORIGINAL_REQUEST §R2 | `f4-client-sdk.test.ts` (5) | `boundary-client-and-types` (13) | `shipped-plugins-typecheck` | `Scenario 3, 4` |
| **F5** | TypeScript Models Plugin | ORIGINAL_REQUEST §R3 | `f5-typescript-models.test.ts` (5) | `boundary-compiler.test.ts` | `cross-feature-pipelines`, `shipped-plugins-typecheck` | `Scenario 1, 2` |
| **F6** | TanStack Query v5 Plugin (generated keys/queries/hooks + `api-client.ts` adapter) | ORIGINAL_REQUEST §R3 | `f6-tanstack-query.test.ts` (8) | `boundary-compiler.test.ts` | `shipped-plugins-typecheck` | `Scenario 1, 2, 4` |
| **F7** | Server Router Contracts Plugin | ORIGINAL_REQUEST §R3 | `f7-router-contracts.test.ts` (5) | `boundary-router-and-wire` (3) | `cross-feature-pipelines`, `shipped-plugins-typecheck` | `Scenario 1, 4` |
| **F8** | Binary Wire Codecs Plugin | ORIGINAL_REQUEST §R3 | `f8-wire-codecs.test.ts` (5) | `boundary-router-and-wire` (2) | `shipped-plugins-typecheck` | `Scenario 1, 5` |
| **F9** | Plugin Runner & Virtual File Flusher | ORIGINAL_REQUEST §R1 | `f9-plugin-runner.test.ts` (5) | `boundary-router-and-wire` (5) | `cross-feature-pipelines` | `Scenario 1` |
| **F10** | Governance Registration & Gates | ORIGINAL_REQUEST §R4 | `f10-governance-gates.test.ts` (5) | `boundary-config-and-sorter` | `cross-feature-pipelines` | `Scenario 1` |

- **F4 / Tier 2 client boundaries / Scenarios 3–4** run against the `Client` class and standalone functions that `pluginClient` generates for `fixtures/petstore`.
- **F6.7** loads the generated `client.ts` and `api-client.ts` for `fixtures/edge-cases` and checks that the adapter rejects with what the generated TanStack code declares as the error: the parsed `NotFound`/`Conflict`/`GenericError` body for a declared status (including `default`), and an `ApiClientResponseError` for a status without a declared error model.
- **F6.8** repeats the check over `pluginClient({ httpClient: 'axios' })` with an axios stand-in that answers like axios (raw text for `responseType: 'text'`, otherwise axios's default JSON parsing, so an empty body is `''`): JSON error bodies reject as the parsed body, and empty bodies of a declared status (404) or a `default`-covered one (500, 502) reject with an `ApiClientResponseError`, as with the fetch transport.
- **F9.1** drives the plugin lifecycle through `runTspPluginPipeline` (not a hand-rolled loop).
- **Tier 3 `shipped-plugins-typecheck.test.ts`** compiles the full output (types, client, TanStack single-file and split, `api-client.ts`, Hono router, wire codecs) for `petstore`, `storefront`, `edge-cases`, `reserved-names`, `protobuf` and `wire-namespaces`, plus `pluginClient({ clientClass: false })`, the axios transport, and consumer code that uses per-status `isErrorStatus` narrowing and narrows a TanStack query error (`GetItemError | ApiClientResponseError`) with `instanceof`. `fixtures/edge-cases` covers root-level operations, a short operation name shared by two namespaces, typed (`int32`/`boolean`) headers, and several error models with and without a `default` response. `fixtures/reserved-names` names operations with reserved words (root-level `delete`/`import`, `Pets.delete`, `Orders.export`) and like a `client.ts` binding (`createClient`), which `pluginClient` emits as `delete_`, `import_`, `petsDelete`, `ordersExport` and `createClient_`. `fixtures/wire-namespaces` declares wire models in sub-namespaces (`Inventory.Widget`, `Catalog.Widget`), whose `types.ts` names (`InventoryWidget`, `CatalogWidget`) differ from their component names.

---

## Tier 4 Real-World Application Scenarios

1. **Scenario 1: Full E2E Petstore TypeSpec Compilation to 5 Target SDKs through the shipped plugins**:
   - Runs `pluginTypescript`, `pluginClient`, `pluginTanstackQuery({ split: true })`, `pluginRouter({ target: 'hono' })` and `pluginWire({ codecs: ['proto3'] })` on `fixtures/petstore/main.tsp` in memory.
   - Verifies the emitted inventory (`types.ts`, `client.ts`, `api-client.ts`, `keys.ts`, `queries.ts`, `hooks.ts`, `api.contract.ts`, `router.ts`, `wire.ts`, `schema.proto`) and type-checks every TypeScript artifact together.

2. **Scenario 2: Storefront E-Commerce TypeSpec Compilation with Pagination & Nested Models**:
   - Ingests `fixtures/storefront/main.tsp` with nested `Money`, `OrderItem`, and `Order` models.
   - Verifies that `pluginTanstackQuery` detects the `page`/`pageSize` pagination of `listProducts` and emits `productsListProductsInfiniteQueryOptions`.

3. **Scenario 3: Tree-Shakeable Functional Client Calling Convention & Discriminated Union**:
   - Calls the generated standalone `getPetById` / `deletePet` with the single-object `{ client, path }` convention.
   - Validates `{ data, error, response }` narrowing: HTTP 200 yields `data`, HTTP 404 yields `error`, and HTTP 204 No Content yields `undefined` for both.

4. **Scenario 4: Server Handler Contract Implementation & Client Request Roundtrip**:
   - Implements in-memory handlers for the `ApiHandlers` keys (`petsListPets`, `petsGetPetById`, `petsCreatePet`).
   - Calls them through the generated SDK functions and the generated TanStack adapter (`createApiClient`), including the 404 path: the petstore `PetError` is not a status-coded `@error` model, so the TanStack error type is `Error` and the adapter rejects with an `ApiClientResponseError` carrying `status` and the parsed `body`.

5. **Scenario 5: Protobuf Wire Codec Extraction & Codec Transformation Roundtrip**:
   - Ingests `fixtures/protobuf/main.tsp` containing `@extension("x-oa-sdk-protobuf")` and `@extension("x-oa-sdk-field")` decorators.
   - Extracts canonical `WireSchemaModel` and transforms to Protocol Buffers v3 `.proto` syntax and pure TypeScript binary codecs.

6. **Scenario 6: Complex Cyclic Dependency Graph Detection & Topological Resolution**:
   - Constructs a 6-node multi-branch DAG with diamond dependencies.
   - Tests detection of complex cycles across deep branches, catching `TspPluginCycleError` with path trace.
   - Verifies Kahn's algorithm ordering upon cycle removal.

---

## Test Execution Commands

```bash
# 1. Run all 17 E2E test files across Tiers 1-4 (130 tests)
pnpm vitest run test/e2e/typespec-plugin

# 2. Run Tier 1 Feature Coverage suite (53 tests)
pnpm vitest run test/e2e/typespec-plugin/tier1-features/

# 3. Run Tier 2 Boundary & Corner Cases suite (50 tests)
pnpm vitest run test/e2e/typespec-plugin/tier2-boundaries/

# 4. Run Tier 3 Cross-Feature Combination suite (21 tests)
pnpm vitest run test/e2e/typespec-plugin/tier3-combinations/

# 5. Run Tier 4 Real-World Application Scenarios suite (6 tests)
pnpm vitest run test/e2e/typespec-plugin/tier4-scenarios/

# 6. Run Codegen package integration test suite (8 tests)
pnpm --filter @oa-sdk/codegen test src/__tests__/plugin/e2e-contracts.test.ts

# 7. Run all plugin tests in @oa-sdk/codegen (unit, adversarial, contracts, generated-code type checks)
pnpm --filter @oa-sdk/codegen test src/__tests__/plugin/
```
