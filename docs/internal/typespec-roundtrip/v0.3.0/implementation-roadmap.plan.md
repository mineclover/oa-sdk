# TypeSpec Roundtrip v0.3.0 Implementation Roadmap

> Target package version: `@oa-sdk/codegen` `0.3.0`.
> Current package version: `@oa-sdk/codegen` `0.2.0`.

Status: in progress. Phase 0 through Phase 3, Phase 4 schema examples, and Phase 5 bearer/tag/header/accepted-unknown mapping are implemented; this document does not declare TSP-first.

## Goal

Turn the current TypeSpec export spike into a roundtrip readiness track for the next `@oa-sdk/codegen` minor version.

The `0.3.0` goal is:

- keep the canonical OA SDK OpenAPI artifact as the source of truth during implementation,
- reduce `OpenAPI -> TypeSpec -> OpenAPI` breaking diff to zero or to explicitly accepted differences,
- classify every remaining exporter diagnostic as contract-bearing, metadata-only, or intentionally externalized,
- produce enough evidence to decide whether a later release can declare TSP-first.

Non-goal for `0.3.0`: switching schema authoring to `.tsp` by default.

## Initial Baseline

Initial evidence from `pnpm typespec:roundtrip` before the `0.3.0` implementation phases:

| Signal | Current |
|---|---:|
| TypeSpec compile | pass |
| Emitted OpenAPI 3.2 validation | pass |
| Operations | 27 -> 27 |
| Component schemas | 28 -> 32 |
| Export diagnostics | 159 |
| Breaking diff | 16 |

Current gate state: `pnpm typespec:roundtrip -- --fail-on-breaking` passes because the emitted OpenAPI is semantically equivalent under OA SDK diff. Remaining work is diagnostic classification and mapping, not endpoint breaking diff.

## Release Shape

`@oa-sdk/codegen@0.3.0` should ship a stable evaluation workflow, not a default authoring migration.

Expected user-visible surface:

- `oa-gen tsp-export` remains the explicit conversion command.
- `pnpm typespec:roundtrip` remains the repository probe.
- A machine-readable roundtrip report is added before the gate is promoted.
- `--fail-on-breaking` becomes meaningful enough for CI use once accepted differences are encoded.

Expected docs:

- Existing implemented behavior remains in `docs/internal/spec.md`.
- Current evaluation summary remains in `docs/internal/typespec-roundtrip.plan.md`.
- This roadmap owns `0.3.0` implementation sequencing.
- If all gates pass, a later ADR may decide whether `.tsp` becomes a first-class authoring source.

## Phase 0 — Probe Hardening

Status: implemented.

Purpose: make the current roundtrip failure actionable before changing mappings.

Tasks:

- Add a JSON report option to `scripts/typespec-roundtrip.ts` containing:
  - source/emitted paths,
  - operation count,
  - schema count,
  - diagnostics grouped by code,
  - breaking/non-breaking diff counts,
  - changed operation ids and paths.
- Preserve the existing human-readable output.
- Add focused tests for the report shape.
- Add one short doc note explaining that `--fail-on-breaking` is a readiness gate, not the default probe.

Gate:

- `pnpm typespec:roundtrip` exits 0 and writes the report when requested.
- `pnpm typespec:roundtrip -- --fail-on-breaking` still fails until later phases close or accept differences.

Evidence:

- `pnpm typespec:roundtrip -- --report /tmp/oa-sdk-typespec-roundtrip-report.json` writes `oa-sdk.typespec-roundtrip-report.v1`.
- The report includes paths, source/emitted operation and schema counts, diagnostics grouped by code, breaking/non-breaking diff counts, and changed operation path/operationId summaries.
- `pnpm typespec:roundtrip -- --fail-on-breaking` still fails on the current 16 breaking differences.

## Phase 1 — Schema Metadata Preservation

Status: implemented.

Purpose: remove avoidable schema drift where TypeSpec can represent the same OpenAPI semantics.

Tasks:

- Emit property-level `description` as TypeSpec documentation.
- Emit schema/property `default` values with TypeSpec default syntax where values are valid TypeSpec values.
- Preserve `deprecated` with TypeSpec-supported deprecation syntax.
- Represent `additionalProperties: false` or record-sealing behavior with the least surprising TypeSpec/OpenAPI mapping.
- Keep unsupported schema keywords diagnostic-driven instead of silently dropping them.

Gate:

- Diagnostics for `schema/default-dropped` and property description loss are eliminated or reclassified.
- Request/response schema diff caused only by default/description loss is removed.

Evidence:

- `tsp-export` emits schema/property `@doc`, TypeSpec default initializers, `#deprecated "Deprecated"`, and `...Record<never>;` for `additionalProperties: false`.
- OA SDK diff treats TypeSpec OpenAPI 3.2 object sealing output, `unevaluatedProperties: { not: {} }`, as equivalent to `additionalProperties: false` only for plain object schemas.
- `pnpm typespec:roundtrip -- --report /tmp/oa-sdk-typespec-roundtrip-phase1-keep.json --keep` passes export, TypeSpec compile, and OA SDK OpenAPI 3.2 validation.
- Current report: operations `27 -> 27`, schemas `28 -> 32`, diagnostics `149`, breaking diff `13` across `7` modified operations.
- `schema/default-dropped`, `schema/deprecated-dropped`, and `schema/additional-properties-dropped` are absent from the report.
- Remaining breaking changes are pagination parameter schema equivalence and response body shape equivalence, so Phase 2 and Phase 3 own the next reductions.

## Phase 2 — Parameter Identity And Pagination

Status: implemented.

Purpose: stabilize reusable parameter semantics such as `Page` and `Limit`.

Tasks:

- Compare current emitted inline parameters against source `components.parameters`.
- Preserve default values and examples for query parameters where TypeSpec can emit them.
- Decide whether reusable parameter identity must roundtrip as `components.parameters` or whether inline parameters are accepted when schemas are equal.
- If inline output is accepted, update OA SDK diff classification to avoid treating equivalent parameter schema projection as breaking.

Gate:

- `page` and `limit` no longer show `parameter-schema-changed` unless their schema constraints truly changed.
- Any accepted inline-vs-component difference is recorded in the roundtrip report.

Evidence:

- OpenAPI `type: integer` without `format` now emits TypeSpec `integer`, not `int32`, so TypeSpec does not narrow reusable pagination parameters.
- `pnpm typespec:roundtrip -- --report /tmp/oa-sdk-typespec-roundtrip-phase2.json` reports zero `parameter-schema-changed` breaking changes.
- Reusable parameter identity does not need a special accepted-difference rule while the emitted inline parameter schema is equivalent under OA SDK diff. Parameter examples remain Phase 4 ownership.

## Phase 3 — Request And Response Shape Equivalence

Status: implemented.

Purpose: reduce body schema breaking changes without hiding real contract drift.

Tasks:

- Classify each current body diff by root cause:
  - component schema changed,
  - wrapper model changed,
  - optional body semantics changed,
  - example/default/additionalProperties changed,
  - TypeSpec emitter naming changed only.
- Adjust response model emission so `@statusCode` and `@body` preserve the original body shape.
- Adjust optional request body emission so source optionality is not strengthened or weakened.
- Avoid generating extra component schemas when a reusable source component can be referenced directly.

Gate:

- Current response/request breaking diff count is reduced to zero or all remaining body differences are explicitly accepted.
- Component schema count increase from 28 to 32 is explained by accepted generated models or eliminated.

Evidence:

- The same unformatted integer preservation removes response body schema drift for readiness/auth/list responses.
- `pnpm typespec:roundtrip -- --fail-on-breaking` passes with no endpoint changes detected.
- Component schemas remain `28 -> 32`; the four added schemas are accepted TypeSpec projection artifacts: `ErrorMeta`, `ListModerationReports200Body`, `ListMyRoleChanges200Body`, and `ListUsers200Body`.

## Phase 4 — Examples And Mock Semantics

Status: in progress. Schema-level examples are implemented; parameter and response media examples still need an ownership decision.

Purpose: decide which sample data belongs in TypeSpec and which remains OA SDK-owned runtime data.

Tasks:

- Map schema examples with TypeSpec `@example` where the value is assignable.
- Map operation/request/response examples with TypeSpec `@opExample` where possible.
- Preserve OA SDK OpenAPI 3.2 `dataValue` / `serializedValue` semantics or explicitly externalize them to an OA SDK sidecar.
- Keep mock-server response priority documented: examples/default/generateMinimal.

Gate:

- `response/examples-dropped`, `schema/examples-dropped`, and `parameter/examples-dropped` diagnostics are either removed or classified as accepted sidecar ownership.
- Mock-server example readiness is not weakened by TypeSpec export.

Evidence:

- Schema and property `example` / `examples` values now emit TypeSpec `@example(...)` where they can be represented as TypeSpec value literals.
- Example value emission is schema-aware for `utcDateTime.fromISO(...)`, `plainDate.fromISO(...)`, arrays, object properties, and local `$ref` traversal.
- `pnpm typespec:roundtrip -- --report /tmp/oa-sdk-typespec-roundtrip-phase4-schema-examples.json` reports diagnostics `126`, down from `149`, with no `schema/examples-dropped`.
- `parameter/examples-dropped` (`11`) and `response/examples-dropped` (`79`) remain because OA SDK OpenAPI 3.2 examples carry `dataValue` / `serializedValue`; TypeSpec's current projection can emit data or serialized parameter examples but not both, and response media examples would lose serialized mock semantics without a sidecar policy.

## Phase 5 — Security, Headers, Tags, And Visibility

Status: in progress. Bearer security, response headers, tag metadata, and the accepted `ValidationError.received` unknown policy are implemented; OAuth2 remains.

Purpose: close the remaining contract-bearing surfaces that TypeSpec can represent but the first exporter pass drops.

Tasks:

- Map bearer auth and compatible security schemes to TypeSpec auth declarations and `@useAuth`.
- Decide how to represent OAuth2/OIDC/mTLS if TypeSpec mapping is incomplete for OA SDK's current schema.
- Emit response headers with TypeSpec `@header` response properties.
- Preserve tag descriptions through TypeSpec-supported metadata or an OpenAPI extension/sidecar.
- Define a policy for `readOnly`, `writeOnly`, annotations, and visibility before emitting them.
- Treat `ValidationError.received` as the only accepted `unknown` escape hatch while keeping new untyped schemas diagnostic-driven.

Gate:

- No operation security requirements disappear without an accepted sidecar rule.
- Response header semantics remain visible to router/client/mock-server consumers.
- Visibility-sensitive fields do not move into TypeSpec until their read/write policy is explicit.

Evidence:

- OpenAPI tag descriptions now emit TypeSpec `@tagMetadata(...)`.
- Response headers now emit TypeSpec response model `@header(...)` properties, including header schema examples where supported.
- Bearer security schemes now emit TypeSpec `model bearerAuth is BearerAuth;`, and protected operations emit `@useAuth(bearerAuth)`.
- `ValidationError.received` now emits `unknown` without `schema/type-unknown`; any other untyped schema still emits `schema/type-unknown`.
- `pnpm typespec:roundtrip -- --report /tmp/oa-sdk-typespec-roundtrip-phase5-unknown.json` reports diagnostics `91`, down from `119`, with no `operation/security-dropped`, `response/headers-dropped`, `tags/metadata-dropped`, or `schema/type-unknown`.
- Remaining Phase 5 diagnostics are `components/security-scheme-dropped` (`1`) for the unused OAuth2 component.

## Phase 6 — Readiness Gate And Decision Prep

Purpose: make the release evidence clear enough to support or reject a later TSP-first decision.

Tasks:

- Run `pnpm typespec:roundtrip -- --fail-on-breaking`.
- Run downstream focused gates:
  - `pnpm --filter @oa-sdk/codegen test`,
  - `pnpm --filter @oa-sdk/codegen typecheck`,
  - `pnpm check:feature-tests`,
  - `pnpm check:cli-spec`,
  - `pnpm check:api-index`.
- Update `docs/internal/typespec-roundtrip.plan.md` with the final `0.3.0` evidence.
- Promote implemented surfaces to `docs/internal/spec.md`, `docs/internal/api-index.md`, and `docs/internal/feature-test-matrix.*`.
- Draft an ADR only if the evidence supports a stable authoring policy decision.

Gate:

- The release candidate has either:
  - zero breaking roundtrip diff, or
  - a machine-readable accepted-difference list with no unclassified contract-bearing gaps.

## Implementation Order

Recommended order:

1. Phase 0 report hardening.
2. Phase 1 default/description/deprecated/additionalProperties preservation.
3. Phase 2 pagination parameter equivalence.
4. Phase 3 request/response body equivalence.
5. Phase 4 examples and mock semantics.
6. Phase 5 security/header/tag/visibility policy.
7. Phase 6 gate and decision prep.

Do not start with diff normalization. Normalize only after a concrete TypeSpec/OpenAPI equivalence has been proven with source/emitted examples.

## Exit Criteria For `@oa-sdk/codegen@0.3.0`

The version is ready when:

- `pnpm typespec:roundtrip -- --fail-on-breaking` passes or all failures are accepted and machine-readable.
- Contract-bearing exporter diagnostics are zero.
- Metadata-only diagnostics are documented with owner and rationale.
- No TypeSpec-generated artifact becomes the canonical schema source yet.
- Follow-up decision points are clear enough for a TSP-first ADR.
