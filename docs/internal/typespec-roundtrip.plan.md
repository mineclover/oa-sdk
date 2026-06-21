# TypeSpec Roundtrip Evaluation Plan

> Goal: decide whether the current OA SDK OpenAPI declaration can move to a TypeSpec-first authoring model without losing the contract semantics that OA SDK already uses.

Status: evaluation, not an ADR and not yet a TSP-first decision.

Versioned implementation planning lives under [`typespec-roundtrip/`](./typespec-roundtrip/). The next target is [`@oa-sdk/codegen` `0.3.0`](./typespec-roundtrip/v0.3.0/implementation-roadmap.plan.md), following the current `@oa-sdk/codegen` `0.2.0` package version.

## Current Surfaces

Implemented source:

- `packages/codegen/src/cli/lib/tsp-export.ts` — OpenAPI artifact to TypeSpec source exporter and diagnostics report.
- `packages/codegen/src/cli/commands/tsp-export.ts` — `oa-gen tsp-export --spec <openapi.yaml> --output <main.tsp> --report <report.json>`.
- `scripts/typespec-roundtrip.ts` — reproducible probe for export, TypeSpec compile, emitted OpenAPI validation, and OpenAPI diff.
- `packages/codegen/src/__tests__/tsp-export.test.ts` — focused exporter coverage.
- `packages/codegen/src/__tests__/openapi-breaking-diff.test.ts` — proven TypeSpec/OpenAPI shape equivalence coverage.

Toolchain:

- TypeSpec packages are pinned through root devDependencies at `^1.13.0`: `@typespec/compiler`, `@typespec/http`, `@typespec/openapi`, and `@typespec/openapi3`.
- The OpenAPI emitter is configured for OpenAPI `3.2.0`.
- Reference: TypeSpec OpenAPI emitter usage and options are documented at <https://typespec.io/docs/emitters/openapi3/reference/emitter/>.

## Roundtrip Loop

The evaluation loop must preserve both specs instead of forcing one vocabulary to pretend it is the other:

1. Start from the current OA SDK OpenAPI artifact: `packages/schemas/src/.merged.yaml`.
2. Export candidate TypeSpec source with `oa-gen tsp-export`.
3. Compile the `.tsp` project through `@typespec/openapi3` with OpenAPI `3.2.0`.
4. Validate the emitted OpenAPI with OA SDK's own `validateDocument(..., requireOpenApi32: true)`.
5. Diff original OpenAPI against emitted OpenAPI with OA SDK's breaking diff.
6. Classify every difference as one of:
   - TypeSpec can express it and the exporter is missing the mapping.
   - TypeSpec can express it, but OA SDK needs an authoring convention.
   - TypeSpec emits a different but acceptable OpenAPI shape.
   - OA SDK intentionally owns semantics outside TypeSpec's OpenAPI projection.

Run:

```bash
pnpm typespec:roundtrip
pnpm typespec:roundtrip -- --report artifacts/typespec-roundtrip-report.json
pnpm typespec:roundtrip -- --keep
pnpm typespec:roundtrip -- --fail-on-breaking
```

The default probe is a visibility command: it exits 0 when export, TypeSpec compile, and OA SDK validation pass, even if semantic diff remains. `--fail-on-breaking` is the readiness gate. It is expected to fail until the remaining semantic differences are either removed or explicitly accepted.

## Current Evidence

Current probe on `packages/schemas/src/.merged.yaml`:

| Check | Result |
|---|---|
| TypeSpec compiler | pass |
| OpenAPI emitter | pass |
| OA SDK OpenAPI 3.2 validation | pass, 0 warnings, 0 infos |
| Operations | 27 -> 27 |
| Component schemas | 28 -> 32 |
| Generated `.tsp` size | 1067 lines |
| Export diagnostics | 91 |
| Breaking diff | 0 breaking changes across 0 modified operations |

Diagnostic distribution:

| Code | Count | Meaning |
|---|---:|---|
| `response/examples-dropped` | 79 | Response media examples are not mapped yet |
| `parameter/examples-dropped` | 11 | Parameter examples are not mapped yet |
| `components/security-scheme-dropped` | 1 | Unused OAuth2 security scheme is not mapped yet |

Current endpoint diff:

- No endpoint changes are detected by OA SDK diff.
- Component schemas remain `28 -> 32`; the four additional schemas are accepted TypeSpec projection artifacts: `ErrorMeta`, `ListModerationReports200Body`, `ListMyRoleChanges200Body`, and `ListUsers200Body`.
- Remaining readiness work is diagnostic ownership, not breaking endpoint drift.

## Intersection

The first exporter pass shows a useful intersection:

- OpenAPI servers, title, version, operationId, route, HTTP method, tags.
- Path/query/header/cookie parameter locations.
- Request bodies and response status/body models.
- Component schema references, object models, required vs optional properties.
- Primitive types, arrays, enums, const, nullable unions, `allOf` intersections, `oneOf`/`anyOf` unions.
- Unformatted OpenAPI `integer` values without accidental `int32` narrowing.
- String formats including `date-time` and `date`.
- Basic scalar constraints: format, min/max length, numeric min/max, pattern.
- Schema and property documentation, JSON-compatible default values, deprecated markers, schema/property examples, and strict-object sealing via TypeSpec `...Record<never>;`.

This is enough to keep path and operation identity stable, but not enough to claim semantic roundtrip.

## Difference Backlog

Before a TSP-first declaration, close or explicitly accept these gaps:

1. OAuth2 component policy: map the unused OAuth2 security scheme or classify it as OpenAPI-side metadata for this fixture.
2. Parameter and response media examples: decide how OA SDK `dataValue` / `serializedValue` examples are preserved without weakening mock-server response priority.
3. Untyped schema policy: `ValidationError.received` is the only accepted `unknown` escape hatch; any new untyped schema still emits `schema/type-unknown`.
4. Visibility and annotations: map readOnly/writeOnly/annotations only after the OA SDK visibility policy is explicit.
5. Component projection policy: keep the accepted extra TypeSpec schemas visible in the roundtrip report or eliminate them if they become confusing for release review.
6. Diff normalization: continue teaching OA SDK review tooling only proven TypeSpec-emitted shapes that are semantically equivalent, without suppressing real contract changes.

## Declaration Criteria

Declare TSP-first only when:

- `pnpm typespec:roundtrip -- --fail-on-breaking` passes for the canonical schema artifact.
- All exporter diagnostics are either zero for contract-bearing surfaces or categorized as accepted metadata loss.
- The authoring guide says which facts belong in `.tsp`, which remain OpenAPI sidecars/extensions, and which remain OA SDK runtime data.
- The generated OpenAPI remains valid under OA SDK's OpenAPI 3.2 gate and downstream codegen/router/client/mock-server tests.
