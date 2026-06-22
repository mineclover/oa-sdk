# TypeSpec Roundtrip Evaluation Plan

> Goal: decide whether the current OA SDK OpenAPI declaration can move to a TypeSpec-first authoring model without losing the contract semantics that OA SDK already uses.

Status: evaluation complete. ADR-009 accepts TypeSpec-first schema authoring with a staged production migration.

Versioned implementation planning lives under [`typespec-roundtrip/`](./typespec-roundtrip/). The sidecar-less authored TypeSpec extension vocabulary is standardized in [`typespec-roundtrip/oa-sdk-typespec-extensions.v1.md`](./typespec-roundtrip/oa-sdk-typespec-extensions.v1.md). The completed TypeSpec-first decision design is tracked in [`typespec-roundtrip/tsp-first-decision-design.md`](./typespec-roundtrip/tsp-first-decision-design.md). The staged production migration goals G9-G12 are tracked in [`typespec-roundtrip/production-migration-goals.md`](./typespec-roundtrip/production-migration-goals.md). The next target is [`@oa-sdk/codegen` `0.3.0`](./typespec-roundtrip/v0.3.0/implementation-roadmap.plan.md), following the current `@oa-sdk/codegen` `0.2.0` package version.

## Current Surfaces

Implemented source:

- `packages/codegen/src/cli/lib/tsp-export.ts` — OpenAPI artifact to TypeSpec source exporter and diagnostics report.
- `packages/codegen/src/cli/lib/typespec-bundle-manifest.ts` — `oa-sdk.typespec-bundle.v1` manifest creation, parsing, and bundle-local path resolution.
- `packages/codegen/src/cli/lib/typespec-bundle-check.ts` — shared bundle manifest compile, sidecar restore/re-extract, validation, and expected diff gate.
- `packages/codegen/src/cli/lib/typespec-oa-sdk-extensions.ts` — sidecar-equivalent OA SDK TypeSpec extension metadata extraction from emitted OpenAPI.
- `packages/codegen/src/cli/lib/typespec-sidecar-to-extensions.ts` — migration helper that converts supported sidecar entries into TypeSpec `@extension(...)` snippets and leaves unsupported entries in a residual sidecar.
- `packages/codegen/src/cli/lib/typespec-sidecar.ts` — OA SDK-owned TypeSpec compatibility sidecar creation, restore, and semantic stability comparison.
- `packages/codegen/src/cli/lib/typespec-roundtrip-report.ts` — roundtrip report assembly, diagnostic ownership classification, and readiness gates.
- `packages/codegen/src/cli/commands/tsp-export.ts` — `oa-gen tsp-export --spec <openapi.yaml> --output <main.tsp> --report <report.json> --sidecar <sidecar.json> --bundle-manifest <manifest.json>`.
- `packages/codegen/src/cli/commands/tsp-restore.ts` — `oa-gen tsp-restore --spec <emitted.yaml> --sidecar <sidecar.json> --output <restored.yaml> --stability-report <stability.json>`.
- `packages/codegen/src/cli/commands/tsp-bundle-check.ts` — `oa-gen tsp-bundle-check --manifest <manifest.json> --fail-on-breaking --report <report.json>`.
- `scripts/typespec-roundtrip.ts` — reproducible probe for export, TypeSpec compile, emitted OpenAPI validation, and OpenAPI diff.
- `scripts/typespec-bundle-check.ts` — repository wrapper around the shared `oa-gen tsp-bundle-check` implementation.
- `scripts/typespec-sidecar-to-extensions.ts` — repository wrapper for the sidecar-to-extension migration helper.
- `scripts/typespec-create-authored-canonical-fixture.ts` — reproducible canonical authored fixture regeneration from the production merged OpenAPI schema.
- `scripts/schema-typespec-check.ts` — G10 schema-level TypeSpec gate for the production bundle, current `.merged.yaml` freshness diff, and accepted restored drift hash manifest.
- `scripts/schema-rollback-check.ts` — G11 rollback gate that proves the TypeSpec candidate and existing OpenAPI/Definition Builder path stay green together.
- `scripts/schema-typespec-downstream-check.ts` — G12 downstream gate that imports built package exports, runs parser, codegen, router, client, and mock-server against the TypeSpec-derived production artifact, and compiles generated TypeScript consumers plus a synthetic webhook/header fixture.
- `packages/schemas/typespec/` — G9 production-owned TypeSpec source layout candidate for the staged migration.
- `packages/schemas/typespec/accepted-restored-drift.json` — G10 accepted TypeSpec-restored-vs-production drift manifest with normalized value hashes.
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v1.md` — `oa-sdk.typespec-extensions.v1` vocabulary for sidecar-less authored TypeSpec bundles.
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v2.md` — `oa-sdk.typespec-extensions.v2` request body examples vocabulary.
- `docs/internal/typespec-roundtrip/authoring-ownership-guide.md` — maintainer-facing source-of-truth ownership map for TypeSpec-native syntax, OA SDK TypeSpec extensions, compatibility sidecars, and runtime data.
- `docs/internal/typespec-roundtrip/sidecar-to-extension-migration.md` — G6 workflow for moving supported sidecar entries into TypeSpec extension metadata.
- `docs/internal/typespec-roundtrip/production-migration-goals.md` — G9-G12 roadmap for wiring the accepted TypeSpec bundle into the production schema build path.
- `docs/internal/architecture/009-typespec-first-authoring.md` — accepted TypeSpec-first authoring ADR with staged production migration and rollback rules.
- `docs/internal/typespec-roundtrip/fixtures/authored-bundle/` — minimal authored bundle fixture proving the two-track input shape with `oa-sdk.typespec-bundle.v1`.
- `docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/` — minimal sidecar-less authored bundle fixture proving OA SDK semantics can live in `.tsp` through TypeSpec OpenAPI extensions.
- `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/` — representative sidecar-less authored bundle fixture covering canonical users operations, pagination, request bodies, shared errors, union/composed schema shape, security requirements, and restored OA SDK extension metadata.
- `docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/` — full canonical sidecar-less authored bundle fixture scaffolded from the canonical export and backed by `oa-sdk.typespec-extensions.v2`.
- `packages/codegen/src/__tests__/tsp-export.test.ts` — focused exporter coverage.
- `packages/codegen/src/__tests__/typespec-sidecar.test.ts` — compatibility sidecar creation/restore coverage.
- `packages/codegen/src/__tests__/typespec-sidecar-to-extensions.test.ts` — sidecar-to-extension migration coverage.
- `packages/codegen/src/__tests__/typespec-authored-bundle.test.ts` — authored `.tsp + sidecar` compile/restore fixture coverage.
- `packages/codegen/src/__tests__/openapi-breaking-diff.test.ts` — proven TypeSpec/OpenAPI shape equivalence coverage.
- `packages/codegen/src/__tests__/typespec-roundtrip-report.test.ts` — machine-readable report and diagnostic policy coverage.

Toolchain:

- TypeSpec packages are pinned through root devDependencies at `^1.13.0`: `@typespec/compiler`, `@typespec/http`, `@typespec/openapi`, and `@typespec/openapi3`.
- The OpenAPI emitter is configured for OpenAPI `3.2.0`.
- Reference: TypeSpec OpenAPI emitter usage and options are documented at <https://typespec.io/docs/emitters/openapi3/reference/emitter/>.

## Roundtrip Loop

The evaluation loop must preserve both specs instead of forcing one vocabulary to pretend it is the other:

1. Start from the current OA SDK OpenAPI artifact: `packages/schemas/src/.merged.yaml`.
2. Export candidate TypeSpec source with `oa-gen tsp-export`.
3. Write an OA SDK compatibility sidecar for OpenAPI-owned metadata that TypeSpec should not pretend to own.
4. Compile the `.tsp` project through `@typespec/openapi3` with OpenAPI `3.2.0`.
5. Restore sidecar metadata onto the emitted OpenAPI.
6. Re-extract the sidecar from the restored OpenAPI and compare it against the authored/generated sidecar by semantic target and value.
7. Validate both emitted and restored OpenAPI with OA SDK's own `validateDocument(..., requireOpenApi32: true)`.
8. Diff original OpenAPI against emitted/restored OpenAPI with OA SDK's breaking diff.
9. Classify every difference as one of:
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
oa-gen tsp-export --spec packages/schemas/src/.merged.yaml --output artifacts/main.tsp --sidecar artifacts/typespec-sidecar.json --bundle-manifest artifacts/oa-sdk.typespec-bundle.json --bundle-expected-openapi artifacts/expected.openapi.yaml
oa-gen tsp-restore --spec artifacts/typespec-emitted.yaml --sidecar artifacts/typespec-sidecar.json --output artifacts/typespec-restored.yaml --stability-report artifacts/typespec-sidecar-stability.json
oa-gen tsp-bundle-check --manifest artifacts/oa-sdk.typespec-bundle.json --fail-on-breaking --report artifacts/typespec-generated-bundle-check-report.json
pnpm typespec:bundle-check
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-bundle/oa-sdk.typespec-bundle.json
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
pnpm typespec:bundle-check -- --manifest artifacts/oa-sdk.typespec-bundle.json --fail-on-breaking --report artifacts/typespec-generated-bundle-check-report.json
pnpm typespec:bundle-check -- --fail-on-breaking --report artifacts/typespec-bundle-check-report.json
pnpm typespec:sidecar-to-extensions -- --sidecar artifacts/typespec-sidecar.json --output artifacts/typespec-extension-snippets.tsp --remaining-sidecar artifacts/typespec-sidecar.remaining.json --report artifacts/typespec-sidecar-to-extensions-report.json
pnpm typespec:create-canonical-fixture
pnpm schema:typespec-check
pnpm schema:rollback-check
pnpm schema:downstream-check
```

The default probe is a visibility command: it exits 0 when export, TypeSpec compile, and OA SDK validation pass, even if semantic diff remains. `--fail-on-breaking` is the readiness gate; the current canonical artifact passes it, and future semantic regressions must either be removed or explicitly accepted by policy.

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
| Generated bundle manifest | pass, `oa-sdk.typespec-bundle.v1` ties exported `main.tsp` to the generated compatibility sidecar |
| Generated bundle expected OpenAPI | pass, `pnpm typespec:roundtrip -- --keep` and `oa-gen tsp-export --bundle-expected-openapi <expected.openapi.yaml>` write a bundle-local expected OpenAPI and link it from the manifest |
| Generated bundle check | pass, `oa-gen tsp-bundle-check --manifest <generated>` compiles the generated `.tsp`, restores sidecar metadata, validates emitted/restored OpenAPI, and runs expected diff when `expectedOpenapi` is present |
| Export diagnostics | 104 |
| Export diagnostics gate | pass, 104 accepted and 0 unaccepted |
| Compatibility sidecar | 102 entries: 79 response media examples, 13 request media examples, 9 parameter examples, 1 security scheme |
| Sidecar restore | pass, 104 applied targets and 0 missing targets |
| Sidecar re-extract stability | pass, 102/102 expected entries satisfied, 104/104 actual entries covered, 0 missing/unexpected/value mismatches |
| Breaking diff | 0 breaking changes across 0 modified operations |
| Restored breaking diff | 0 breaking changes across 0 modified operations |
| Authored bundle manifest | pass, `oa-sdk.typespec-bundle.v1` resolves entrypoint, sidecar, expected OpenAPI, and compatibility metadata |
| Authored bundle check | pass, 1 operation, 3 sidecar entries, 3 applied targets, 0 missing targets |
| Authored sidecar re-extract stability | pass, 3/3 expected entries satisfied, 3/3 actual entries covered, 0 missing/unexpected/value mismatches |
| Authored restored validation | pass, 0 warnings, 0 infos |
| Authored restored breaking diff | 0 breaking changes across 0 modified operations |
| Authored extension bundle manifest | pass, `oa-sdk.typespec-bundle.v1` resolves entrypoint and expected OpenAPI without a sidecar |
| Authored extension bundle check | pass, `.tsp` `x-oa-sdk-*` metadata yields 1 operation, 3 sidecar-equivalent entries, 3 applied targets, 0 missing targets |
| Authored extension restored diff | 0 breaking changes across 0 modified operations |
| Authored representative source selection | pass, fixture README maps selected canonical operations/components to coverage bullets |
| Authored representative bundle check | pass, `.tsp` `x-oa-sdk-*` metadata yields 3 operations, 6 sidecar-equivalent entries, 6 applied targets, 0 missing targets |
| Authored representative restored diff | 0 breaking changes across 0 modified operations |
| Authored request body extension bundle check | pass, `.tsp` `oa-sdk.typespec-extensions.v2` metadata yields 1 operation, 1 request media example entry, 1 applied target, 0 missing targets |
| Authored request body extension restored diff | 0 breaking changes across 0 modified operations |
| Authored canonical bundle check | pass, sidecar-less `.tsp` `oa-sdk.typespec-extensions.v2` metadata yields 27 operations, 104 sidecar-equivalent entries, 104 applied targets, 0 missing targets |
| Authored canonical restored diff | 0 breaking changes across 0 modified operations |
| Authoring ownership guide | pass, contract facts are mapped to TypeSpec-native syntax, OA SDK TypeSpec extensions, compatibility sidecars, or runtime data / adapter policy |
| TypeSpec-first ADR | pass, `docs/internal/architecture/009-typespec-first-authoring.md` records accepted scope, evidence, guardrails, staged migration path, and rollback rules |
| Sidecar-to-extension migration workflow | pass, `pnpm typespec:sidecar-to-extensions` writes TypeSpec snippets, a residual sidecar, and a report without converting unsupported metadata into comments; current canonical sidecar conversion yields 99 converted entries and 3 residual path-level parameter examples |
| TypeSpec-first ADR promotion | pass, `docs/internal/architecture/009-typespec-first-authoring.md` accepts TypeSpec-first schema authoring with staged production migration and rollback rules |
| Production TypeSpec source layout | pass, `packages/schemas/typespec/` exists as the G9 production-owned TypeSpec bundle candidate and passes standalone bundle-check |
| Production TypeSpec schema check | pass, `pnpm schema:typespec-check` runs the production bundle check, verifies bundle-local expected OpenAPI against `packages/schemas/src/.merged.yaml`, and requires the TypeSpec-restored-vs-production diff to match `accepted-restored-drift.json` with 63 accepted hash-pinned entries |
| Production TypeSpec rollback gate | pass, `pnpm schema:rollback-check` runs the TypeSpec production candidate gate and the existing OpenAPI/Definition Builder validation path before any production source-path switch |
| Production TypeSpec downstream gate | pass, `pnpm schema:downstream-check` generates the TypeSpec-restored production OpenAPI artifact, imports built package `dist` exports, feeds it to parser validation, codegen typegen, router generation, client generation, and mock-server handler creation, and compiles generated typegen/router/client TypeScript consumers plus a synthetic webhook/header fixture |

Diagnostic distribution:

| Code | Count | Disposition | Owner |
|---|---:|---|---|
| `response/examples-dropped` | 79 | accepted externalized | `oa-sdk-openapi-example-sidecar` |
| `request-body/examples-dropped` | 13 | accepted externalized | `oa-sdk-openapi-example-sidecar` |
| `parameter/examples-dropped` | 11 | accepted externalized | `oa-sdk-openapi-example-sidecar` |
| `components/security-scheme-dropped` | 1 | accepted metadata-only | `openapi-security-component-metadata` |

Diagnostic policy distribution:

| Disposition | Accepted | Count |
|---|---:|---:|
| externalized | true | 103 |
| metadata-only | true | 1 |

Current endpoint diff:

- No endpoint changes are detected by OA SDK diff.
- Component schemas remain `28 -> 32`; the four additional schemas are accepted TypeSpec projection artifacts: `ErrorMeta`, `ListModerationReports200Body`, `ListMyRoleChanges200Body`, and `ListUsers200Body`.
- The roundtrip report now records per-diagnostic ownership and rationale. The current fixture has no unaccepted exporter diagnostics.
- The compatibility sidecar restores examples/security metadata that is intentionally outside the TypeSpec projection. One path-level parameter entry restores to three emitted operation parameters, so restore applied target count is higher than sidecar entry count.
- The generated roundtrip workspace now includes `oa-sdk.typespec-bundle.v1` plus bundle-local `expected.openapi.yaml`, so OpenAPI export produces a portable `.tsp + sidecar + expected OpenAPI` bundle instead of unrelated files.
- Generated `oa-sdk.typespec-bundle.v1` files are accepted directly by `oa-gen tsp-bundle-check --manifest <generated>`; `pnpm typespec:bundle-check -- --manifest <generated>` is the repository wrapper. When `expectedOpenapi` is declared through `--bundle-expected-openapi`, generated bundle checks also run the expected diff gate; without it, they still gate TypeSpec compile, sidecar restore/re-extract stability, and OA SDK OpenAPI validation.
- The restored OpenAPI can be re-scanned into a sidecar with no semantic drift. The canonical fixture intentionally expands path-level parameter examples into operation-level targets, so expected and actual entry counts may differ while semantic coverage remains complete.
- The authored bundle fixture proves the opposite direction as a first slice: an `oa-sdk.typespec-bundle.v1` manifest points to a hand-written `.tsp` structural contract plus authored `oa-sdk.typespec-compat-sidecar.v1`; the bundle compiles, restores OA SDK examples/security metadata, validates, and matches the expected OpenAPI endpoint surface with no breaking diff.
- The authored extension bundle fixture proves the first sidecar-less slice: an `oa-sdk.typespec-bundle.v1` manifest points only to `.tsp` plus expected OpenAPI, declares `compatibility.oaSdkExtensionSchemaVersion: "oa-sdk.typespec-extensions.v1"`, and OA SDK semantics are restored from `x-oa-sdk-operation-examples` and `x-oa-sdk-security-schemes` metadata emitted from TypeSpec `@extension(...)` decorators.
- The authored representative bundle fixture proves G1/G2 of the TypeSpec-first goal roadmap: source selection is documented from canonical users operations/components, and a sidecar-less `.tsp` project covers pagination, request bodies, shared error responses, strict object sealing, union/composed schema shape, TypeSpec-native bearer security requirements, and restored OAuth2 metadata with stable re-extraction.
- The authoring ownership guide proves G4 by giving maintainers a single map for deciding whether a contract fact belongs in TypeSpec-native syntax, an OA SDK TypeSpec extension, the compatibility sidecar, or runtime data / adapter policy.
- The original conditional ADR draft proved G5 by accepting TypeSpec as a first-class authoring surface only for selected bundles that pass manifest, ownership, restore, validation, expected diff, and re-extraction stability gates.
- The sidecar-to-extension migration tool proves G6 by generating TypeSpec `@extension(...)` snippets for supported parameter, request, response, and security scheme entries while leaving path-level or otherwise unsupported metadata explicitly sidecar-owned.
- For the current canonical generated sidecar, the migration tool converts 99/102 entries to extension snippets and leaves 3 path-level parameter examples in the residual sidecar.
- The authored canonical bundle fixture proves G7 by expanding the 3 residual path-level parameter examples into 5 operation-level extension entries, producing a sidecar-less v2 bundle with 104 restored entries and stable re-extraction.
- ADR-009 proves G8 by promoting the outcome to accepted TypeSpec-first schema authoring while leaving production build rewiring as a separate staged migration.

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

This is enough to keep path and operation identity stable and to run a machine-readable `0.3.0` readiness gate, but not enough by itself to claim TSP-first authoring.

## Difference Backlog

During the staged production migration, keep these accepted gaps visible and close or refine them only with focused evidence:

1. OAuth2 component policy: the current unused OAuth2 scheme is classified as OpenAPI-side metadata and restored through the compatibility sidecar; any referenced unsupported security scheme remains contract-bearing until its sidecar semantics are explicitly accepted.
2. Parameter and response media examples: OA SDK `dataValue` / `serializedValue` examples are externalized to the compatibility sidecar for generated bundles, and a sidecar-less authored fixture now proves they can also live in `.tsp` as OA SDK TypeSpec extension metadata without weakening mock-server priority.
3. Untyped schema policy: `ValidationError.received` is the only accepted `unknown` escape hatch; any new untyped schema still emits `schema/type-unknown`.
4. Visibility and annotations: map readOnly/writeOnly/annotations only after the OA SDK visibility policy is explicit.
5. Component projection policy: keep the accepted extra TypeSpec schemas visible in the roundtrip report or eliminate them if they become confusing for release review.
6. Diff normalization: continue teaching OA SDK review tooling only proven TypeSpec-emitted shapes that are semantically equivalent, without suppressing real contract changes.

The design direction for extension vNext, representative/full authored fixtures, and ADR outcomes is recorded in [`typespec-roundtrip/tsp-first-decision-design.md`](./typespec-roundtrip/tsp-first-decision-design.md). Maintainer authoring ownership is recorded in [`typespec-roundtrip/authoring-ownership-guide.md`](./typespec-roundtrip/authoring-ownership-guide.md).

## Declaration Criteria

TypeSpec-first declaration criteria:

- `pnpm typespec:roundtrip -- --fail-on-breaking` passes for the canonical schema artifact.
- All exporter diagnostics are either zero for contract-bearing surfaces or categorized as accepted metadata loss.
- The authoring guide says which facts belong in `.tsp`, which remain OpenAPI sidecars/extensions, and which remain OA SDK runtime data: [`typespec-roundtrip/authoring-ownership-guide.md`](./typespec-roundtrip/authoring-ownership-guide.md).
- The generated OpenAPI remains valid under OA SDK's OpenAPI 3.2 gate and downstream codegen/router/client/mock-server tests.
- The compatibility sidecar schema is stable enough for authored `.tsp + sidecar` fixtures, not only generated sidecars.
- Authored `.tsp + sidecar` fixtures are declared through `oa-sdk.typespec-bundle.v1`, pass `oa-gen tsp-bundle-check --fail-on-breaking` and the `pnpm typespec:bundle-check -- --fail-on-breaking` wrapper, and cover every sidecar entry kind that is accepted by policy.
- Authored sidecar-less `.tsp` fixtures are declared through `oa-sdk.typespec-bundle.v1`, pass the same bundle check using `compatibility.oaSdkExtensionSchemaVersion`, conform to [`oa-sdk.typespec-extensions.v1`](./typespec-roundtrip/oa-sdk-typespec-extensions.v1.md), and cover every previously sidecar-owned entry kind through `.tsp` extension metadata.
- Authored representative `.tsp` fixtures are selected from canonical operations/components, document their source selection, pass the same sidecar-less bundle check, and cover the semantic families required before the TypeSpec-first ADR.
- The authored canonical `.tsp` fixture is scaffolded from the canonical export, runs without the original OpenAPI artifact, passes `tsp-bundle-check --fail-on-breaking`, and has stable extension re-extraction.
- Generated `.tsp + sidecar` bundles can be re-read through the same manifest contract without relying on the original OpenAPI artifact.
- Generated bundles can include a bundle-local expected OpenAPI artifact so the same manifest contract can prove restored diff stability, not only compile/restore validity.
- Sidecar restore and re-extraction stability gates pass with no missing expected entries, unexpected actual entries, or value mismatches.
- Sidecar-to-extension migration reports show every supported entry converted to a checked TypeSpec extension target and every unsupported entry retained in the residual sidecar with a reason.
