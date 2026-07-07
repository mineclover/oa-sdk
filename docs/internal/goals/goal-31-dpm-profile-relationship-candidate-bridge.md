# Goal 31 - DPM Profile Relationship Candidate Bridge

**Status: complete 2026-07-07**

> Predecessor: [Goal 30 - DPM Relationship Workflow Consumer Smoke](./goal-30-dpm-relationship-workflow-consumer-smoke.md)\
> Concept baseline: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)

## Purpose

Goal 30 proved that a product consumer can run the relationship workflow from OpenAPI discovery through
candidate import, approval, registry export, and manifest compile.

Goal 31 closes the next handoff gap: profile/Kafka analysis relationship hints can now be converted into
relationship candidate import inputs when a reviewer or product surface supplies the parent/child endpoint
mapping. This keeps profile analysis review-only while giving editors and automation a deterministic bridge
into the relationship review workflow.

## Scope Boundary

| In scope | Out of scope |
|---|---|
| public helper from profile relationship hint proposal to `RelationshipCandidateInput` | automatic endpoint inference |
| reviewer-supplied parent/child endpoint mapping | automatic approval or registry writes |
| profile provenance preserved in candidate evidence metadata | compile-ready relationship guarantee without manifest/catalog/registry validation |
| import runtime smoke proving non-executable review report handoff | live Kafka/DB access |
| API index, feature matrix, spec, and progress updates | vault/reverse token lookup |

## Implementation Units

### DPM-51 - Profile Relationship Candidate Bridge

Status: implemented 2026-07-07.

Artifacts:
- `packages/dpm/src/profile/analysis-relationship-candidate.ts`
- `packages/dpm/src/public/profile-analysis.ts`
- `packages/dpm/test/profile-analysis-relationship-candidate-bridge.test.ts`
- `packages/dpm/examples/profile-kafka/run-demo.mjs`
- `packages/dpm/examples/profile-kafka/README.md`
- `packages/dpm/test/profile-demo-command.test.ts`
- `packages/dpm/test/package-subpath-import-smoke.mjs`
- `packages/dpm/test/package-subpath-type-consumer.ts`
- `docs/internal/api-index.md`
- `docs/internal/feature-test-matrix.json`
- `docs/internal/feature-test-matrix.md`
- `docs/internal/spec.md`

Acceptance:
- Profile relationship hints remain review-only and do not become registry relationships automatically.
- Consumers must provide relationship name and parent/child endpoints before a relationship candidate input is created.
- Candidate evidence uses existing `service_code_hint` discovery evidence taxonomy and preserves profile provenance in metadata.
- Missing source nodes are rejected before candidate import.
- The generated candidate can be imported through `importDpmRelationshipCandidates` into a non-executable review report.
- Public package profile subpath exposes the helper and type to built consumers.

Verification:
- `pnpm --filter @oa-sdk/dpm exec vitest run test/profile-analysis-relationship-candidate-bridge.test.ts test/profile-analysis-relationship-hints.test.ts`
- `pnpm --filter @oa-sdk/dpm test -- profile-analysis`
- `pnpm --filter @oa-sdk/dpm test -- profile-demo`
- `pnpm --filter @oa-sdk/dpm typecheck`
- `pnpm --filter @oa-sdk/dpm run demo:profile`
- `pnpm build:scripts && pnpm check:api-index && pnpm check:feature-tests`
- `pnpm check:dpm-surface`
- `pnpm check:release-policy`
- `git diff --check`

## Done Criteria

- Kafka/profile analysis relationship proposals have a deterministic, explicit-mapping bridge into relationship candidate import.
- The bridge preserves the DPM rule that profile analysis cannot approve or execute relationships by itself.
- API/spec docs, feature-test matrix, package surface smoke, and progress index match the implemented behavior.
