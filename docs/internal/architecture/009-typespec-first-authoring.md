# ADR-009 - TypeSpec-First Authoring

## Status

Accepted, dated 2026-06-22.

TypeSpec is accepted as the OA SDK schema authoring source of truth for the staged production migration. The current production OpenAPI fragments remain in place until a follow-up migration wires the production build to the accepted TypeSpec source and preserves the rollback path below.

## Context

OA SDK currently treats OpenAPI 3.2 as the production schema source of truth. The TypeSpec roundtrip track evaluates whether that can change without losing OA SDK contract semantics such as `dataValue` / `serializedValue` examples, OpenAPI 3.2 validation, mock-server behavior, security metadata, and downstream codegen/router/client compatibility.

The evaluation has now completed these prerequisite slices:

- Representative source selection for authored TypeSpec coverage.
- A representative sidecar-less authored bundle covering canonical users operations and semantic families.
- `oa-sdk.typespec-extensions.v1` for parameter examples, response media examples, and security scheme metadata.
- `oa-sdk.typespec-extensions.v2` for request body media examples.
- A maintainer authoring ownership guide that maps contract facts to TypeSpec-native syntax, OA SDK TypeSpec extensions, compatibility sidecars, or runtime data / adapter policy.

The final architecture decision can now be made: the full canonical authored bundle exists as a sidecar-less v2 fixture, and sidecar-to-extension migration has been applied to the canonical sidecar semantics.

## Decision

Adopt TypeSpec-first schema authoring.

The accepted production migration target is a TypeSpec bundle that satisfies all of the following:

1. The bundle has an `oa-sdk.typespec-bundle.v1` manifest.
2. The bundle includes a bundle-local `expected.openapi.yaml`.
3. The bundle passes `pnpm typespec:bundle-check -- --manifest <bundle>/oa-sdk.typespec-bundle.json --fail-on-breaking`.
4. All contract facts follow `docs/internal/typespec-roundtrip/authoring-ownership-guide.md`.
5. Sidecar-less bundles declare `compatibility.oaSdkExtensionSchemaVersion`.
6. Restored OpenAPI contains no restore-only `x-oa-sdk-*` metadata.
7. Sidecar or extension semantic re-extraction reports no missing expected entries, unexpected actual entries, or value mismatches.

`docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/` is the accepted evidence fixture for that target. The production source switch is intentionally staged: this ADR accepts TypeSpec as the authoring SSOT, but the repository must keep the current OpenAPI production path working until the follow-up migration replaces or generates those artifacts from the TypeSpec source.

## Evidence

Current evidence was collected on 2026-06-22.

| Command | Result |
|---|---|
| `pnpm typespec:roundtrip -- --fail-on-breaking --report /tmp/oa-sdk-g5-typespec-roundtrip-report.json` | pass; operations `27 -> 27`; component schemas `28 -> 32`; export diagnostics `104`, all accepted; compatibility sidecar `102` entries; restore `104` applied targets and `0` missing; sidecar stability `102/102` expected and `104/104` actual covered; breaking diff `0`. |
| `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking --report /tmp/oa-sdk-g5-authored-bundle-report.json` | pass; `.tsp + sidecar`; `3` sidecar entries; restore `3` applied and `0` missing; stability `3/3`. |
| `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking --report /tmp/oa-sdk-g5-authored-extension-report.json` | pass; sidecar-less `oa-sdk.typespec-extensions.v1`; `3` sidecar-equivalent entries; restore `3` applied and `0` missing; stability `3/3`. |
| `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking --report /tmp/oa-sdk-g5-authored-representative-report.json` | pass; representative sidecar-less bundle; `3` operations; `6` sidecar-equivalent entries; restore `6` applied and `0` missing; stability `6/6`. |
| `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-request-body-extension-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking --report /tmp/oa-sdk-g5-authored-request-body-v2-report.json` | pass; sidecar-less `oa-sdk.typespec-extensions.v2`; `1` request media example entry; restore `1` applied and `0` missing; stability `1/1`. |
| `pnpm --filter @oa-sdk/codegen test -- src/__tests__/tsp-export.test.ts src/__tests__/typespec-sidecar.test.ts src/__tests__/typespec-authored-bundle.test.ts src/__tests__/cli-tsp-sidecar.test.ts src/__tests__/openapi-breaking-diff.test.ts src/__tests__/typespec-roundtrip-report.test.ts` | pass; `54` test files and `687` tests. |
| `pnpm --filter @oa-sdk/router test` | pass; `2` test files and `36` tests. |
| `pnpm --filter @oa-sdk/client test` | pass; `3` test files and `39` tests. |
| `pnpm --filter @oa-sdk/mock-server test` | pass; `34` test files and `583` tests. |
| `pnpm typespec:sidecar-to-extensions -- --sidecar <canonical-generated-sidecar> --output /tmp/oa-sdk-g6-canonical/snippets.tsp --remaining-sidecar /tmp/oa-sdk-g6-canonical/remaining.json --report /tmp/oa-sdk-g6-canonical/migration-report.json` | pass; current canonical sidecar `102` entries; `99` converted to `oa-sdk.typespec-extensions.v2` snippets; `3` path-level parameter examples remain sidecar-owned. |
| `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking --report /tmp/oa-sdk-g7-authored-canonical-report.json` | pass; sidecar-less v2 canonical fixture; `27` operations; `104` sidecar-equivalent entries; restore `104` applied and `0` missing; stability `104/104`; breaking diff `0`. |

Governance documentation gates must remain green for this ADR:

- `pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:cli-spec`
- `git diff --check`

## Guardrails

- Do not remove the current OpenAPI production path until the TypeSpec production migration has equivalent build, validation, and rollback gates.
- Do not use unvalidated TypeSpec comments to carry runtime-only OA SDK semantics.
- Do not silently add restore-bearing fields to `oa-sdk.typespec-extensions.v1`; new restored OpenAPI output requires a new extension schema version.
- Do not hide referenced unsupported auth requirements as metadata-only sidecar entries.
- Do not normalize TypeSpec-emitted shape differences in review tooling without a focused source/emitted/restored/expected proof.
- Do not create a full canonical authored fixture by handwritten rewrite in one pass; scaffold from export output and migrate supported sidecar entries intentionally.

## Promotion Path

G6 provides a sidecar-to-extension migration tool and documented workflow:

- Converts supported `parameter-examples`, `request-media-examples`, `response-media-examples`, and supported `security-scheme` entries into `.tsp` extension metadata.
- Leaves unsupported metadata explicitly sidecar-owned.
- Refuses silent conversion to comments or unchecked extension payloads.

G7 adds `docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/` and proves:

- The operation set matches the canonical OA SDK OpenAPI artifact.
- Restored OpenAPI has no breaking diff against bundle-local expected OpenAPI.
- Sidecar or extension semantic re-extraction is stable.
- Remaining diagnostics are categorized as accepted metadata, review-policy equivalence, or explicit non-goals.

G8 outcome:

| Outcome | Required State |
|---|---|
| Accept | Full canonical authored bundle passes, migration/rollback rules are defined, and TypeSpec is accepted as the staged default schema authoring source of truth. |

## Rollback

Rollback must remain available during and after the staged migration:

1. Keep or restore the bundle-local `expected.openapi.yaml`.
2. Move unsupported extension-owned facts back into `oa-sdk.typespec-compat-sidecar.v1`.
3. Stop treating a TypeSpec bundle as production-authoritative until `tsp-bundle-check --fail-on-breaking` is green again.
4. Keep or regenerate the production OpenAPI artifact from the last green source while TypeSpec migration failures are being repaired.
5. Revert the production build wiring to the OpenAPI path if TypeSpec-generated output cannot preserve OA SDK validation, downstream tests, or mock-server behavior.

## Related Documents

- `docs/internal/typespec-roundtrip.plan.md`
- `docs/internal/typespec-roundtrip/tsp-first-decision-design.md`
- `docs/internal/typespec-roundtrip/authoring-ownership-guide.md`
- `docs/internal/typespec-roundtrip/sidecar-to-extension-migration.md`
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v1.md`
- `docs/internal/typespec-roundtrip/oa-sdk-typespec-extensions.v2.md`
