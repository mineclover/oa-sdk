# TypeSpec-First Decision Design

Status: decision prep, not an ADR.

This document locks the design direction for the remaining TypeSpec-first work that follows the `oa-sdk.typespec-extensions.v1` sidecar-less spike. It decides the next semantic scope, the authored fixture strategy, and the ADR evidence model without declaring TypeSpec-first yet.

## Scope

The decisions here cover:

1. Extension semantics outside `oa-sdk.typespec-extensions.v1`.
2. The larger authored fixture needed before a TSP-first declaration.
3. The ADR shape and evidence gates for a future TypeSpec-first decision.

Push is intentionally out of scope for this track.

## Decision 4 - vNext Semantic Scope

Decision: keep `oa-sdk.typespec-extensions.v1` frozen at the two implemented authoring extensions:

- `x-oa-sdk-operation-examples`
- `x-oa-sdk-security-schemes`

Do not stretch v1 to cover every future OA SDK metadata gap. Any field that changes restored OpenAPI output for a sidecar-less bundle requires a new manifest schema version, not a silent compatible addition.

### v2 Candidate: Request Body Examples

Request body examples are the first restore-bearing candidate for `oa-sdk.typespec-extensions.v2`.

Rationale:

- They share the same OA SDK example semantics as parameter and response media examples.
- They restore onto an OpenAPI-native target: `paths.<path>.<method>.requestBody.content.<mediaType>.example|examples`.
- They are likely to affect mock-server request semantics and fixture readability.

Proposed authored shape:

```json
{
  "requestBody": {
    "<authoringKey>": {
      "mediaType": "application/json",
      "example": {},
      "examples": {}
    }
  }
}
```

This would live under the existing operation-level `x-oa-sdk-operation-examples` container, but only when the manifest declares a new extension schema version.

Required gate before accepting:

- A sidecar-less fixture proves request body examples restore to OpenAPI-native request body media targets.
- Re-extraction reports no missing expected entries, unexpected actual entries, or value mismatches.
- Mock-server request example priority remains unchanged.

### Not An Extension-First Area: Visibility And Annotations

Read/write visibility, `readOnly`, `writeOnly`, and annotations should not become OA SDK TypeSpec extension metadata first.

Decision path:

1. Define the OA SDK visibility policy independently.
2. Prefer TypeSpec-native visibility or OpenAPI emitter-native constructs when they can emit stable OpenAPI 3.2.
3. Use an OA SDK extension only for the residual gap that cannot be expressed by TypeSpec-native authoring and is contract-bearing for OA SDK.

This keeps visibility from becoming a catch-all extension bucket.

### Separate Track: Callbacks, Links, And Webhooks

Callbacks, links, and webhooks are not part of the next extension version by default.

Decision path:

- If TypeSpec can express the structure and OA SDK diff accepts the emitted OpenAPI, keep them TypeSpec-native.
- If OA SDK owns runtime behavior that is not represented by TypeSpec/OpenAPI projection, open a dedicated extension design for that behavior.
- Do not mix callback/link/webhook runtime semantics into the examples extension.

### Review-Policy Track: Component Projection And Diff Normalization

Component projection artifacts and TypeSpec-emitted shape normalization are review policy work, not authoring vocabulary work.

Rules:

- Extra TypeSpec component schemas stay visible in reports unless a proven equivalence makes them unnecessary.
- Diff normalization is allowed only per proven shape with source, emitted, restored, and expected examples.
- Review policy must never hide endpoint-breaking changes to make TSP-first easier to declare.

## Decision 5 - Full Authored Fixture Strategy

Decision: add one representative authored fixture before attempting a full canonical authored bundle.

The current fixtures prove mechanics:

- `authored-bundle`: authored `.tsp + sidecar`.
- `authored-extension-bundle`: authored sidecar-less `.tsp` with `oa-sdk.typespec-extensions.v1`.

The next fixture should prove authoring ergonomics and semantic coverage without requiring a one-shot rewrite of the whole canonical OpenAPI artifact.

### Fixture Tiers

Tier 1: minimal conformance fixtures.

- Existing location: `docs/internal/typespec-roundtrip/fixtures/authored-bundle/`
- Existing location: `docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle/`
- Purpose: lock schema and restore behavior.

Tier 2: representative authored fixture.

- Proposed location: `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/`
- Purpose: cover the semantic families needed for a TSP-first decision with a manageable authored `.tsp`.
- Source selection should be derived from the canonical OA SDK artifact and recorded in a fixture README.

Tier 3: full canonical authored fixture.

- Proposed location: `docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/`
- Purpose: prove that the canonical OA SDK API can be authored as a `.tsp` project and checked without depending on the original OpenAPI artifact.
- This is not required before starting ADR preparation, but it is required before accepting TypeSpec as the default schema source of truth.

### Representative Fixture Coverage

The representative fixture should include at least:

- One paginated list operation with query parameters and OA SDK `dataValue` or `serializedValue` examples.
- One request body operation with reusable component schemas.
- One success response with response media examples.
- One error response shared by multiple operations.
- One sealed object model using `...Record<never>;`.
- One union or composed schema that exercises the accepted TypeSpec projection shape.
- One security requirement that uses the restored security scheme.

The fixture manifest should include `expectedOpenapi` and should run through:

```bash
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
```

### Full Canonical Fixture Gate

The full canonical fixture should not be handwritten from scratch in one pass.

Recommended path:

1. Use `oa-gen tsp-export` output as a scaffold.
2. Convert sidecar-owned metadata to TypeSpec extension metadata where supported.
3. Keep unsupported metadata in a sidecar only when it is explicitly outside the selected extension schema version.
4. Add a bundle-local expected OpenAPI artifact.
5. Require `tsp-bundle-check --fail-on-breaking` to pass without the original OpenAPI input.

The full fixture is complete only when its report proves:

- The operation set matches the canonical artifact.
- Restored OpenAPI has no breaking diff against the bundle-local expected OpenAPI.
- Sidecar or extension semantic re-extraction is stable.
- All remaining diagnostics are categorized as accepted metadata, review-policy equivalence, or explicit non-goals.

## Decision 6 - TSP-First ADR Structure

Decision: prepare the ADR after the representative authored fixture passes, but accept it only after the full canonical authored fixture or an explicit conditional-decision alternative is available.

Proposed ADR path:

- `docs/internal/architecture/009-typespec-first-authoring.md`

The ADR should have one of three outcomes:

| Outcome | Meaning |
|---|---|
| Reject | Keep OpenAPI as the only schema source of truth. TypeSpec remains export/evaluation tooling. |
| Conditional accept | TypeSpec becomes first-class for selected authored bundles, while canonical production schema remains OpenAPI until the full fixture passes. |
| Accept | TypeSpec becomes the default schema source of truth for OA SDK schema authoring. |

### Minimum ADR Evidence

The ADR must cite current, reproducible evidence:

- `pnpm typespec:roundtrip -- --fail-on-breaking`
- `pnpm typespec:bundle-check` for minimal sidecar and sidecar-less fixtures.
- `pnpm typespec:bundle-check` for the representative authored fixture.
- Full canonical authored bundle check, or a documented reason why the ADR is conditional instead of accepted.
- `pnpm check:feature-tests`
- `pnpm check:api-index`
- `pnpm check:cli-spec`
- Downstream validation for generated OpenAPI consumers: codegen, router, client, and mock-server gates selected by the feature matrix.

### ADR Decision Rules

Do not accept TSP-first when:

- Any contract-bearing TypeSpec export diagnostic is unaccepted.
- A sidecar-less bundle can omit the extension schema version.
- Restored OpenAPI contains restore-only `x-oa-sdk-*` metadata.
- Diff normalization is required but lacks a focused source/emitted/expected proof fixture.
- Runtime-only OA SDK semantics are hidden inside TypeSpec comments or unvalidated extension payloads.

Conditional accept is allowed when:

- Representative authored fixture coverage is green.
- The remaining gaps are explicitly assigned to OpenAPI sidecar, TypeSpec extension vNext, or runtime data.
- The canonical source of truth remains OpenAPI until the full authored canonical fixture passes.

Accept is allowed only when:

- The full canonical authored fixture passes the bundle check without relying on the original OpenAPI artifact.
- Every sidecar or extension-owned semantic is either restored and stable, or no longer needed.
- The authoring guide can tell maintainers where each contract fact belongs: TypeSpec-native syntax, OA SDK TypeSpec extension, compatibility sidecar, or runtime data.

## Goal Roadmap

The remaining work should run as explicit goals instead of one broad "make TypeSpec-first happen" task. Each goal below has a concrete stopping point and should be committed independently.

| Goal | Purpose | Depends on | Done when |
|---|---|---|---|
| G1 Representative fixture source selection | Pick the canonical operations/components that will represent TSP-first authoring coverage. | Current `oa-sdk.typespec-extensions.v1` and minimal fixtures. | A fixture README or plan lists selected operations/components, why each was selected, and which coverage bullets it satisfies. |
| G2 Implement representative authored bundle | Prove a manageable authored `.tsp` bundle covers the required semantic families. | G1. | `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/` exists and `pnpm typespec:bundle-check -- --manifest ... --fail-on-breaking` passes. |
| G3 Decide request body example extension v2 | Decide whether request body examples need `oa-sdk.typespec-extensions.v2` and, if yes, implement the narrow restore path. | G2 evidence or a focused sidecar-less request-body fixture. | Either a documented rejection keeps request body examples outside extension vocabulary, or v2 manifest parsing, restore, fixture, and tests pass. |
| G4 Authoring ownership guide | Make the source-of-truth boundary readable for maintainers. | G2 and any G3 decision. | A guide or section maps each contract fact to TypeSpec-native syntax, OA SDK TypeSpec extension, compatibility sidecar, or runtime data. |
| G5 Conditional TSP-first ADR draft | Prepare the architecture decision once representative evidence exists. | G2 and G4. | `docs/internal/architecture/009-typespec-first-authoring.md` exists as reject or conditional-accept draft with cited command evidence. |
| G6 Sidecar-to-extension migration tool | Reduce manual work before the full canonical fixture. | G3 if v2 is accepted; otherwise G2. | A tool or documented workflow converts supported sidecar entries into `.tsp` extension metadata and leaves unsupported entries explicitly sidecar-owned. |
| G7 Full canonical authored bundle | Prove the canonical OA SDK API can be checked from a TypeSpec bundle without the original OpenAPI artifact. | G5 draft and G6 workflow. | `authored-canonical-bundle` passes bundle check, operation set matches canonical expected OpenAPI, and sidecar/extension re-extraction is stable. |
| G8 ADR promotion | Decide the real TypeSpec-first outcome. | G7, or an explicit decision to stay conditional. | ADR is updated to reject, conditional accept, or accept with current evidence and rollback/migration rules. |

### Recommended Goal Boundaries

Start with G1 or G2, not G3. Request body examples are a plausible v2 candidate, but implementing v2 before the representative fixture risks optimizing the extension vocabulary before the authored coverage need is proven.

G5 should not claim accepted TypeSpec-first unless G7 is green. Before G7, the strongest supported ADR outcome is conditional accept.

G6 should be treated as tooling/workflow support, not as a schema decision. It must not silently convert unsupported sidecar semantics into comments or unvalidated extension payloads.

### Current Goal Evidence

- G1 is implemented by `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/README.md`.
- G2 is implemented by `docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/` and passes `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking`.
- The representative bundle currently restores 6 sidecar-equivalent entries: 2 parameter examples, 3 response media examples, and 1 security scheme.

### Goal Gate Commands

Baseline commands for every implementation goal:

```bash
pnpm check:feature-tests
pnpm check:api-index
pnpm check:cli-spec
git diff --check
```

Additional commands by goal:

| Goal | Commands |
|---|---|
| G2 | `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking` |
| G3 | `pnpm --filter @oa-sdk/codegen test -- src/__tests__/typespec-authored-bundle.test.ts src/__tests__/typespec-sidecar.test.ts` and the v2 fixture bundle check |
| G5 | `pnpm typespec:roundtrip -- --fail-on-breaking` plus minimal and representative bundle checks |
| G7 | `pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-canonical-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking` |

## Next Work Order

1. Run G1 if source selection is still unclear; otherwise start G2.
2. Run G2 and use its evidence to decide whether G3 is actually needed.
3. Run G4 before drafting the ADR so maintainers have an authoring boundary.
4. Run G5 as a conditional ADR draft.
5. Run G6 and G7 before promoting the ADR beyond conditional accept.
6. Run G8 to promote, revise, or reject the ADR based on full fixture evidence.
