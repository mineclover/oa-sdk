# Feature Test Matrix

> Machine-readable source: [`feature-test-matrix.json`](./feature-test-matrix.json)

This matrix maps oa-sdk features to the automated tests and commands that protect them. Use it when adding features, moving tests, or changing package responsibilities.

## Maintenance Rules

- Add a feature entry when a new user-visible capability is introduced.
- Add at least one `testPaths` entry for every feature. A path may be a concrete file or a glob.
- Prefer focused test paths over only package-wide commands.
- Keep `commands` runnable from the repository root.
- Run `pnpm check:feature-tests` after moving or renaming tests.

## Assertion Depth Policy

`pnpm check:feature-tests` is a drift guard, not a semantic test runner. It
proves that every feature has owned test paths and commands, then package tests
prove the actual behavior. When a feature's matrix row uses broad globs, the
`Representative Tests` column must name concrete files that contain the core
assertions for that feature.

For deeper assertion audits, review one or two representative tests per feature
before adding new rows. If the representative tests only instantiate code
without checking behavior, add focused assertions or split the matrix row.

## Feature Groups

| Feature ID | Package | Coverage Focus | Representative Tests |
|---|---|---|---|
| `core-utilities` | `@oa-sdk/core` | shared helper behavior | `packages/core/src/__tests__/*.test.ts` |
| `oas32-parser-ir` | `@oa-sdk/parser` | parsing, lint, validation, query APIs | `packages/parser/src/__tests__/parse-document.test.ts`, `validate.test.ts`, `query.test.ts` |
| `refs-source-schema-algebra` | `@oa-sdk/parser` | `$ref`, deref, source locations, schema folding | `packages/parser/src/__tests__/ref-graph.test.ts`, `source-location.test.ts`, `fold.test.ts` |
| `openapi-projection-contract` | `@oa-sdk/openapi-projection-contract` | projection profiles, extensions, validation | `packages/openapi-projection-contract/src/validation.test.ts`, `projection-extensions.test.ts` |
| `dpm-manifest-schema` | `@oa-sdk/dpm` | relationship-first DPM manifest schema and fixture gates | `packages/dpm/test/schema.test.ts`, `smoke.test.ts` |
| `dpm-catalog-snapshot` | `@oa-sdk/dpm` | PostgreSQL catalog snapshot normalization, OpenAPI projection adapter, freshness hash | `packages/dpm/test/catalog-freshness.test.ts`, `packages/dpm/test/catalog-postgres.test.ts`, `packages/dpm/test/catalog-projection.test.ts` |
| `dpm-postgres-catalog-profiler` | `@oa-sdk/dpm` | read-only PostgreSQL catalog profiler query, row-to-snapshot mapping, and structural freshness | `packages/dpm/test/catalog-profiler-client.test.ts`, `packages/dpm/test/catalog-profiler-query.test.ts`, `packages/dpm/test/catalog-profiler-rows.test.ts`, `packages/dpm/test/catalog-profiler-structure-rows.test.ts`, `packages/dpm/test/catalog-profiler-integrity-rows.test.ts`, `packages/dpm/test/catalog-profiler-source-map.test.ts`, `packages/dpm/test/catalog-profiler-freshness.test.ts`, `packages/dpm/test/fixtures/catalog/profiler-postgres.sql` |
| `dpm-profile-artifact` | `@oa-sdk/dpm` | source-neutral profile artifact schema, coordinates, nodes, edges, metrics, diagnostics, freshness | `packages/dpm/test/profile-artifact.test.ts`, `packages/dpm/test/profile-schema.test.ts` |
| `dpm-profile-connector` | `@oa-sdk/dpm` | connector output envelope, capability/evidence validation, connector/profile freshness | `packages/dpm/test/profile-connector.test.ts`, `packages/dpm/test/profile-connector-validation.test.ts` |
| `dpm-kafka-profile-fixture` | `@oa-sdk/dpm` | fixture-backed Kafka topic/message flattening into profile artifact and connector result | `packages/dpm/test/profile-kafka-connector.test.ts`, `packages/dpm/test/profile-kafka-graph-fields.test.ts`, `packages/dpm/test/profile-kafka-graph-hints.test.ts`, `packages/dpm/test/profile-kafka-graph-sections.test.ts` |
| `dpm-profile-analysis` | `@oa-sdk/dpm` | profile coverage, relationship hint proposals, key candidates, drift, and risk analysis | `packages/dpm/test/profile-analysis-coverage.test.ts`, `packages/dpm/test/profile-analysis-drift.test.ts`, `packages/dpm/test/profile-analysis-key-candidates.test.ts`, `packages/dpm/test/profile-analysis-relationship-hints.test.ts`, `packages/dpm/test/profile-analysis-report.test.ts`, `packages/dpm/test/profile-analysis-risk.test.ts` |
| `dpm-discovery-report` | `@oa-sdk/dpm` | non-executable relationship discovery candidate reports and evidence preservation | `packages/dpm/test/discovery-candidate-rejection.test.ts`, `packages/dpm/test/discovery-classification.test.ts`, `packages/dpm/test/discovery-evidence.test.ts`, `packages/dpm/test/discovery-report.test.ts` |
| `dpm-registry-snapshot` | `@oa-sdk/dpm` | versioned registry snapshots, YAML review artifacts, approved-only execution selection | `packages/dpm/test/registry-executable.test.ts`, `packages/dpm/test/registry-history.test.ts`, `packages/dpm/test/registry-identity.test.ts`, `packages/dpm/test/registry-snapshot-yaml.test.ts` |
| `dpm-registry-storage` | `@oa-sdk/dpm` | Postgres canonical registry storage schema and row-reader export to the registry snapshot contract | `packages/dpm/test/storage-registry-schema.test.ts`, `packages/dpm/test/storage-registry-row-mapper.test.ts`, `packages/dpm/test/storage-registry-repository.test.ts` |
| `dpm-model` | `@oa-sdk/dpm` | entity root key contracts, logical relationship predicates, canonical key rendering | `packages/dpm/test/model-entity.test.ts`, `packages/dpm/test/model-relationship.test.ts` |
| `dpm-semantic-validator` | `@oa-sdk/dpm` | SYN syntax plus REL/SAF semantic diagnostics from manifest, catalog snapshot, and registry snapshot | `packages/dpm/test/validator.test.ts`, `packages/dpm/test/validator-relationship-diagnostics.test.ts`, `packages/dpm/test/validator-relationship-registry-approval.test.ts`, `packages/dpm/test/validator-relationship-registry-snapshot.test.ts`, `packages/dpm/test/validator-safety.test.ts` |
| `dpm-compiler-dry-run` | `@oa-sdk/dpm` | validator-gated compiled plans using approved registry relationship steps and raw-value-free dry-run impact reports | `packages/dpm/test/compiler-plan.test.ts`, `packages/dpm/test/compiler-staleness.test.ts`, `packages/dpm/test/compiler-validation.test.ts`, `packages/dpm/test/dry-run.test.ts` |
| `dpm-cli-surface` | `@oa-sdk/dpm` | validate, compile, and dry-run CLI JSON output over explicit fixture paths with schema-gated validation | `packages/dpm/test/cli-execution.test.ts`, `packages/dpm/test/cli-validate.test.ts`, `packages/dpm/test/cli-validate-blocking-diagnostics.test.ts`, `packages/dpm/test/cli-validate-schema-gate.test.ts` |
| `dpm-primary-demo` | `@oa-sdk/dpm` | customer-orders primary CLI demo for validate, compile, dry-run, and guard scenarios without source DB access | `packages/dpm/test/demo-command.test.ts`, `packages/dpm/test/demo-compile.test.ts`, `packages/dpm/test/demo-dry-run.test.ts`, `packages/dpm/test/demo-surface.test.ts`, `packages/dpm/test/demo-validate.test.ts`, `packages/dpm/examples/customer-orders/README.md` |
| `dpm-storage-demo` | `@oa-sdk/dpm` | storage-backed customer-orders demo for catalog profiling, registry export, validate/compile/dry-run, and report retrieval | `packages/dpm/test/storage-demo-command.test.ts`, `packages/dpm/test/storage-demo-pipeline.test.ts`, `packages/dpm/test/storage-demo-surface.test.ts`, `packages/dpm/examples/customer-orders-storage/README.md` |
| `dpm-gateway-contract` | `@oa-sdk/dpm` | OpenAPI 3.2 gateway contract for DPM lifecycle and profile/editor operations | `packages/dpm/test/gateway-schema-components.test.ts`, `packages/dpm/test/gateway-schema-profile-editor.test.ts`, `packages/dpm/test/gateway-schema-requests.test.ts`, `packages/dpm/test/gateway-schema-response-job.test.ts`, `packages/dpm/test/gateway-schema-response-minimal.test.ts`, `packages/dpm/test/gateway-schema-response-required.test.ts`, `packages/dpm/test/gateway-schema-response-taxonomy.test.ts`, `packages/dpm/test/gateway.test.ts`, `packages/dpm/test/gateway-taxonomy-diagnostics.test.ts`, `packages/dpm/test/gateway-taxonomy-plan.test.ts`, `packages/dpm/test/gateway-taxonomy-profile.test.ts`, `packages/dpm/test/gateway-taxonomy-relationship-step.test.ts`, `packages/dpm/test/gateway-taxonomy-workflow.test.ts` |
| `dpm-gateway-runtime` | `@oa-sdk/dpm` | profile inspection/analysis/proposal review plus validate, compile, and dry-run gateway runtime handlers without source access | `packages/dpm/test/gateway-runtime.test.ts`, `packages/dpm/test/gateway-runtime-manifest-blocking-diagnostics.test.ts`, `packages/dpm/test/gateway-runtime-manifest-compile.test.ts`, `packages/dpm/test/gateway-runtime-manifest-diagnostic-schema.test.ts`, `packages/dpm/test/gateway-runtime-manifest-dry-run.test.ts`, `packages/dpm/test/gateway-runtime-manifest-plan-schema.test.ts`, `packages/dpm/test/gateway-runtime-manifest-response-schema.test.ts`, `packages/dpm/test/gateway-runtime-manifest-schema-parity.test.ts`, `packages/dpm/test/gateway-runtime-manifest-validate.test.ts`, `packages/dpm/test/gateway-runtime-profile.test.ts` |
| `dpm-job-report-storage` | `@oa-sdk/dpm` | compile/dry-run job metadata and validation report persistence without raw or secret-bearing payloads | `packages/dpm/test/storage-report-job-repository.test.ts`, `packages/dpm/test/storage-report-repository-completed.test.ts`, `packages/dpm/test/storage-report-repository-failed.test.ts`, `packages/dpm/test/storage-report-gateway-projection.test.ts` |
| `dpm-publishing-context` | `@oa-sdk/dpm` | AI relationship metadata, read-only schema context, and recommendation-only physical FK output | `packages/dpm/test/publishing-ai-schema.test.ts`, `packages/dpm/test/publishing-physical-fk.test.ts`, `packages/dpm/test/publishing-safety.test.ts` |
| `definition-builder` | `@oa-sdk/parser`, `@oa-sdk/codegen` | definition registry, target selection, emit, composition/provenance reports, workspace index | `packages/parser/src/__tests__/definition-*.test.ts`, `packages/codegen/src/__tests__/builder-*.test.ts` |
| `schema-authoring-workflow` | `@oa-sdk/schemas` | merge, fixture, upgrade, downgrade scripts | `packages/schemas/scripts/__tests__/merge.test.ts`, `upgrade.test.ts`, `downgrade.test.ts` |
| `definition-duplicate-review` | `@oa-sdk/codegen` | Definition Builder duplicate identity risk reports | `packages/codegen/src/__tests__/duplicate-review.test.ts`, `cli-duplicate-review.test.ts` |
| `target-check` | `@oa-sdk/codegen` | emitted OpenAPI path include/exclude assertions | `packages/codegen/src/__tests__/target-coverage.test.ts`, `cli-target-check.test.ts` |
| `zod-drizzle-to-oas` | `@oa-sdk/codegen` | Zod and Drizzle schema generation | `packages/codegen/src/__tests__/zod-to-schema.test.ts`, `packages/codegen/src/__tests__/drizzle/*.test.ts` |
| `source-adapter-boundaries` | `@oa-sdk/codegen` | normalized source fragments for Zod, Drizzle, Projection envelopes, Python snapshots, and file-backed inputs | `packages/codegen/src/__tests__/codegen-source-adapters.test.ts`, `source-file-adapters.test.ts`, `openapi-source-fragments.test.ts` |
| `typegen` | `@oa-sdk/codegen` | TypeScript type generation | `packages/codegen/src/__tests__/typegen/*.test.ts`, `mock-typegen-compat.test.ts` |
| `typespec-roundtrip-export` | `@oa-sdk/codegen` | OpenAPI artifact to TypeSpec export, generated/authored bundle manifest, generated bundle expected OpenAPI, `oa-sdk.typespec-extensions.v1` schema, `oa-sdk.typespec-extensions.v2` request body examples schema, sidecar-to-extension migration, TypeSpec authoring ownership guide, accepted TSP-first ADR, TSP-first decision design, TypeSpec production migration G9-G15 goals, production TypeSpec source layout, production TypeSpec default schema source switch, production TypeSpec schema check, production TypeSpec accepted restored drift manifest, production TypeSpec rollback gate, production TypeSpec downstream consumer gate, production TypeSpec operations runbook, generated TypeScript and synthetic webhook/header compile smoke, sidecar-less, representative, request body, and canonical TypeSpec extension bundle checks, canonical fixture regeneration workflow, `oa-gen tsp-bundle-check` bundle gate, compatibility sidecar restore, sidecar re-extraction stability, roundtrip probe, and diagnostic policy gate | `packages/codegen/src/__tests__/tsp-export.test.ts`, `typespec-sidecar.test.ts`, `typespec-sidecar-to-extensions.test.ts`, `typespec-authored-bundle.test.ts`, `cli-tsp-sidecar.test.ts`, `openapi-breaking-diff.test.ts`, `typespec-roundtrip-report.test.ts`, `cli/commands/tsp-bundle-check.ts`, `cli/lib/typespec-bundle-check.ts`, `cli/lib/typespec-oa-sdk-extensions.ts`, `cli/lib/typespec-sidecar-to-extensions.ts`, `scripts/typespec-roundtrip.ts`, `scripts/typespec-bundle-check.ts`, `scripts/typespec-sidecar-to-extensions.ts`, `scripts/typespec-create-authored-canonical-fixture.ts`, `scripts/schema-typespec-check.ts`, `scripts/schema-rollback-check.ts`, `scripts/schema-typespec-downstream-check.ts`, `fixtures/authored-extension-bundle/main.tsp`, `fixtures/authored-representative-bundle/main.tsp`, `fixtures/authored-request-body-extension-bundle/main.tsp`, `fixtures/authored-canonical-bundle/main.tsp`, `packages/schemas/typespec/main.tsp`, `packages/schemas/typespec/oa-sdk.typespec-bundle.json`, `packages/schemas/typespec/accepted-restored-drift.json`, `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v1.md`, `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v2.md`, `docs/internal/typespec-roundtrip/authoring-ownership-guide.md`, `docs/internal/typespec-roundtrip/sidecar-to-extension-migration.md`, `docs/internal/typespec-roundtrip/production-migration-goals.md`, `docs/internal/typespec-roundtrip/production-operations.md`, `docs/internal/architecture/009-typespec-first-authoring.md`, `docs/internal/typespec-roundtrip/tsp-first-decision-design.md`, `docs/internal/typespec-roundtrip.plan.md` |
| `cli-codegen-workflow` | `@oa-sdk/codegen` | `oa-gen` command behavior, including build-spec sidecars, behavior logging, metadata registry, behavior query, inventory, runtime URL drift, provenance, review reports, metadata/provenance diff, and review bundles | `packages/codegen/src/__tests__/cli*.test.ts`, `cli-scenarios.test.ts`, `behavior-recorder.test.ts`, `behavior-projection.test.ts` |
| `runtime-openapi-url-drift` | `@oa-sdk/codegen` | runtime OpenAPI URL fetch for drift checks | `packages/codegen/src/__tests__/cli-scenarios.test.ts`, `runtime-openapi-fetch.test.ts` |
| `openapi-provenance` | `@oa-sdk/codegen` | output pointer provenance maps and review provenance diffs | `packages/codegen/src/__tests__/cli-build-spec.test.ts`, `cli-scenarios.test.ts` |
| `openapi-inventory` | `@oa-sdk/codegen` | OpenAPI surface inventory reports | `packages/codegen/src/__tests__/openapi-inventory.test.ts`, `cli-scenarios.test.ts` |
| `router-generation` | `@oa-sdk/router` | Hono/Express router stubs | `packages/router/src/__tests__/generate-router.test.ts`, `router-edge-cases.test.ts` |
| `client-generation` | `@oa-sdk/client` | fetch client and streaming client generation | `packages/client/src/__tests__/generate-client.test.ts`, `sse-client.test.ts` |
| `mock-server` | `@oa-sdk/mock-server` | MSW/Node mock server, validation, callbacks, XML, streaming | `packages/mock-server/src/__tests__/unit/*.test.ts`, `integration/*.test.ts`, `oas32/*.test.ts` |
| `typia-mock` | `@oa-sdk/typia-mock` | typia function validation server | `packages/typia-mock/src/__tests__/unit/*.test.ts`, `integration/server.test.ts` |
| `playground-pipeline` | `playground` | cross-package E2E workflows | `apps/playground/tests/e2e-pipeline.test.ts`, `codegen-pipeline.test.ts` |
| `external-openapi-governance-scaffold` | `@oa-sdk/codegen` | scaffold-governance/collect/normalize/upgrade for third-party OpenAPI artifact intake (NestJS Swagger, FastAPI) | `packages/codegen/src/__tests__/openapi-collect.test.ts`, `openapi-governance-scaffold.test.ts`, `cli-openapi-collect.test.ts`, `apps/{nestjs-ref,fastapi-ref}/scripts/openapi-governance.sh` |
| `python-contract-governance-template` | `templates/python-interface-monorepo` | Python contract governance toolkit | `packages/interface-contracts/tests/*.py`, `packages/interface-cli/tests/test_cli.py` |
| `governance-docs` | root | docs, CLI spec, and test-matrix drift guards | `scripts/check-api-index.ts`, `scripts/check-cli-spec.ts`, `scripts/check-feature-test-matrix.ts`, `docs/internal/feature-test-matrix.md` |

## Check

```bash
pnpm check:feature-tests
```

The check fails when:

- feature IDs are duplicated or malformed
- required fields are missing
- a listed concrete path does not exist
- a listed glob matches no files
- a feature has no test path or no command
