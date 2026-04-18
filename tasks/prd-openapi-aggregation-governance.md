[PRD]
# PRD: OpenAPI Aggregation Governance Completion

## Overview

Complete the remaining planned OpenAPI aggregation governance capabilities in `docs/internal/openapi-aggregation-governance.plan.md`. The work finishes duplicate review reporting, target coverage gating, review bundle aggregation, and source adapter formalization while preserving the existing document lifecycle rule: only implemented and verified behavior may be promoted into `docs/internal/spec.md`, `docs/internal/api-index.md`, and `docs/internal/feature-test-matrix.json`.

## Goals

- Add human-reviewable duplicate detection for Definition Builder fragments without auto-merging definitions.
- Add target coverage gates that can assert required and forbidden path surface against generated artifacts or target configs.
- Add a review bundle command that combines existing governance reports without flattening away each report's structure.
- Formalize a shared source fragment model and adapters for the planned input classes.
- Keep CLI governance manifests, docs, and feature ownership in sync with implementation.

## Quality Gates

These commands must pass for every user story:
- `pnpm --filter @oa-sdk/codegen build` - Build the codegen package and CLI dist entrypoints
- `pnpm --filter @oa-sdk/codegen typecheck` - Type-check codegen package changes
- `pnpm --filter @oa-sdk/codegen test` - Run codegen package tests
- `pnpm check:cli-spec` - Validate CLI governance manifests and TS implementation drift
- `pnpm check:feature-tests` - Validate feature-test ownership metadata
- `pnpm check:api-index` - Validate API index against package exports
- `git diff --check` - Reject whitespace errors

No UI stories are included; browser verification is not required.

## User Stories

### US-001: Build Duplicate Review Analyzer
**Description:** As a maintainer, I want a reusable duplicate review analyzer for Definition Builder fragments so that duplicate candidates can be reported without changing emitted OpenAPI output.

**Acceptance Criteria:**
- [ ] Add a reusable duplicate review analyzer under `packages/codegen/src/cli/lib/` or an existing equivalent governance lib boundary.
- [ ] Analyzer reads Definition Builder fragments from a fragments directory using existing fragment parsing conventions where possible.
- [ ] Analyzer reports duplicate canonical ids with all source paths and canonical ids involved.
- [ ] Analyzer reports same content hash with different canonical ids.
- [ ] Analyzer reports same local name with different shapes.
- [ ] Analyzer reports output name collision candidates using the same target-local naming concepts already used by build-spec where target context is available.
- [ ] Analyzer reports explicit `metadata.semanticAliasOf` pairs.
- [ ] Analyzer never mutates fragments and never auto-merges definitions.

### US-002: Add `oa-gen duplicate-review` CLI
**Description:** As a maintainer, I want `oa-gen duplicate-review` to emit markdown and JSON duplicate review reports so that PR reviewers can inspect source identity risks quickly.

**Acceptance Criteria:**
- [ ] Add `oa-gen duplicate-review --fragments <dir> --format markdown|json`.
- [ ] Default format is markdown and is compact enough for PR comments.
- [ ] JSON output is stable, machine-readable, and includes source path and canonical id for every entry.
- [ ] Intentional semantic aliases suppress only the intended duplicate warning.
- [ ] CLI exits zero when only informational duplicate candidates are present and non-zero only for configured error-level findings such as duplicate canonical ids.
- [ ] Add CLI governance manifest entries in `packages/codegen/src/cli/spec/oa-gen-governance.ts` and `docs/cli-spec/oa-gen.governance.json`.
- [ ] Add focused tests for analyzer output, CLI JSON, CLI markdown, semantic alias suppression, and duplicate id failure.
- [ ] Promote only the implemented duplicate-review behavior to `docs/internal/spec.md`, `docs/internal/api-index.md`, and `docs/internal/feature-test-matrix.json`.

### US-003: Build Target Coverage Gate Core
**Description:** As a maintainer, I want a reusable target coverage checker so that required and forbidden API paths can be validated against a generated artifact or a Definition Builder target config.

**Acceptance Criteria:**
- [ ] Add a target coverage checker under `packages/codegen/src/cli/lib/` or an equivalent governance lib boundary.
- [ ] Checker can read plain generated OpenAPI YAML/JSON artifacts.
- [ ] Checker can read a Definition Builder target config by building the target through the existing target loader path.
- [ ] Checker supports `mustIncludePath` assertions.
- [ ] Checker supports `mustExcludePath` assertions.
- [ ] Missing required paths produce stable machine-readable failures.
- [ ] Forbidden emitted paths produce stable machine-readable failures.
- [ ] Existing build-spec target behavior is not changed by the checker.

### US-004: Add `oa-gen target-check` CLI
**Description:** As a maintainer, I want `oa-gen target-check` to fail CI when a target artifact includes or omits the wrong path surface.

**Acceptance Criteria:**
- [ ] Add `oa-gen target-check --target <target.yaml> --must-include-path <path> --must-exclude-path <path>` support.
- [ ] Add an artifact input mode for generated OpenAPI documents if the final CLI design needs a distinct `--artifact` or `--spec` option.
- [ ] Multiple include and exclude assertions are supported deterministically.
- [ ] Missing required paths fail with non-zero exit.
- [ ] Forbidden paths fail with non-zero exit.
- [ ] JSON and human/markdown output include every assertion and result.
- [ ] Add CLI governance manifest entries in both TS and docs manifests.
- [ ] Add tests for passing public target checks, missing required path failures, forbidden path failures, and generated artifact mode.
- [ ] Promote only implemented target-check behavior to internal docs and feature-test matrix.

### US-005: Build Review Bundle Aggregator
**Description:** As a maintainer, I want a review bundle aggregator that combines existing governance report payloads so that PR review output is complete but each section remains independently inspectable.

**Acceptance Criteria:**
- [ ] Add a review bundle data model with `schemaVersion` and a recommendation-first summary.
- [ ] Bundle includes breaking diff before non-breaking changes.
- [ ] Bundle includes artifact freshness as a separate section.
- [ ] Bundle can include runtime drift as a separate section.
- [ ] Bundle can include inventory report data as a separate section.
- [ ] Bundle can include composition report data as a separate section.
- [ ] Bundle can include duplicate review data as a separate section.
- [ ] JSON output preserves each underlying report object without flattening away important detail.
- [ ] Aggregator reuses existing report helpers where possible instead of duplicating diff, inventory, or drift logic.

### US-006: Add `oa-gen review-bundle` CLI
**Description:** As a maintainer, I want `oa-gen review-bundle` to emit a single markdown or JSON report for PR review workflows.

**Acceptance Criteria:**
- [ ] Add `oa-gen review-bundle --base <file> --head <file> --artifact <file> --format markdown|json`.
- [ ] Add optional flags for inventory, composition report, runtime drift input, and duplicate review input according to the implemented aggregator model.
- [ ] Markdown output starts with the recommendation and summary.
- [ ] Markdown output keeps breaking changes before non-breaking changes.
- [ ] Artifact freshness, runtime drift, inventory, composition, and duplicate review appear as separate sections when provided.
- [ ] JSON output preserves nested reports with stable property names.
- [ ] CLI governance manifests include the command and options.
- [ ] Add tests for clean bundle approval, breaking change request-changes, incomplete optional sections, and JSON nesting.
- [ ] Promote only implemented review-bundle behavior to internal docs and feature-test matrix.

### US-007: Define Source Fragment Model And Diagnostics
**Description:** As a maintainer, I want a formal source fragment model so that multiple OpenAPI/JSON Schema-compatible inputs can feed inventory, Definition Builder, or future provenance workflows consistently.

**Acceptance Criteria:**
- [ ] Add a shared `OpenApiSourceFragment` type in an appropriate package boundary without breaking existing public exports.
- [ ] Model includes `id`, `kind`, optional `sourcePath`, optional `sourcePointer`, `contentHash`, `content`, and optional `metadata`.
- [ ] Add source adapter diagnostic types that include source path and pointer.
- [ ] Add deterministic content hashing helpers or reuse existing hashing helpers through a stable API.
- [ ] Add tests for deterministic ids, deterministic content hashes, and source diagnostics.
- [ ] Document the model in `docs/internal/api-index.md` only if it is exported as public API.

### US-008: Add File-Based Source Adapters
**Description:** As a maintainer, I want adapters for Definition Builder fragments, raw OpenAPI fragments, and standalone JSON Schema files so that file-based source inputs can become normalized source fragments.

**Acceptance Criteria:**
- [ ] Add an adapter for Definition Builder fragment files.
- [ ] Add an adapter for raw OpenAPI fragment files.
- [ ] Add an adapter for standalone JSON Schema files.
- [ ] Each adapter produces deterministic fragment ids and content hashes.
- [ ] Each adapter preserves source path and JSON pointer diagnostics.
- [ ] Adapter output can feed existing Definition Builder or inventory code paths where applicable.
- [ ] Existing build-spec, inventory, typegen, and validate behavior remains backward compatible.
- [ ] Add tests covering YAML and JSON inputs.

### US-009: Formalize Projection And Codegen Source Adapter Boundaries
**Description:** As a maintainer, I want adapter boundaries for Zod, Drizzle, OpenAPI Projection envelopes, and Python `ContractSpec` snapshots so that cross-language inputs share one governance vocabulary.

**Acceptance Criteria:**
- [ ] Document or implement adapter boundaries for Zod schemas.
- [ ] Document or implement adapter boundaries for Drizzle table schemas.
- [ ] Document or implement adapter boundaries for OpenAPI Projection envelopes.
- [ ] Document or implement adapter boundaries for Python `ContractSpec` snapshots.
- [ ] Existing Zod/Drizzle/codegen behavior remains backward compatible.
- [ ] Projection envelope metadata is preserved where present.
- [ ] Python snapshot handling is source-agnostic and does not introduce Python runtime dependencies into TS packages.
- [ ] Add tests or documented fixtures showing each planned input class maps to normalized fragment concepts.

### US-010: Finalize Governance Plan Lifecycle
**Description:** As a maintainer, I want the planned document lifecycle closed correctly so that implemented behavior is represented in the internal SSOT and no completed planned items remain in the plan file.

**Acceptance Criteria:**
- [ ] Every implemented capability from this PRD is represented in `docs/internal/spec.md`.
- [ ] New public API or CLI surface is represented in `docs/internal/api-index.md`.
- [ ] `docs/internal/feature-test-matrix.json` includes feature ownership and test paths for every new capability.
- [ ] `docs/internal/feature-test-matrix.md` human summary is consistent with the JSON matrix.
- [ ] `docs/internal/openapi-aggregation-governance.plan.md` contains only unimplemented remaining work.
- [ ] If all planned phases are implemented and represented in `spec.md`, remove the plan file according to its promotion rule.

## Functional Requirements

- FR-1: Duplicate review must report duplicates without mutating or auto-merging source definitions.
- FR-2: Target coverage checks must support include and exclude path assertions.
- FR-3: Target coverage checks must work against generated OpenAPI artifacts and Definition Builder target configs.
- FR-4: Review bundle must keep underlying report structures intact in JSON output.
- FR-5: Review bundle markdown must place recommendation and breaking changes before lower-priority details.
- FR-6: Source fragments must have deterministic ids and content hashes.
- FR-7: Adapter diagnostics must include source path and source pointer where available.
- FR-8: Implemented features must update CLI governance manifests, tests, and internal SSOT docs.
- FR-9: Existing completed behavior for inventory, composition report, provenance, runtime URL drift, build-spec, review, check-artifact, diff, validate, and typegen must remain backward compatible.

## Non-Goals

- Do not replace `.merged.yaml` ownership with Definition Builder output.
- Do not auto-merge duplicate definitions.
- Do not introduce Python runtime dependencies into TS package implementations.
- Do not add UI or browser-facing workflows.
- Do not promote unimplemented planned behavior into `spec.md`.
- Do not remove the plan file until all planned capabilities are implemented and represented in `spec.md`.

## Technical Considerations

- Follow existing CLI command layout under `packages/codegen/src/cli/commands/`.
- Put reusable report/check logic under `packages/codegen/src/cli/lib/` unless a parser package boundary is clearly better.
- Keep `docs/cli-spec/oa-gen.governance.json` mirrored with `packages/codegen/src/cli/spec/oa-gen-governance.ts`.
- Reuse existing helpers such as `loadSpecWithPath`, `loadOpenApiOrTarget`, `buildSpec`, inventory report helpers, normalized diff helpers, and provenance/composition report shapes where possible.
- Use deterministic sorting for machine-readable JSON outputs.
- Use document lifecycle rules from `docs/internal/README.md` and the promotion rules in `docs/internal/openapi-aggregation-governance.plan.md`.

## Success Metrics

- All four remaining plan phases are implemented or the plan accurately contains only unimplemented residue.
- Every new CLI command appears in help output and the CLI governance manifest drift check passes.
- Every new feature has focused tests and feature-test matrix ownership.
- Review-facing markdown reports are compact and suitable for PR comments.
- JSON reports are stable and nested enough for future automation.

## Open Questions

- Should duplicate review severity be configurable, or should duplicate canonical id be the only default non-zero failure?
- Should `target-check` use `--artifact`, `--spec`, or both for generated OpenAPI input mode?
- Should `review-bundle` be a new command only, or should it eventually replace/extend `oa-gen review`?
- Which source adapter types should be public exports versus internal implementation details?
[/PRD]
