# Goal 7 - DPM Profile/Connector Contract

**Status: active 2026-07-04**

> Predecessor: [Goal 6 - DPM Contract Stabilization](./goal-6-dpm-contract-stabilization.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
> Projection boundary: [ADR-007 - OpenAPI Projection Contract Boundary](../architecture/007-shared-schema-engine-vocabulary.md)\
> Product PRD: [Relationship-First Data Pseudonymization Manifest](../../../tasks/prd-data-pseudonymization-manifest.md)

## Purpose

Goal 4 through Goal 6 made the relationship-first DPM core loop deterministic for manifests,
catalog snapshots, registry snapshots, compiled plans, gateway schemas, and storage-backed reports.
Goal 7 defines the next boundary: source-specific systems such as PostgreSQL, Kafka, OpenAPI
projections, query logs, and ORM metadata must be flattened into a source-neutral DPM profile
artifact before DPM attempts relationship discovery, validation, visualization, editing, or automated
analysis.

The goal is not to build every connector. The goal is to make every future connector produce the same
measurable evidence shape, with explicit provenance, freshness, diagnostics, and analysis readiness.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| DPM profile artifact vocabulary and JSON/TypeScript contract | production Kafka consumer runtime |
| connector output contract for DB, event stream, and projection sources | streaming ingestion service |
| Kafka/topic fixture adapter as the first non-DB proof path | production schema registry integration |
| profile analysis report for metrics, coverage, relationship hints, and risk signals | automatic relationship approval |
| gateway/editor contracts for profile inspection and manual edits | tokenization engine execution |
| provenance and freshness model across source kinds | source system mutation |

## Execution Principles

1. A connector is an evidence producer, not the DPM source of truth.
2. DPM profile artifacts are read-only flattened inputs; approved relationships still live in the registry.
3. Every profile node, edge, metric, and diagnostic must carry source provenance where available.
4. Source-specific details may be preserved as metadata, but analysis and UI must use the normalized contract first.
5. Kafka support starts with schema/topic/message-shape evidence, not live stream consumption.
6. Unknown or weak evidence should become diagnostics and confidence signals, not silent relationship rules.

## Design Judgment Criteria

Use these criteria before adding a field, connector, or API:

| Question | Prefer this | Avoid this |
|---|---|---|
| Is this source-specific? | Keep it in connector metadata and map the normalized part into the profile contract. | Let Kafka/Postgres/OpenAPI details leak into every analyzer. |
| Is it needed for relationship discovery or validation? | Promote it to first-class profile evidence with provenance and freshness. | Store it as unstructured notes that cannot be checked. |
| Is it editable by a reviewer? | Model it as a proposal or override with lifecycle state. | Mutate raw connector output in place. |
| Is it safe for AI analysis? | Remove raw values and keep sampled shape/metrics only. | Persist payload samples, source credentials, or token reverse lookup material. |
| Does it change compiled output? | Add deterministic tests and freshness impact. | Treat it as display-only metadata. |
| Can two sources express the same fact? | Normalize through shared nodes, edges, metrics, and diagnostics. | Add parallel fields for each source type. |

## Implementation Units

### DPM-23 - Profile Artifact Vocabulary

Status: planned.

Artifacts:
- `packages/dpm/src/profile/types.ts`
- `packages/dpm/src/profile/schema.ts`
- `packages/dpm/test/profile-schema.test.ts`
- `docs/internal/api-index.md`

Tasks:
- Define `DpmProfileArtifact` as the normalized evidence container for source-neutral analysis.
- Model profile identity, source kind, source refs, version hash, nodes, edges, metrics,
  diagnostics, and source coordinates.
- Keep raw values, source credentials, and token reverse lookup material out of the contract.
- Export public types and runtime taxonomies through `@oa-sdk/dpm`.

Acceptance:
- Profile artifacts can represent at least DB table/column evidence and Kafka topic/message-field evidence.
- Invalid source kinds, missing provenance, empty metric identity, and raw sample payload fields are rejected.
- `check:api-index` recognizes the new public surface.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-schema.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index`

### DPM-24 - Connector Output Contract

Status: planned.

Artifacts:
- `packages/dpm/src/profile/connector.ts`
- `packages/dpm/test/profile-connector.test.ts`

Tasks:
- Define a connector result contract that returns profile artifact, connector diagnostics, freshness,
  and capability metadata.
- Separate connector capabilities from profile evidence so UI and automation can explain what was
  observed, skipped, or unsupported.
- Add deterministic validation for connector output without requiring a live source.

Acceptance:
- PostgreSQL catalog profiling can be described as one connector output path without changing the
  existing profiler behavior.
- Kafka/topic fixture profiling can use the same connector result shape.
- Connector failures are diagnostic payloads, not thrown-away strings.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-connector.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`

### DPM-25 - Kafka Topic Profile Fixture Adapter

Status: planned.

Artifacts:
- `packages/dpm/src/profile/kafka.ts`
- `packages/dpm/test/profile-kafka.test.ts`
- fixture directory under `packages/dpm/test/fixtures/profile/`

Tasks:
- Add a fixture-backed Kafka adapter that maps topics, partitions, keys, headers, message schemas,
  and field paths into the normalized profile artifact.
- Represent nested message fields as stable profile nodes and parent/child edges.
- Compute metrics such as nullable ratio, key coverage, field presence, and schema version freshness
  from fixture evidence only.

Acceptance:
- The adapter does not connect to Kafka or consume live messages.
- Nested JSON/Avro-like field paths can be flattened into stable coordinates.
- Relationship hints remain suggestions and do not become approved registry entries.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-26 - Profile Analysis Report

Status: planned.

Artifacts:
- `packages/dpm/src/profile/analyze.ts`
- `packages/dpm/test/profile-analysis.test.ts`

Tasks:
- Analyze profile artifacts into coverage, relationship hints, join/key candidates, drift signals,
  and privacy risk indicators.
- Reuse DPM diagnostic severity/code conventions where practical while keeping profile analysis
  diagnostics distinct from manifest validation diagnostics.
- Produce report payloads that can drive visualization and automated review.

Acceptance:
- Reports are deterministic for identical profile artifacts.
- Relationship hints include confidence, evidence pointers, and reviewer-safe explanations.
- Risk indicators do not expose raw values.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

### DPM-27 - Profile Gateway And Editor Contract

Status: planned.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/test/gateway.test.ts`
- `packages/dpm/test/gateway-runtime.test.ts`

Tasks:
- Extend the DPM gateway contract with profile inspection, profile analysis, and proposal review
  payloads.
- Model editor-safe patches as proposals or overrides rather than mutations to raw connector output.
- Keep gateway schemas aligned with runtime profile and analysis contracts.

Acceptance:
- Gateway OpenAPI schemas reject incomplete profile analysis payloads.
- Editor proposals can reference profile coordinates and relationship hints.
- Runtime outputs validate against gateway schemas.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

## Breakpoints

Stop and update this goal before implementation if any unit requires:
- live Kafka consumption,
- production schema registry credentials,
- raw payload sample persistence,
- automatic relationship approval,
- source system mutation,
- vault/token execution behavior,
- UI implementation beyond gateway/editor payload contracts.

## Verification Ladder

| Stage | Gate |
|---|---|
| docs-only | `git diff --check` |
| profile vocabulary | focused profile schema tests + `typecheck` |
| connector contract | connector tests + no-live-source fixtures |
| Kafka fixture adapter | Kafka profile tests + package test |
| analysis report | analysis tests + deterministic diagnostics |
| gateway/editor contract | gateway tests + runtime schema validation |
| repo integration | `build:scripts`, `check:api-index`, `check:cli-spec`, `check:feature-tests`, `check:release-policy`, `git diff --check` |

## Done Criteria

- A DPM profile artifact can represent DB catalog and Kafka topic/message evidence through the same
  normalized node/edge/metric/diagnostic contract.
- Connector outputs are validated, source-neutral, and safe to persist.
- Profile analysis produces deterministic relationship hints, coverage metrics, drift signals, and
  risk indicators without approving relationships automatically.
- Gateway/editor contracts can inspect, analyze, and propose changes against profile coordinates.
- The progress index points to the next unchecked profile/connector unit or marks this goal complete
  only after all listed gates pass.
