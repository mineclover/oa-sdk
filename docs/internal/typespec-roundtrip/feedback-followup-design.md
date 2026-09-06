# TypeSpec Follow-up Boundary Design

Status: partially implemented, dated 2026-07-25. Phase 1 (documented helper
lifecycle and boundary) and Phase 2 (`evidence-only` observation inputs) are
implemented. Trusted toolchain artifacts and semantic profile bundles remain
decision-gated; this document records their required preconditions.

## Context

The production source is a TypeSpec bundle. `main.tsp` composes focused
metadata and domain modules, `@oa-sdk/typespec-decorators` provides a narrow
typed helper, and deployment projections can replace only `servers`.
spec-lens observes `sourceRoot` plus declared observation inputs and compiles
historical TypeSpec revisions in an isolated workspace with a fixed emitter
configuration.

Those boundaries are intentionally conservative. This design preserves them
while defining what must be true before broadening any of them.

## Goals

1. Explain exactly why a historical snapshot was rebuilt when an input outside
   `sourceRoot` changed.
2. Allow stronger historical input evidence without executing a revision's
   arbitrary TypeSpec or emitter configuration.
3. Keep deployment-only profiles separate from contracts with different API
   meaning.
4. Grow typed helpers one reviewed extension family at a time.
5. Prevent contributor or agent guidance from duplicating stale ownership rules.

## Non-goals

- Treating `watchPaths` as a general-purpose compiler include mechanism.
- Executing a historical `tspconfig.yaml`, package script, or emitter plugin.
- Allowing a generic decorator that accepts an arbitrary extension key or JSON
  payload.
- Making local/staging/production server projections separate approved API
  contracts.

---

## A. Historical external-input evidence

### Implemented input classes

`observation` is the standard explicit, repo-relative configuration surface;
it is deduplicated and normalized to typed `observationInputs` before an
adapter reads it. Inputs are bounded to 16 entries. `evidence-only` is limited
to four file inputs, 2 MiB each (8 MiB aggregate) with two concurrent reads;
directories are candidate-only.
A change in any declared path is included in the
revision union and can cause a rebuild. It never makes that path a historical
compiler input, so a lockfile, config, or arbitrary package source cannot become
executable revision code.

| Class | Example | Historical read | Compiler use | Purpose |
|---|---|---:|---:|---|
| `candidate-only` | helper package directory | commit discovery only | no | current safe default |
| `evidence-only` | `pnpm-lock.yaml`, projection JSON | hash and availability only | no | explain rebuilds and bind snapshot evidence |
| `trusted-toolchain` | published decorator package digest | immutable registry artifact only | yes, allowlisted | future, ADR-gated historical helper reproduction |

`watchPaths` remains a compatibility alias for `candidate-only` inputs. New
configuration should prefer `observation.candidates` and `observation.evidence`;
advanced integrations may use `observationInputs` directly. None of these
inputs may influence the compiler.

### Snapshot contract

For every `evidence-only` input, persist an envelope in TypeSpec snapshot
provenance:

```ts
type SpecLensObservedInputEvidence = {
  path: string
  class: 'evidence-only'
  contentHash?: string
  availability: 'available' | 'missing' | 'unreadable'
  reason?: string
}
```

The declared input class/path list is part of the project identity. Each
`evidence-only` envelope is persisted in snapshot provenance. A changed input
may therefore yield the same OpenAPI document but not the same evidence record;
the timeline can state that the rebuild was input-driven rather than
contract-driven. External evidence is hash and status only, not a SQLite blob.
For immutable Git revisions, the revision ID already fixes the envelope; a
future mutable-source cache reuse policy must include an envelope digest before
it can reuse evidence across reads.

### Trusted toolchain rule

Historical helper behavior must never be recreated by compiling arbitrary
historical JavaScript from a repository checkout. A `trusted-toolchain` entry
instead resolves a package name, version, and SHA-256 from a reviewed immutable
artifact registry controlled by the current application. The snapshot records
that artifact digest. Missing, unapproved, or digest-mismatched artifacts fail
the historical build closed.

This preserves the present `@oa-sdk/typespec-decorators` allowlist model while
making a future historical-reproduction claim auditable. The first delivery
need not implement a registry; until it exists, local decorator changes remain
candidate-only plus current toolchain digest evidence.

### Acceptance evidence

- A lockfile-only commit produces a snapshot with `evidence-only` input hash
  change and no executable config access.
- A missing evidence file produces a visible `missing` envelope, never a
  silently reused snapshot.
- A historical revision requesting an unknown helper digest fails before
  compiler launch.
- GitHub, GitLab, and local Git return the same deduplicated revision union for
  source root plus observation inputs.

---

## B. Environment profiles and contract semantics

### Retained decision

`oa-sdk.typespec-projections.v1` remains a server-only deployment projection.
It derives a gitignored artifact from the restored contract and may not change
paths, operations, schemas, security, responses, tags, or the approved
snapshot.

### Escalation threshold

Use a **semantic profile bundle**, not a projection, when any profile changes a
consumer-visible API fact. Examples include an operation existing only in one
environment, a different authentication scheme, a response shape difference,
or a different versioned API surface.

The proposed semantic-profile shape is an independently reviewable TypeSpec
bundle:

```text
packages/schemas/typespec/profiles/<profile>/
  main.tsp
  oa-sdk.typespec-bundle.json
  approved.openapi.yaml
  accepted-restored-drift.json
```

It may import a shared base module only through explicit TypeSpec source imports.
It owns its manifest, approved snapshot, API compatibility policy, and
downstream gate result. A profile must not be selected by mutating the base
bundle after restore.

Before adopting the shape, record an ADR that names the owner, intended
audience, compatibility relationship to the base API, and sunset/rollback
policy. The default profile remains the only production-authoritative bundle
until that ADR is accepted.

### Acceptance evidence

- A server-only profile cannot change a non-`servers` OpenAPI pointer.
- A semantic profile has its own candidate/promotion flow and passes the same
  bundle, validation, and relevant downstream gates as the base bundle.
- Diff output labels base-vs-profile comparison; it does not imply the two
  approved snapshots are interchangeable.

---

## C. Typed decorator family lifecycle

### Registry model

Keep one helper per extension family. Every helper must declare in a reviewed
registry entry:

| Field | Requirement |
|---|---|
| Owner | package/module and maintainer owner |
| Extension vocabulary | exact `oa-sdk.typespec-extensions.v*` field(s) emitted |
| Target and input schema | compile-time target plus runtime validation rules |
| Merge rule | deterministic behavior when native or extension metadata already exists |
| Restore proof | minimal TypeSpec fixture and restored OpenAPI assertion |
| Compatibility rule | whether a vocabulary version bump is required |

The current `@oaUseResponseComponent` helper is the pilot for this registry. Its
next test increment should compile a minimal `.tsp` fixture through the actual
TypeSpec emitter and restore path, in addition to its unit-level merge test.

### Guardrails

- No `@oaExtension(name, payload)` or equivalent escape hatch.
- A helper may validate and construct exactly one owned extension family.
- Add a new extension schema version only when restored OpenAPI vocabulary
  changes incompatibly; helper refactoring alone must preserve the existing
  vocabulary and fixture output.
- An operation may continue to use direct documented `@extension` metadata
  until its family has a reviewed helper.

---

## D. Automation guidance ownership

Repository documentation is the authoritative ownership policy. Agent skills,
editor snippets, and contributor templates must link to
`docs/guides/typespec-authoring-conventions.md` rather than duplicating module
placement rules. This avoids a stale instruction such as “keep metadata in
`main.tsp`” after the source layout evolves.

The next automation-maintenance change should:

1. replace duplicated module-placement rules with a link to the repository
   convention;
2. retain only tool-specific workflow and safety checks in the skill;
3. add a lightweight review check that compares the skill's cited convention
   path against the repository file; and
4. document the owning team for the external skill bundle, since it is not
   versioned by this repository.

---

## Delivery order

| Phase | Change | Requires an ADR? | Exit condition |
|---|---|---:|---|
| 1 | Document current candidate-only boundary and helper lifecycle | no | implemented: documentation and focused helper emitter test agree |
| 2 | Add `evidence-only` observation inputs and provenance envelopes | no | implemented: adapters/cache/API expose deterministic hashes and availability |
| 3 | Introduce immutable trusted-toolchain artifact registry | yes | historical helper digest is resolved without repository JS execution |
| 4 | Create a semantic profile bundle only for a real divergent API audience | yes | independent approval/downstream/rollback policy is accepted |
| 5 | Align external agent skill with repository convention | no repository ADR | implemented: skill delegates module placement to the current convention; external bundle ownership is still open |

## Open decisions

1. Which repository or release system owns immutable trusted decorator artifacts?
2. Should evidence-only input hashes be exposed in the public spec-lens API by
   default, or only with an explicit provenance expansion flag?
3. What retention policy applies to evidence content when a future input needs
   body-level review rather than a hash-only explanation?
4. Is there a real semantic environment audience that justifies a profile
   bundle, or should server-only projection remain the permanent policy?

## References

- [TypeSpec authoring conventions](../../guides/typespec-authoring-conventions.md)
- [Basic spec usage](../../guides/basic-spec-usage.md)
- [Production operations](./production-operations.md)
- [spec-lens documentation](../../spec-lens/README.md)
- [ADR-009](../architecture/009-typespec-first-authoring.md)
