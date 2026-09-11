# Test Infrastructure: TypeSpec Ecosystem Expansion (Phases 2, 3, 4)

> **Document Status**: `ACTIVE`  
> **Target Scope**: TypeSpec Ecosystem Expansion — Phases 2, 3, 4  
> **Suite Location**: `tests/e2e/typespec-ecosystem/`  
> **Test Model**: Requirement-Driven Opaque-Box 4-Tier Architecture  
> **Execution Runner**: `pnpm test:e2e` / `vitest run tests/e2e/typespec-ecosystem`  

---

## 1. Architectural Topology & 4-Tier Model

The TypeSpec Ecosystem Expansion test infrastructure provides an end-to-end opaque-box verification suite validating AST semantic diffing, zero-build instant mocking, and native persona/DPM decorator pipelines across 4 distinct test tiers:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           4-TIER TEST ARCHITECTURE                              │
├────────────────────────────────────────────────────────────────────────────────┤
│  Tier 1: Feature Coverage (>=5 tests per feature across F1-F19)                │
│  - F1-F8: TypeSpec AST Program Compilation, Route/Model Extraction, Git Ref   │
│           Resolution, 7-Category Breaking Changes, Non-Breaking Additions,     │
│           CLI `oa-gen tsp diff`, Multi-Token Subcommand Router                 │
│  - F9-F13: In-Memory OpenAPI 3.2 Emission, Zero-Build Instant Mocking,         │
│            Atomic Route Hot-Reload (`updateSpec`), File Watching, CLI `mock`  │
│  - F14-F19: `@personaCapability` Decorator, `x-oa-sdk-persona-traits`,         │
│             `@pseudonymize` Decorator, `x-oa-sdk-dpm-projection`, DPM Gates,   │
│             Persona Check Gate Integration (`personas:check`)                  │
├────────────────────────────────────────────────────────────────────────────────┤
│  Tier 2: Boundary & Corner Cases (>=5 tests per boundary area B1-B6)           │
│  - B1: Empty models, empty services, zero operations                           │
│  - B2: Extreme numeric bounds, large integers, negative status codes           │
│  - B3: Special characters in routes, dot-notation query parameters, hyphens    │
│  - B4: Missing optional parameters, deeply optional fields, empty payloads     │
│  - B5: Duplicate & conflicting decorators, overlapping traits, SAF collisions  │
│  - B6: Circular & recursive models, mutual reference cycles, deep trees        │
├────────────────────────────────────────────────────────────────────────────────┤
│  Tier 3: Cross-Feature Combinations (Pairwise Interaction Matrix C1-C6)         │
│  - C1: Mock server serving endpoints decorated with @personaCapability & DPM   │
│  - C2: Semantic diff tracking persona capability trait modifications           │
│  - C3: Semantic diff tracking DPM privacy transform and role modifications     │
│  - C4: In-Memory Compile -> OpenAPI 3.2 -> Mock Server -> Hot Reload Cycle     │
│  - C5: Persona check validation pipeline executing against in-memory spec      │
│  - C6: DPM safety pipeline validating TypeSpec-projected column policies       │
├────────────────────────────────────────────────────────────────────────────────┤
│  Tier 4: Real-World Application Scenarios (Scenarios S1-S5)                    │
│  - S1: Complete API Lifecycle (Author -> Mock -> Diff Gate -> Persona Matrix)  │
│  - S2: Multi-Persona Role-Based API Evolution (Admin vs Public scopes)         │
│  - S3: Microservice CI/CD Breaking Contract Governance Gate                    │
│  - S4: Real-Time Developer Live-Editing Loop with Zero-Build Mock Server       │
│  - S5: Regulated Healthcare/Finance GDPR/PII Compliance Pipeline               │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Inventory & Verification Matrix

| # | Feature Key | Requirement Scope | Target Module | Verification Method | Minimum Tests |
|---|---|---|---|---|:---:|
| 1 | `F1-compile` | In-Memory TypeSpec AST Program Compilation | `@typespec/compiler` | Programmatic compilation without disk YAML emission; sourceFiles navigation | 5 |
| 2 | `F2-http-extract` | HTTP Operation & Route Extraction | `@typespec/http` | Extraction of verbs, routes, parameters, status codes from `getAllHttpServices` | 5 |
| 3 | `F3-model-extract` | Model & Property Semantic Traversal | `@typespec/compiler` | Traversal of domain models, property types, optionality, unions, scalars | 5 |
| 4 | `F4-ref-resolve` | Git Ref & File Path Resolution | `@oa-sdk/codegen` | Resolution of local files, directories, and git refs (`HEAD~1`) | 5 |
| 5 | `F5-breaking-diff` | 7-Category Breaking Change Classification | `@oa-sdk/codegen` | Classification of removed ops, route changes, model removals, property removals, required additions, status code removals, operationId drift | 7 |
| 6 | `F6-non-breaking` | Non-Breaking Change Classification | `@oa-sdk/codegen` | Classification of added ops, added models, optional props, added status codes | 5 |
| 7 | `F7-cli-tsp-diff` | CLI `oa-gen tsp diff` & `--fail-on-breaking` | `@oa-sdk/codegen` | CLI execution exiting with code 1 on breaking changes, formatting markdown/json | 5 |
| 8 | `F8-multi-token` | Multi-Token Subcommand CLI Router | `@oa-sdk/codegen` | Compound command lookahead dispatching `tsp diff` and `tsp-diff` | 5 |
| 9 | `F9-openapi32-emit`| In-Memory OpenAPI 3.2 Emission | `@typespec/openapi3` | `getOpenAPI3` returning valid 3.2.0 document without temporary files | 5 |
| 10| `F10-instant-mock` | Direct In-Memory Schema Mocking | `@oa-sdk/mock-server` | Spawning mock HTTP server on port 4010; validating responses and 422 errors | 5 |
| 11| `F11-hot-reload` | Atomic Route Hot-Reload (`updateSpec`) | `@oa-sdk/mock-server` | Live route swap on active HTTP listener without socket disconnect | 5 |
| 12| `F12-file-watch` | File Watching & Incremental Recompilation | `@oa-sdk/codegen` | Watching `.tsp` source files, $<500$ms recompilation with `oldProgram` | 5 |
| 13| `F13-cli-mock` | CLI `oa-gen mock --tsp` | `@oa-sdk/codegen` | Command options `--tsp`, `--watch`, `--port`, `--host`, lifecycle shutdown | 5 |
| 14| `F14-persona-dec` | TypeSpec `@personaCapability` Decorator | `@oa-sdk/typespec-decorators` | Valid trait validation against `skill.yaml`, rejection of unknown traits | 5 |
| 15| `F15-persona-ext` | OpenAPI Extension `x-oa-sdk-persona-traits` | `@oa-sdk/typespec-decorators` | Emitted sorted deduplicated trait arrays under Operation Objects | 5 |
| 16| `F16-dpm-dec` | TypeSpec `@pseudonymize` Decorator | `@oa-sdk/typespec-decorators` | Enforcing DPM transforms and safety invariants (SAF001, SAF002, SAF010) | 5 |
| 17| `F17-dpm-ext` | OpenAPI Extension `x-oa-sdk-dpm-projection` | `@oa-sdk/typespec-decorators` | Emitted projection metadata under Schema Object properties | 5 |
| 18| `F18-persona-gate`| Persona Check Gate Integration | `@oa-sdk/personas` | Trait obligation validation against persona matrices in `personas:check` | 5 |
| 19| `F19-dpm-gate` | DPM Schema & Projection Gate Integration | `@oa-sdk/dpm` | Validation of TypeSpec-projected properties through DPM safety gates | 5 |
| 20| `Tier 2` | Boundary & Corner Cases (B1-B6) | All Modules | Empty models, numeric bounds, special routes, missing params, cycles | 30 |
| 21| `Tier 3` | Pairwise Cross-Feature Interactions | All Modules | Mock + Personas + DPM, Diff + Traits, In-Memory -> Mock -> Hot Reload | 18 |
| 22| `Tier 4` | Real-World Application Scenarios | All Modules | Complete lifecycle, role-based evolution, CI gates, compliance pipelines | 5 |
| **TOTAL** | | | | | **150** |

---

## 3. Test Suite Layout & File Organization

```
tests/e2e/typespec-ecosystem/
├── helpers/
│   ├── compiler.ts            # In-memory TypeSpec compiler and OpenAPI 3.2 emitter
│   ├── server.ts              # In-memory mock server lifecycle and HTTP fetcher
│   ├── diff.ts                # TypeSpec AST semantic diffing engine and utilities
│   ├── decorators.ts          # Persona & DPM decorator definitions and validators
│   └── cli.ts                 # oa-gen subprocess runner and exit code auditor
├── tier1-semantic-diff.test.ts  # F1-F8: AST Semantic Diff, Routes, Breaking Changes (45+ tests)
├── tier1-mock-server.test.ts    # F9-F13: Zero-Build Instant Mock Server & Hot Reload (25+ tests)
├── tier1-personas-dpm.test.ts   # F14-F19: @personaCapability, @pseudonymize, Extension Gates (30+ tests)
├── tier2-boundaries.test.ts     # B1-B6: Boundary and Corner Cases (30+ tests)
├── tier3-pairwise.test.ts       # C1-C6: Cross-Feature Pairwise Combinations (6+ tests)
└── tier4-scenarios.test.ts      # S1-S5: Real-World Application Scenarios (5+ tests)
```

---

## 4. Test Invariants & Architectural Guarantees

1. **Opaque-Box Requirement-Driven Evaluation**:
   Tests are derived exclusively from user requirements in `ORIGINAL_REQUEST.md`, architectural contracts in `PROJECT.md`, and authoritative trait taxonomies (`skill.yaml`, `dpm-manifest.schema.json`). Internal implementation details are treated as opaque black boxes.
2. **Deterministic Workspace Isolation**:
   Every test generating or compiling `.tsp` source files operates within a dedicated temporary directory (`.tmp-e2e-tsp-<timestamp>-<rand>`), automatically cleaned up upon test conclusion.
3. **Zero Leftover Port Bindings**:
   Mock server instances listen on ephemeral ports (`port: 0`) during parallel execution or default `4010` during targeted CLI tests, with mandatory `afterEach`/`finally` hooks invoking `server.stop()`.
4. **Independent Executability**:
   The entire test harness can be invoked repository-wide via standard `pnpm test:e2e` or granularly via `vitest run tests/e2e/typespec-ecosystem/<suite>.test.ts`.

---

## 5. Verification Commands

```bash
# Run the complete TypeSpec Ecosystem Expansion E2E test suite (Tiers 1-4)
pnpm test:e2e

# Run via Vitest directly
vitest run tests/e2e/typespec-ecosystem

# Run specific tiers
vitest run tests/e2e/typespec-ecosystem/tier1-semantic-diff.test.ts
vitest run tests/e2e/typespec-ecosystem/tier1-mock-server.test.ts
vitest run tests/e2e/typespec-ecosystem/tier1-personas-dpm.test.ts
vitest run tests/e2e/typespec-ecosystem/tier2-boundaries.test.ts
vitest run tests/e2e/typespec-ecosystem/tier3-pairwise.test.ts
vitest run tests/e2e/typespec-ecosystem/tier4-scenarios.test.ts
```
