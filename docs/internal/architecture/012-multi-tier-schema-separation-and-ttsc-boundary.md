# ADR-012 - Multi-Tier Schema Architecture, Domain Separation, and the Boundary of ttsc and Atlas

## Status

Accepted, dated 2026-10-09.

This ADR establishes the multi-tier schema governance framework for the OA SDK ecosystem, defining strict ownership boundaries between Physical Storage (Atlas), API/Transport Contracts (TypeSpec/OpenAPI), Logical ERD/Governance (DPM, Logical ERD), and Runtime Behavior (XState v5/v6, WIREFRAME-BOOK). It explicitly formalizes **when and where `ttsc` (TypeScript-Go compiler toolchain) must be used**, and how Atlas schema evidence is safely consumed.

---

## Context

OA SDK previously established TypeSpec as its authored Single Source of Truth (SSOT) for HTTP/OpenAPI contracts ([ADR-009](009-typespec-first-authoring.md)) and adopted a relationship-first Data Pseudonymization Manifest (DPM) toolkit ([ADR-010](010-dpm-relationship-first.md)).

As applications in the broader ecosystem grow (e.g. `board-platform` with Cloudflare D1/SQLite managed via Ariga Atlas, `wireframe-storyboard-toolkit` with XState behavior flows, and `samchon` with `ttsc` AOT compilation and compiler-level knowledge graphs), two divergent risks have emerged:

1. **Schema Monolith Risk**: Attempting to force database DDL, migration semantics, CRDT state, FSM behavior topologies, and API transport schemas into a single monolithic TypeSpec bundle or decorator namespace.
2. **Runtime Overhead / Drift Risk**: Emitting heavyweight runtime schema validators (e.g., shipping Ajv or entire JSON Schema parsers to client runtimes) for XState v6 Standard Schema contracts, or allowing physical DB columns to silently drift from API contracts.

To resolve these tensions cleanly, OA SDK must define the exact responsibilities of each tier, isolate active decorator scopes, and establish authoritative rules for when to use the `oa-sdk` standard toolchain versus `ttsc` and `Atlas`.

---

## Decision

### 1. Four-Tier Schema Architecture

The OA SDK architecture recognizes four distinct, decoupled schema tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   1. Storage / Physical Tier (Atlas)                   │
│   • Owned by: db/schema.sql, atlas.hcl, migrations/                    │
│   • Tooling: Ariga Atlas (atlas migrate diff / apply / lint)           │
│   • Responsibility: Tables, physical columns, DB types, indexes, DDL   │
│   • Boundary: OA SDK NEVER emits DDL or mutates physical databases     │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Read-only Catalog JSON Evidence
                                     ▼ (atlas schema inspect --format json)
┌────────────────────────────────────────────────────────────────────────┐
│             2. Logical Entity & Evidence Tier (OA SDK / DPM)           │
│   • Owned by: @oa-sdk/logical-erd-contract, @oa-sdk/dpm                │
│   • Tooling: oa-erd, dpm CLI, @samchon/typespec-evidence               │
│   • Responsibility: Neutral ERD artifacts, pseudonymization policies,   │
│     token namespaces, requirement-to-code traceability                 │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Shared Data Model Vocabulary
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│              3. API & Transport Tier (TypeSpec / OpenAPI 3.2)          │
│   • Owned by: packages/schemas/typespec/**/*.tsp                       │
│   • Tooling: @typespec/compiler, @typespec/openapi3, oa-gen codegen    │
│   • Responsibility: HTTP operations, request/response models, routers, │
│     typed client SDKs, TanStack Query hooks, OpenAPI 3.2 artifacts     │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Data Shape References ($ref)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 4. Runtime Behavior Tier (Behavior IR / XState)        │
│   • Owned by: wireframe-storyboard-toolkit, XState v5/v6               │
│   • Tooling: Behavior IR compiler, ttsc AOT Standard Schema adapter    │
│   • Responsibility: State machine topologies, guard conditions,        │
│     action invocations, event loops                                    │
│   • Boundary: TypeSpec owns data shapes only; NOT machine topologies   │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2. When to Use Which Tool: The Decision Matrix

#### A. Standard `oa-sdk` Toolchain (`oa-gen`, `@typespec/*`, `@oa-sdk/*`)
Use when working on **Interface Contracts, Transport, and API Operations**:
- Authoring HTTP/REST API endpoints, status codes, query/path parameters, and headers.
- Emitting official OpenAPI 3.1 / 3.2 specifications (`approved.openapi.yaml`).
- Generating backend routers (`@oa-sdk/router` for Hono, Fastify, Express, Bun Elysia).
- Generating frontend client SDKs and TanStack Query v5 3-tier hooks (`@oa-sdk/client`).
- Running standalone OpenAPI mock servers (`@oa-sdk/mock-server`).
- Authoring neutral Logical ERD declarations (`@oa-sdk/typespec-erd`, `oa-erd`).
- Defining Data Pseudonymization Manifests (`@oa-sdk/dpm`).

*Anti-pattern*: Do not use `oa-sdk` to author database migrations, write raw DDL, or model complex state transition diagrams.

#### B. `ttsc` (TypeScript-Go Toolchain / Samchon Architecture)
Use when requiring **AOT Compile-Time Optimization, Zero-Cost Validation, and Knowledge Graph Traceability**:
- **AOT Standard Schema / Validator Synthesis**: When generating runtime validators for XState v6 (`setup({ schemas: { ... } })`) or high-throughput API endpoints where bundle size and microsecond performance matter. `ttsc` transforms TypeScript types directly into compiled JavaScript assertions/functions at compile time with **zero runtime dependencies** (e.g. Typia-powered inline checks instead of shipping Ajv/Zod parsers).
- **100% Requirements Coverage & Provenance (`@ttsc/evidence`)**: When enforcing strict governance gates in CI where every implementation symbol and TypeSpec model must trace back to a requirement heading (`docs/**/*.md#anchor`).
- **Compiler Knowledge Graph (`ttsc-graph-router`)**: When analyzing cross-package AST dependency graphs, impact analysis, and route/contract mapping without manual indexing.

*Anti-pattern*: Do not use `ttsc` to author API definitions directly; TypeSpec remains the authored interface source.

#### C. `Atlas` (Ariga Atlas)
Use for **Declarative Database Schema Management and Migrations**:
- Authoring physical storage schemas (`schema.sql` or HCL) and managing versioned migrations (`atlas migrate diff`).
- Inspecting physical databases (PostgreSQL, MySQL, SQLite, Cloudflare D1) and checking migration safety/linting in CI.
- **Integration with OA SDK**: Exporting raw schema snapshots via `atlas schema inspect --format '{{ json . }}'` as **Read-only Catalog Evidence**. This evidence is consumed by `@oa-sdk/dpm` and `check:schema-drift` to verify that API/Logical models match physical storage columns without giving `oa-sdk` DB mutation privileges.

*Anti-pattern*: Do not generate SQL DDL directly from TypeSpec models (Forward Generation). Physical DB optimization, indexing, and migration lifecycles must be owned by Atlas.

---

### 3. Purpose-Driven Active Decorator Slices

To prevent schema pollution and cross-domain coupling, `@oa-sdk/typespec-decorators` is organized into purpose-driven modular subpaths:

| Subpath | Namespace | Intended Purpose | Primary Decorators | Target Projection |
|---|---|---|---|---|
| `@oa-sdk/typespec-decorators/api` | `OaSdkTypeSpec` | HTTP API & Transport | `@oaUseResponseComponent`, `Ok<T>`, `Created<T>`, `StandardError` | OpenAPI 3.2 operations & responses |
| `@oa-sdk/typespec-decorators/governance` | `OaSdkTypeSpec` | API Persona & PII Governance | `@personaCapability`, `@pseudonymize` | `x-oa-sdk-persona-traits`, `x-oa-sdk-dpm-projection` |
| `@oa-sdk/typespec-decorators/crdt` | `OaSdkTypeSpec` | Real-time CRDT replication | `@crdt`, `@crdtEntity` | `x-oa-sdk-crdt`, `x-oa-sdk-crdt-entity` |
| `@oa-sdk/typespec-decorators/behavior` | `OaSdkTypeSpec` | Behavior / XState Data Shapes | `@actorInput`, `@machineContext`, `@eventPayload`, `@behaviorRef` | `x-oa-sdk-behavior-*` (Strip in OpenAPI production) |
| `@oa-sdk/typespec-decorators/storage` | `OaSdkTypeSpec` | Atlas DB Evidence Linkage | `@storageRef`, `@storageCatalog` | `x-oa-sdk-storage-*` (Read-only catalog drift verification) |

- **Root Compatibility**: `import "@oa-sdk/typespec-decorators";` re-exports all slices to guarantee 100% backward compatibility for existing code.
- **Selective Authoring**: Specific domains (e.g. Behavior specifications, internal DB models) can import only their relevant slice, preventing unwanted metadata from leaking into production OpenAPI artifacts.

---

## Consequences

### Positive
- **Clear Separation of Concerns**: Database migrations (Atlas), API contracts (TypeSpec), runtime optimization (ttsc), and state machines (XState) have unambiguous, dedicated owners.
- **Zero Runtime Bloat for XState v6**: Adopting `ttsc` AOT Standard Schema lowering prevents runtime JSON Schema parser overhead in client applications.
- **Decoupled Governance**: Adding new behavior or storage decorators no longer risks destabilizing the core production OpenAPI bundle.
- **Drift Safety**: Atlas catalog inspection allows automated verification between physical tables and TypeSpec DTOs without coupling their build pipelines.

### Guardrails
- **No DDL in TypeSpec**: Do not add DDL generator emitters to TypeSpec in OA SDK.
- **No FSM Topology in TypeSpec**: Do not attempt to express State Machine transitions, guards, or execution graphs in TypeSpec; keep them in Behavior IR.
- **OpenAPI Cleanliness**: Behavior and Storage decorator metadata must not appear in production `approved.openapi.yaml` artifacts unless explicitly gated.
- **Operational Guide**: For the formal mathematical schema algebra ($S_{phys}, M_{log}, C_{api}, B_{fsm}$), compiler complexity theory ($O(1)$ AOT branching vs $O(N)$ AST walking), RACI responsibility matrix, and 5 critical anti-patterns, refer to the [Multi-Tier Schema Architecture & ttsc Guide](../../guides/schema-architecture-and-ttsc-guide.md).

