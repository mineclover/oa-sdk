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

## Baseline Evidence

Current probe on `packages/schemas/src/.merged.yaml`:

| Check | Result |
|---|---|
| TypeSpec compiler | pass |
| OpenAPI emitter | pass |
| OA SDK OpenAPI 3.2 validation | pass, 0 warnings, 0 infos |
| Operations | 27 -> 27 |
| Component schemas | 28 -> 32 |
| Generated `.tsp` size | 1049 lines |
| Export diagnostics | 159 |
| Breaking diff | 16 breaking changes across 10 modified operations |

Diagnostic distribution:

| Code | Count | Meaning |
|---|---:|---|
| `response/examples-dropped` | 79 | Response media examples are not mapped yet |
| `operation/security-dropped` | 27 | Operation security requirements need a TypeSpec auth convention |
| `schema/examples-dropped` | 23 | Schema examples are not mapped yet |
| `parameter/examples-dropped` | 11 | Parameter examples are not mapped yet |
| `schema/default-dropped` | 10 | Schema defaults are not mapped yet |
| `response/headers-dropped` | 6 | Response headers are not emitted into TypeSpec response models yet |
| `schema/type-unknown` | 1 | Source schema lacks enough type information for precise TypeSpec |
| `components/security-schemes-dropped` | 1 | Shared security schemes are not mapped yet |
| `tags/metadata-dropped` | 1 | Tag descriptions are not mapped yet |

Current breaking categories:

- Query parameter schema drift for shared pagination parameters (`page`, `limit`).
- Response body schema drift for list/readiness/auth responses.
- Request body schema drift for optional body operations and purge/export requests.
- Generated inline TypeSpec response/request models increase component schema count.

## Intersection

The first exporter pass shows a useful intersection:

- OpenAPI servers, title, version, operationId, route, HTTP method, tags.
- Path/query/header/cookie parameter locations.
- Request bodies and response status/body models.
- Component schema references, object models, required vs optional properties.
- Primitive types, arrays, enums, const, nullable unions, `allOf` intersections, `oneOf`/`anyOf` unions.
- String formats including `date-time` and `date`.
- Basic scalar constraints: format, min/max length, numeric min/max, pattern.

This is enough to keep path and operation identity stable, but not enough to claim semantic roundtrip.

## Difference Backlog

Before a TSP-first declaration, close or explicitly accept these gaps:

1. Response and request schema equivalence: avoid TypeSpec-emitted inline model churn where it changes OA SDK diff semantics.
2. Pagination parameters: preserve reusable parameter schema constraints and names without weakening `Page`/`Limit`.
3. Security: map `components.securitySchemes` and root/operation security requirements to a stable TypeSpec auth convention.
4. Examples/defaults: decide which examples/defaults are authoring data, mock-server semantics, or documentation metadata, then map or explicitly externalize them.
5. Response headers: emit response header properties so router/client/mock-server header semantics remain visible.
6. Tag metadata: preserve tag descriptions or define a sidecar if TypeSpec projection is not the owner.
7. Untyped schema cleanup: fix `ValidationError.received` or define a deliberate `unknown` escape hatch.
8. Visibility and annotations: map readOnly/writeOnly/deprecated/annotations only after the OA SDK visibility policy is explicit.
9. Diff normalization: teach OA SDK review tooling which TypeSpec-emitted shapes are semantically equivalent, rather than suppressing real contract changes.

## Declaration Criteria

Declare TSP-first only when:

- `pnpm typespec:roundtrip -- --fail-on-breaking` passes for the canonical schema artifact.
- All exporter diagnostics are either zero for contract-bearing surfaces or categorized as accepted metadata loss.
- The authoring guide says which facts belong in `.tsp`, which remain OpenAPI sidecars/extensions, and which remain OA SDK runtime data.
- The generated OpenAPI remains valid under OA SDK's OpenAPI 3.2 gate and downstream codegen/router/client/mock-server tests.
