# Goal 7 - DPM Profile/Connector Contract

**Status: complete 2026-07-04**

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

## Stabilization Review

The initial Goal 7 direction is correct, but implementation would drift unless three boundaries are
locked before DPM-23 starts:

1. Kafka evidence must not be forced into OpenAPI `SchemaSourceCoordinate`. Define a DPM-owned
   profile coordinate that can point to DB catalog rows, OpenAPI projections, Kafka topics, message
   schema fields, query log evidence, and manual imports.
2. `DpmProfileArtifact` must have a minimum shape before connector work begins. Otherwise each
   connector will invent its own identity, provenance, metric, and diagnostic vocabulary.
3. Profile artifacts must not replace `CatalogSnapshot` in the compiler path during this goal.
   A connector may emit profile evidence, and a profile-to-catalog adapter may be introduced later,
   but the existing DPM compiler continues to consume manifest, catalog snapshot, and registry
   snapshot contracts until an explicit migration unit says otherwise.

## Contract Shape To Lock In DPM-23

The first implementation unit should define the smallest stable vocabulary below. The concrete
TypeScript and schema names may evolve, but these semantics should not be skipped.

| Contract part | Required semantics |
|---|---|
| Artifact identity | `kind`, `profileId`, `datasetId`, `profileVersion`, `createdAt`, `freshness.versionHash` |
| Source descriptor | source kind, connector id/version, source refs, capture mode, source freshness |
| Profile coordinate | source-neutral coordinate for DB, projection, Kafka, query log, ORM, and manual evidence |
| Nodes | stable id, kind, label, coordinate, optional type/shape metadata |
| Edges | stable id, kind, from/to node ids, evidence pointers, confidence where applicable |
| Metrics | stable id, metric kind, subject node/edge id, numeric/string value, unit, evidence pointer |
| Diagnostics | severity, code, message, coordinate/evidence pointer, connector id where applicable |
| Sources map | stable evidence id to source coordinate/provenance entry |

Recommended initial taxonomies:

| Taxonomy | Initial values |
|---|---|
| Source kind | `postgresql_catalog`, `openapi_projection`, `kafka_topic_bundle`, `query_log`, `orm_metadata`, `manual_import` |
| Node kind | `dataset`, `schema`, `table`, `column`, `topic`, `partition`, `message_key`, `message_header`, `message_field`, `schema_subject`, `relationship_hint` |
| Edge kind | `contains`, `references`, `derived_from`, `observed_in`, `same_shape_as`, `candidate_relationship`, `schema_version_of` |
| Metric kind | `row_count_estimate`, `presence_ratio`, `null_ratio`, `distinct_ratio`, `uniqueness_ratio`, `inclusion_ratio`, `orphan_ratio`, `message_rate_estimate`, `key_coverage_ratio`, `schema_version_count` |
| Diagnostic family | `PROF*` for profile artifact issues, `CONN*` for connector/capture issues |

## Compatibility Rules

1. `CatalogSnapshot` remains the compiler input for existing validate/compile/dry-run behavior.
2. PostgreSQL catalog profiling may be wrapped as connector output, but its current snapshot output
   must stay compatible with existing tests and runtime adapters.
3. Kafka profile artifacts are evidence for analysis and relationship proposals, not executable
   registry entries.
4. OpenAPI projection evidence can be represented as profile nodes/edges, but the
   `@oa-sdk/openapi-projection-contract` package remains the projection boundary and must not become
   a DPM connector runtime.
5. Profile analysis reports may create relationship hints and editor proposals; only the registry
   approval lifecycle can create approved relationships.

## Implementation Units

### DPM-23 - Profile Artifact Vocabulary

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/profile/types.ts`
- `packages/dpm/src/profile/profile-taxonomy.ts`
- `packages/dpm/src/profile/profile-source-taxonomy.ts`
- `packages/dpm/src/profile/profile-node-taxonomy.ts`
- `packages/dpm/src/profile/profile-edge-taxonomy.ts`
- `packages/dpm/src/profile/profile-metric-taxonomy.ts`
- `packages/dpm/src/profile/profile-capture-taxonomy.ts`
- `packages/dpm/src/profile/profile-diagnostic-taxonomy.ts`
- `packages/dpm/src/profile/profile-source-types.ts`
- `packages/dpm/src/profile/profile-graph-types.ts`
- `packages/dpm/src/profile/profile-artifact-types.ts`
- `packages/dpm/src/profile/profile-graph-integrity.ts`
- `packages/dpm/src/profile/artifact-input-types.ts`
- `packages/dpm/src/profile/artifact.ts`
- `packages/dpm/src/profile/artifact-structural.ts`
- `packages/dpm/src/profile/artifact-snapshot.ts`
- `packages/dpm/src/profile/artifact-copy.ts`
- `packages/dpm/src/profile/artifact-envelope-copy.ts`
- `packages/dpm/src/profile/artifact-source-copy.ts`
- `packages/dpm/src/profile/artifact-graph-copy.ts`
- `packages/dpm/src/profile/artifact-diagnostic-copy.ts`
- `packages/dpm/src/profile/artifact-ordering.ts`
- `packages/dpm/src/profile/artifact-freshness.ts`
- `packages/dpm/src/profile/artifact-freshness-serialization.ts`
- `packages/dpm/src/profile/artifact-source-version-hashes.ts`
- `packages/dpm/src/profile/schema-document.ts`
- `packages/dpm/src/profile/schema-fragments.ts`
- `packages/dpm/src/profile/schema-diagnostic-section.ts`
- `packages/dpm/src/profile/schema-freshness-section.ts`
- `packages/dpm/src/profile/schema-graph-sections.ts`
- `packages/dpm/src/profile/schema-metric-section.ts`
- `packages/dpm/src/profile/schema-observation-sections.ts`
- `packages/dpm/src/profile/schema-source-sections.ts`
- `packages/dpm/src/profile/schema-types.ts`
- `packages/dpm/src/profile/schema-issues.ts`
- `packages/dpm/src/profile/schema-validation.ts`
- `packages/dpm/src/profile/schema.ts`
- `packages/dpm/test/profile-artifact.test.ts`
- `packages/dpm/test/profile-artifact-snapshot.test.ts`
- `packages/dpm/test/profile-schema.test.ts`
- `docs/internal/api-index.md`

Tasks:
- Define `DpmProfileArtifact` as the normalized evidence container for source-neutral analysis.
- Model profile identity, source kind, source refs, version hash, nodes, edges, metrics,
  diagnostics, and source coordinates.
- Define a DPM-owned profile coordinate instead of overloading OpenAPI projection source
  coordinates for Kafka and other non-OpenAPI sources.
- Promote initial source/node/edge/metric/diagnostic taxonomies to runtime constants.
- Keep raw values, source credentials, and token reverse lookup material out of the contract.
- Export public types and runtime taxonomies through `@oa-sdk/dpm`.
- Provide an explicit SDK helper for frozen profile artifact snapshots without exposing a generic
  deep-readonly utility as public API.

Acceptance:
- Profile artifacts can represent at least DB table/column evidence and Kafka topic/message-field evidence.
- Invalid source kinds, missing provenance, empty metric identity, unknown taxonomy values, and raw
  sample payload fields are rejected.
- Freshness changes when normalized profile evidence changes.
- SDK consumers can create a defensive, deeply frozen profile artifact snapshot that is isolated
  from later caller-side mutations.
- `check:api-index` recognizes the new public surface.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-artifact.test.ts test/profile-schema.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-artifact-snapshot.test.ts`
- `pnpm --filter @oa-sdk/dpm test`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm build:scripts && pnpm check:api-index`

Implementation notes:
- `DpmProfileArtifact` is implemented as a normalized source-neutral evidence graph with profile
  identity, source descriptors, DPM-owned coordinates, nodes, edges, metrics, diagnostics, and
  evidence source map. Normalization input vocabulary, deterministic structural assembly, and
  freshness attachment are split across `packages/dpm/src/profile/artifact-input-types.ts`,
  `packages/dpm/src/profile/artifact-structural.ts`, and `packages/dpm/src/profile/artifact.ts`.
- `packages/dpm/src/profile/profile-taxonomy.ts` remains the taxonomy compatibility barrel, while
  source, node, edge, metric, capture, and diagnostic taxonomy families live in dedicated
  `profile-*-taxonomy.ts` modules. Source coordinate/provenance, graph evidence, and artifact
  envelope types are split across `profile-source-types.ts`, `profile-graph-types.ts`, and
  `profile-artifact-types.ts`. `packages/dpm/src/profile/types.ts` remains the compatibility barrel.
- The profile artifact JSON Schema rejects unknown taxonomy values, missing node provenance,
  incomplete metrics, raw top-level payload fields, and unsafe `shape` metadata keys such as
  raw/sample/payload/secret/token/vault hints.
- `profile-graph-integrity.ts` collects profile source/graph/evidence integrity issues once so
  connector validation and analysis diagnostics map the same artifact facts to their own diagnostic
  families.
- `artifact-envelope-copy.ts` owns full profile artifact defensive copy so connector and gateway
  outputs behave as stable snapshots after construction.
- `artifact-snapshot.ts` reuses the defensive artifact copy path, deep freezes the copied profile,
  and exposes only `DpmProfileArtifactSnapshot` plus `createDpmProfileArtifactSnapshot()` through
  `@oa-sdk/dpm` so product editors can keep read-only measurement baselines.

### DPM-24 - Connector Output Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/profile/connector.ts`
- `packages/dpm/src/profile/connector-capability-types.ts`
- `packages/dpm/src/profile/connector-hash-input.ts`
- `packages/dpm/src/profile/connector-freshness-types.ts`
- `packages/dpm/src/profile/connector-result-types.ts`
- `packages/dpm/src/profile/connector-source-version-hashes.ts`
- `packages/dpm/src/profile/connector-structural-hash.ts`
- `packages/dpm/src/profile/connector-taxonomy.ts`
- `packages/dpm/src/profile/connector-types.ts`
- `packages/dpm/src/profile/connector-validation-result-types.ts`
- `packages/dpm/src/profile/connector-result.ts`
- `packages/dpm/src/profile/connector-freshness.ts`
- `packages/dpm/src/profile/connector-run-hash.ts`
- `packages/dpm/src/profile/connector-normalize.ts`
- `packages/dpm/src/profile/connector-validate.ts`
- `packages/dpm/src/profile/connector-validation.ts`
- `packages/dpm/src/profile/connector-validation-gates.ts`
- `packages/dpm/src/profile/connector-validation-capability-gates.ts`
- `packages/dpm/src/profile/connector-validation-payload-gates.ts`
- `packages/dpm/src/profile/connector-validation-graph-gates.ts`
- `packages/dpm/src/profile/connector-validation-diagnostic.ts`
- `packages/dpm/test/profile-connector.test.ts`
- `packages/dpm/test/profile-connector-validation-payload.test.ts`
- `packages/dpm/test/profile-connector-validation-capability.test.ts`

Tasks:
- Define a connector result contract that returns profile artifact, connector diagnostics, freshness,
  and capability metadata.
- Separate connector capabilities from profile evidence so UI and automation can explain what was
  observed, skipped, or unsupported.
- Include connector id/version, capture mode, supported evidence kinds, skipped evidence kinds, and
  capture diagnostics in the result.
- Add deterministic validation for connector output without requiring a live source.

Acceptance:
- PostgreSQL catalog profiling can be described as one connector output path without changing the
  existing profiler behavior.
- Kafka/topic fixture profiling can use the same connector result shape.
- Connector failures are diagnostic payloads, not thrown-away strings.
- A connector result cannot claim unsupported evidence as observed evidence.
- A schema-valid profile artifact with duplicate source ids, duplicate graph ids, dangling node
  refs, missing metric subjects, missing evidence refs, or missing source refs is rejected by
  connector validation.
- A schema-invalid profile artifact returns `CONN107` and does not continue into graph integrity
  traversal as if the payload were typed.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-connector.test.ts test/profile-connector-validation-payload.test.ts test/profile-connector-validation-capability.test.ts`
- `pnpm --filter @oa-sdk/dpm typecheck`

Implementation notes:
- `DpmProfileConnectorResult` is implemented as a deterministic connector output envelope with
  connector identity, source kind, capture mode, capability metadata, observed evidence kinds,
  diagnostics, optional profile artifact, and run freshness hash.
- `packages/dpm/src/profile/connector-types.ts` remains the compatibility barrel, while connector
  taxonomy, capability metadata, freshness references, result envelope, and validation result
  vocabulary live in dedicated connector type modules.
- `packages/dpm/src/profile/connector-freshness.ts` remains the freshness helper compatibility
  barrel, while `connector-hash-input.ts`, `connector-structural-hash.ts`, and
  `connector-source-version-hashes.ts` separately own hash input assembly, deterministic structural
  hashing, and source version hash ordering.
- Connector run hash helpers canonicalize their inputs through the same structural copy/order path
  used by connector result normalization.
- Connector validation checks capability identity, supported source/capture modes, unsupported or
  skipped observed evidence kinds, failed-result diagnostics, completed-result profile artifacts,
  emitted profile artifact schema validity, connector identity mismatch in emitted sources, and
  shared source/graph/evidence reference integrity. Schema-invalid artifacts stop at payload
  diagnostics before graph traversal.
- Connector normalization defensively copies emitted profile artifacts before attaching them to the
  result envelope.
- PostgreSQL catalog profiling and Kafka fixture evidence can both be represented through the same
  connector result contract without changing the existing `CatalogSnapshot` compiler path.

### DPM-25 - Kafka Topic Profile Fixture Adapter

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/profile/kafka-fixture-types.ts`
- `packages/dpm/src/profile/kafka.ts`
- `packages/dpm/src/profile/kafka-topic-profile.ts`
- `packages/dpm/src/profile/kafka-topic-profile-graph.ts`
- `packages/dpm/src/profile/kafka-topic-profile-graph-types.ts`
- `packages/dpm/src/profile/kafka-topic-profile-graph-sections.ts`
- `packages/dpm/src/profile/kafka-topic-profile-graph-fields.ts`
- `packages/dpm/src/profile/kafka-topic-profile-graph-hints.ts`
- `packages/dpm/src/profile/kafka-topic-source.ts`
- `packages/dpm/src/profile/kafka-topic-root.ts`
- `packages/dpm/src/profile/kafka-topic-key-headers.ts`
- `packages/dpm/src/profile/kafka-topic-key.ts`
- `packages/dpm/src/profile/kafka-topic-headers.ts`
- `packages/dpm/src/profile/kafka-topic-partitions.ts`
- `packages/dpm/src/profile/kafka-topic-schema.ts`
- `packages/dpm/src/profile/kafka-topic-section-types.ts`
- `packages/dpm/src/profile/kafka-topic-sections.ts`
- `packages/dpm/src/profile/kafka-profile-evidence.ts`
- `packages/dpm/src/profile/kafka-profile-fields.ts`
- `packages/dpm/src/profile/kafka-profile-field-types.ts`
- `packages/dpm/src/profile/kafka-profile-field-context.ts`
- `packages/dpm/src/profile/kafka-profile-path.ts`
- `packages/dpm/src/profile/kafka-profile-field-nodes.ts`
- `packages/dpm/src/profile/kafka-profile-field-metrics.ts`
- `packages/dpm/src/profile/kafka-profile-graph.ts`
- `packages/dpm/src/profile/kafka-profile-hint-diagnostic.ts`
- `packages/dpm/src/profile/kafka-profile-hint-edge.ts`
- `packages/dpm/src/profile/kafka-profile-hint-evidence.ts`
- `packages/dpm/src/profile/kafka-profile-hint-node.ts`
- `packages/dpm/src/profile/kafka-profile-hint-types.ts`
- `packages/dpm/src/profile/kafka-profile-hints.ts`
- `packages/dpm/test/profile-kafka-connector.test.ts`
- `packages/dpm/test/profile-kafka-connector-freshness.test.ts`
- `packages/dpm/test/profile-kafka-graph-fields.test.ts`
- `packages/dpm/test/profile-kafka-graph-sections.test.ts`
- `packages/dpm/test/profile-kafka-graph-hints.test.ts`
- `packages/dpm/examples/profile-kafka/`
- `packages/dpm/test/profile-demo-surface.test.ts`
- `packages/dpm/test/profile-demo-command.test.ts`
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
- Relationship hints whose `fromPath` does not resolve to a flattened field node become profile
  diagnostics and do not create dangling `candidate_relationship` edges or reviewer proposals.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-kafka-graph-hints.test.ts test/profile-analysis-relationship-hints.test.ts test/profile-kafka-connector.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-demo-surface.test.ts test/profile-demo-command.test.ts`
- `pnpm demo:dpm:profile`
- `pnpm --filter @oa-sdk/dpm test`

Implementation notes:
- `profileKafkaTopicFixture()` maps fixture-only Kafka topic evidence into the DPM profile artifact
  and connector result contracts without accepting a live Kafka client.
- `kafka-topic-source.ts` owns source descriptor, Kafka ref, and fixture version hash construction;
  `kafka-topic-root.ts` owns topic root evidence and node bootstrap.
- `kafka-topic-sections.ts` re-exports section helpers; `kafka-topic-partitions.ts` emits partition
  nodes and topic message-rate metrics, `kafka-topic-key-headers.ts` remains the key/header section
  compatibility barrel, `kafka-topic-key.ts` emits key nodes and coverage metrics,
  `kafka-topic-headers.ts` emits header nodes and presence metrics, and `kafka-topic-schema.ts`
  emits schema subject nodes and schema version metrics;
  `kafka-profile-fields.ts` owns nested value field recursion orchestration, while
  `kafka-profile-field-context.ts`, `kafka-profile-field-nodes.ts`, and
  `kafka-profile-field-metrics.ts` separately own field context derivation, field node/edge append,
  and field metric append. `kafka-profile-hints.ts` remains the relationship hint append
  compatibility entrypoint, while `kafka-profile-hint-types.ts`,
  `kafka-profile-hint-evidence.ts`, `kafka-profile-hint-node.ts`,
  `kafka-profile-hint-edge.ts`, and `kafka-profile-hint-diagnostic.ts` separately own hint input
  vocabulary, evidence source append, hint node creation, candidate edge creation, and unresolved
  source field diagnostics.
- Relationship hints are represented as `relationship_hint` nodes and `candidate_relationship`
  edges only when the hinted source field node exists; they do not create approved registry
  relationships or alter the existing compiler path.
- `packages/dpm/examples/profile-kafka/run-demo.mjs` exercises the public package API for
  fixture-backed Kafka flattening, SDK read-only profile artifact snapshot creation, gateway
  inspection, gateway analysis, previous/current profile baseline drift comparison, proposal
  review, mismatch guard diagnostics, and inspection snapshot copy proof without live Kafka access.

### DPM-26 - Profile Analysis Report

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/profile/analysis-types.ts`
- `packages/dpm/src/profile/analysis-taxonomy.ts`
- `packages/dpm/src/profile/analysis-input-types.ts`
- `packages/dpm/src/profile/analysis-coverage-types.ts`
- `packages/dpm/src/profile/analysis-relationship-hint-types.ts`
- `packages/dpm/src/profile/analysis-key-candidate-types.ts`
- `packages/dpm/src/profile/analysis-risk-types.ts`
- `packages/dpm/src/profile/analysis-drift-signal-types.ts`
- `packages/dpm/src/profile/analysis-signal-types.ts`
- `packages/dpm/src/profile/analysis-report-types.ts`
- `packages/dpm/src/profile/analysis-report-signals.ts`
- `packages/dpm/src/profile/analysis-report-structural.ts`
- `packages/dpm/src/profile/analysis-report.ts`
- `packages/dpm/src/profile/analysis-summary.ts`
- `packages/dpm/src/profile/analysis-report-freshness.ts`
- `packages/dpm/src/profile/analysis-graph-diagnostics.ts`
- `packages/dpm/src/profile/analysis-coverage.ts`
- `packages/dpm/src/profile/analysis-compute.ts`
- `packages/dpm/src/profile/analysis-hints.ts`
- `packages/dpm/src/profile/analysis-key-candidates.ts`
- `packages/dpm/src/profile/analysis-risks.ts`
- `packages/dpm/src/profile/analysis-utils.ts`
- `packages/dpm/src/profile/analysis-node-utils.ts`
- `packages/dpm/src/profile/analysis-metric-utils.ts`
- `packages/dpm/src/profile/analysis-ordering-utils.ts`
- `packages/dpm/src/profile/analysis-drift.ts`
- `packages/dpm/src/profile/analysis-drift-identity.ts`
- `packages/dpm/src/profile/analysis-drift-freshness.ts`
- `packages/dpm/src/profile/analysis-drift-nodes.ts`
- `packages/dpm/src/profile/analysis-drift-metrics.ts`
- `packages/dpm/src/profile/analyze.ts`
- `packages/dpm/test/profile-analysis.test.ts`

Tasks:
- Analyze profile artifacts into coverage, relationship hints, join/key candidates, drift signals,
  and privacy risk indicators.
- Reuse DPM diagnostic severity/code conventions where practical while keeping profile analysis
  diagnostics distinct from manifest validation diagnostics.
- Emit relationship hints as proposals with evidence pointers, not registry relationships.
- Produce report payloads that can drive visualization and automated review.
- Keep report orchestration and deterministic report hash serialization as separate
  implementation boundaries.
- Keep profile drift orchestration, freshness/source drift, node drift, and metric drift as separate
  implementation boundaries.

Acceptance:
- Reports are deterministic for identical profile artifacts.
- Relationship hints include confidence, evidence pointers, and reviewer-safe explanations.
- Relationship hint proposals are emitted only when the candidate edge resolves both its source node
  and `relationship_hint` target node.
- Analysis reports surface direct profile source/graph integrity issues as `PROF302` through
  `PROF306` diagnostics.
- Analysis reports defensively copy profile and graph diagnostics before report freshness hashing.
- Coverage counts measured node ratio from metrics whose subjects resolve to nodes; edge metrics do
  not inflate node coverage.
- Risk indicators do not expose raw values.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

Implementation notes:
- `createDpmProfileAnalysisReport()` assembles deterministic coverage, relationship hint proposals,
  freshness envelope from a normalized profile artifact.
- `analysis-report-signals.ts` owns deterministic coverage, relationship hint, key candidate,
  drift signal, and risk indicator collection for the report.
- `analysis-report-structural.ts` owns report identity, profile metadata, diagnostic ordering,
  graph integrity diagnostic attachment, signal placement, and summary attachment before freshness is
  added.
- `analysis-report-structural.ts` defensively copies diagnostics so caller-side profile mutation
  cannot alter an already-created analysis report.
- `analysis-graph-diagnostics.ts` maps shared profile integrity issues to analysis diagnostics for
  duplicate source ids, duplicate graph ids, dangling edge node refs, missing metric subjects,
  missing source refs, and missing evidence refs.
- `createDpmProfileAnalysisSummary()` owns diagnostic and signal count assembly, while
  `sortDpmProfileAnalysisDiagnostics()` owns deterministic diagnostic ordering.
- `computeDpmProfileAnalysisReportHash()` owns stable report serialization and report freshness
  hash calculation.
- `packages/dpm/src/profile/analysis-signal-types.ts` remains the analysis signal compatibility
  barrel, while coverage, relationship hint, key candidate, risk, and drift signal vocabulary live
  in dedicated `analysis-*-types.ts` modules.
- `analyzeDriftSignals()` orchestrates identity, freshness/source, node, and metric drift signals without
  merging those signal categories into one implementation owner. If previous/current dataset or profile
  identity differs, it emits only `profile_identity_mismatch` instead of mixing unrelated node/metric drift.
- Relationship hints are emitted as reviewer-safe `review` proposals with confidence and evidence
  ids only when the candidate edge resolves to an existing source node and `relationship_hint` target
  node; they do not become registry relationships.
- Risk indicators are derived from profile coordinates and metrics only, and do not expose raw
  source values.

### DPM-27 - Profile Gateway And Editor Contract

Status: implemented 2026-07-04.

Artifacts:
- `packages/dpm/src/gateway/openapi.ts`
- `packages/dpm/src/gateway/openapi-core-schemas.ts`
- `packages/dpm/src/gateway/openapi-common-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi.ts`
- `packages/dpm/src/gateway/profile-openapi-artifact-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-source-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-graph-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-artifact-envelope-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-inspection-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-report-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-exchange-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-report-envelope-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-summary-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-freshness-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-signal-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-coverage-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-relationship-hint-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-key-candidate-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-drift-schemas.ts`
- `packages/dpm/src/gateway/profile-openapi-analysis-risk-schemas.ts`
- `packages/dpm/src/gateway/openapi-paths.ts`
- `packages/dpm/src/gateway/openapi-profile-paths.ts`
- `packages/dpm/src/gateway/runtime.ts`
- `packages/dpm/src/gateway/runtime-profile-types.ts`
- `packages/dpm/src/gateway/runtime-types.ts`
- `packages/dpm/src/gateway/runtime-factory.ts`
- `packages/dpm/src/gateway/runtime-profile.ts`
- `packages/dpm/src/gateway/runtime-profile-inspect.ts`
- `packages/dpm/src/gateway/runtime-profile-analyze.ts`
- `packages/dpm/src/gateway/runtime-profile-proposal-review.ts`
- `packages/dpm/src/gateway/runtime-response.ts`
- `packages/dpm/test/gateway.test.ts`
- `packages/dpm/test/gateway-taxonomy.test.ts`
- `packages/dpm/test/gateway-schema-validation.test.ts`
- `packages/dpm/test/gateway-runtime.test.ts`
- `packages/dpm/test/gateway-runtime-profile-inspection.test.ts`
- `packages/dpm/test/gateway-runtime-profile-analysis.test.ts`
- `packages/dpm/test/gateway-runtime-profile-proposal-review.test.ts`

Tasks:
- Extend the DPM gateway contract with profile inspection, profile analysis, and proposal review
  payloads.
- Model editor-safe patches as proposals or overrides rather than mutations to raw connector output.
- Define proposal lifecycle values before accepting editor payloads.
- Keep gateway schemas aligned with runtime profile and analysis contracts.

Acceptance:
- Gateway OpenAPI schemas reject incomplete profile analysis payloads.
- Editor proposals can reference profile coordinates and relationship hints.
- Proposal payloads cannot overwrite connector evidence directly.
- Runtime outputs validate against gateway schemas.
- Profile inspection runtime returns a defensive profile artifact copy for editor consumption.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts test/gateway-taxonomy.test.ts test/gateway-schema-validation.test.ts`
- `pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime.test.ts test/gateway-runtime-profile-inspection.test.ts test/gateway-runtime-profile-analysis.test.ts test/gateway-runtime-profile-proposal-review.test.ts`
- `pnpm --filter @oa-sdk/dpm test`

Implementation notes:
- Gateway OpenAPI now exposes profile inspection, profile analysis, and profile proposal review
  operations under `/dpm/profiles/*`.
- Profile gateway component schemas project the DPM profile source/node/edge/metric taxonomies,
  analysis report taxonomies, and proposal review lifecycle values. Artifact schema ownership is
  split into source, graph, artifact envelope, and inspection files; analysis schema ownership is
  split into request/response exchange, report envelope, summary, freshness, coverage, relationship
  hint, key candidate, drift, and risk signal files.
- Proposal review payloads can reference profile coordinates and relationship hint proposals, but
  cannot carry raw evidence patches, profile artifact overwrites, or connector evidence mutations.
- `packages/dpm/src/gateway/runtime-factory.ts:createDpmGatewayRuntime()` composes loaded profile
  inspection, analysis, and proposal review handlers through the
  `packages/dpm/src/gateway/runtime-profile.ts` compatibility barrel. The concrete handlers are
  owned by `runtime-profile-inspect.ts`, `runtime-profile-analyze.ts`, and
  `runtime-profile-proposal-review.ts`; these responses validate against the gateway schemas while
  preserving the existing manifest validate/compile/dry-run runtime behavior.
- Profile inspection runtime returns a copied profile artifact and diagnostics snapshot so later
  caller-side mutation cannot alter an already-created inspection response.
- Profile proposal review runtime copies response coordinates, relationship hint proposals, and
  diagnostic evidence ids so editor-side mutation cannot alter an already-created review response.

## Completion Evidence

Completed 2026-07-04 with:
- `corepack pnpm --filter @oa-sdk/dpm exec vitest run test/gateway.test.ts test/gateway-taxonomy.test.ts test/gateway-schema-validation.test.ts`
- `corepack pnpm --filter @oa-sdk/dpm exec vitest run test/gateway-runtime.test.ts test/gateway-runtime-profile-inspection.test.ts test/gateway-runtime-profile-analysis.test.ts test/gateway-runtime-profile-proposal-review.test.ts`
- `corepack pnpm --filter @oa-sdk/dpm typecheck`
- `corepack pnpm --filter @oa-sdk/dpm test`
- `corepack pnpm build:scripts`
- `corepack pnpm check:api-index`
- `corepack pnpm check:cli-spec`
- `corepack pnpm check:feature-tests`
- `corepack pnpm check:release-policy`
- `git diff --check`

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
