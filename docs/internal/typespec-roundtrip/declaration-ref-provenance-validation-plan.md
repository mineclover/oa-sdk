# TypeSpec Declaration-to-Reference Provenance Validation Plan

Status: implemented through the AST provenance and Spec Lens integration. The
production artifact, blocking CI gate, and hash-bound historical snapshot/diff/
graph projection are implemented. Compiler-native emitter source maps remain
future work. This plan adds evidence to the existing TypeSpec-first pipeline;
it does not introduce another human-authored contract source.

## Problem and decision boundary

The current pipeline proves that the restored OpenAPI document is valid and
that its `$ref` graph resolves. It records the reachable TypeSpec source files,
but cannot answer which TypeSpec declaration emitted a particular OpenAPI
pointer or which extension declaration restored a particular `$ref`.

The target evidence chain is:

```text
TypeSpec symbol + source span
  --emits / restores--> OpenAPI JSON Pointer
  --references--------> OpenAPI $ref target
  --consumed by-------> parser / typegen / router / client / mock
```

The restored OpenAPI remains authoritative for `$ref` validity. Provenance is a
review and diagnostic artifact that must be produced by the same compile and
restore run; it must never be hand-authored or used to change OpenAPI output.

## Deliverable: provenance artifact v1

Emit a deterministic, gitignored candidate file beside the restored OpenAPI:

```text
.oa-sdk/typespec-candidates/declaration-ref-provenance.json
```

It is bound to the manifest, source hashes, restored OpenAPI hash, and TypeSpec
toolchain fingerprint. Its stable declaration identity is semantic (fully
qualified symbol plus kind), while its file/range is diagnostic metadata that
may move when comments or formatting change.

```ts
type TypeSpecRefProvenanceV1 = {
  schemaVersion: 'oa-sdk.typespec-ref-provenance.v1'
  inputs: {
    manifestPath: string
    restoredOpenApiSha256: string
    toolchainFingerprint: string
  }
  declarations: Array<{
    id: string // stable semantic identity, not a line number
    kind: 'model' | 'operation' | 'parameter' | 'response' | 'extension'
    symbol: string
    source: { file: string; start: { line: number; column: number }; end: { line: number; column: number } }
  }>
  edges: Array<{
    kind: 'emits' | 'restores' | 'references'
    declarationId: string
    outputPointer: string
    targetRef?: string
    restoreFamily?: string
  }>
  exclusions: Array<{ pointer: string; reason: string }>
}
```

`emits` maps a native TypeSpec declaration to an output pointer. `restores`
maps the declaration that supplied versioned extension metadata to the pointer
changed by restore. `references` maps the source declaration/pointer to the
literal OpenAPI `$ref` target. A declaration and an output pointer are both
many-to-many: one model can occur in several schema positions and an operation
can have native and extension-owned edges.

`exclusions` are not a percentage escape hatch. They are only for documented
emitter-synthetic pointers that have no declaration owner; each one needs a
stable reason, focused fixture, and review. A new exclusion fails CI until it
is explicitly approved in the versioned artifact schema or ownership guide.

## Phase 0 — feasibility spike (blocking design gate)

**Question:** can the pinned `@typespec/compiler` / `@typespec/openapi3`
toolchain expose stable semantic symbols and source locations at emitter time?

1. Build a throwaway companion emitter or compiler-host integration against the
   exact lockfile versions, rather than inferring ownership by YAML names.
2. Demonstrate mappings for one model, one cross-file model reference, one
   operation, and one response component.
3. Re-run after adding comments and blank lines. Semantic ids must remain
   stable; source ranges may change.
4. Record the API surface and its version-stability assessment in this plan or
   a small ADR before committing artifact v1.

**Exit criteria:** the spike emits four correct mappings without parsing
emitted YAML heuristically. If the TypeSpec emitter cannot provide this, stop
the implementation and decide explicitly between a maintained companion
emitter integration and a narrowly scoped, versioned source annotation. Do
not ship guessed declaration-to-pointer links.

## Phase 1 — artifact generation and structural validation

Add a provenance builder around `checkTypeSpecBundle` so it observes the
emitted document, extension-derived compatibility sidecar, restored document,
and the parser's `resolveRefGraph` result in one run.

The validator must fail for the following invariant violations:

| Invariant | Required result |
|---|---|
| Artifact binding | manifest/source/toolchain/restored-document hash mismatch fails closed |
| Pointer existence | every `emits`/`restores` output pointer exists in restored OpenAPI |
| Ref resolvability | every `references.targetRef` appears in the restored `$ref` graph and has no resolution diagnostic |
| Public ownership | every operation and reusable component in the declared support boundary has an owner or an explicit exclusion |
| Ref coverage | every `$ref` under `paths` and `components` has an owner for its source pointer and a resolved target |
| Extension conservation | each extension-derived sidecar entry has exactly one restore edge; restore-only `x-oa-sdk-*` metadata has no final-document edge |
| Determinism | identical input bytes and toolchain emit byte-identical sorted JSON; no timestamp or temporary path is included |

The initial public support boundary is operations, schemas, parameters,
responses, request bodies, and `$ref` nodes beneath `paths` and `components`.
It deliberately does not claim ownership for every synthetic scalar or every
nested emitted property in v1.

## Phase 2 — fixture and mutation coverage

Add a dedicated provenance fixture suite. Every fixture must assert both the
artifact edges and the restored OpenAPI result.

| Case | Required proof |
|---|---|
| Native model reference | cross-file model declaration emits component pointer; request/response `$ref` points to it |
| Operation | operation source maps to `#/paths/.../<method>` and its request/response schema uses are covered |
| Native composed/cyclic schemas | graph records each source/target edge without infinite traversal; parser reports intentional cycle behavior |
| v5 reusable parameter/response | extension declaration restores catalog pointer and operation `$ref` usage |
| Other restore family | example or security extension produces a restore edge even when it does not create a `$ref` |
| Import reachability | unreachable `.tsp` source has no declaration edge; imported source is included with its hash |
| Rename and formatting | symbol rename updates semantic id/output mapping; comment-only line shift updates only source range |
| Ambiguity | duplicate/ambiguous declaration identity fails before artifact is written |

Mutation tests are mandatory, because snapshot equality alone cannot prove the
new gate is meaningful:

- remove a component target or rewrite a `$ref`: parser/ref-coverage failure;
- drop a provenance edge: public-ownership or ref-coverage failure;
- point a restore entry at a wrong operation index/status: restoration and edge
  conservation failure;
- reuse an artifact after source, toolchain, or restored OpenAPI changes: hash
  binding failure;
- leave `x-oa-sdk-*` metadata after restore: extension conservation failure.

## Phase 3 — production shadow gate

Run the generator over `packages/schemas/typespec/` in `schema:typespec-check`
but initially report a machine-readable summary without failing existing PRs.

The summary must list:

- totals by declaration kind and edge kind;
- all exclusions with pointer and reason;
- uncovered public operations/components/$ref source pointers;
- extension families, restore edges, and unmatched restore entries;
- source file, line/column, output pointer, and `$ref` target for each failure.

Before enabling enforcement, establish a reviewed zero-unexpected baseline for
the production bundle. There is no broad coverage-percent threshold: all
in-scope public operations, reusable components, and `$ref` nodes must be
covered; only explicit exclusions may remain.

## Phase 4 — blocking CI and Spec Lens adoption (implemented)

1. Add `pnpm schema:typespec-provenance-check` to run the production validator.
2. Make the command blocking in the TypeSpec production migration CI section
   after the shadow baseline is clean and the fixture/mutation suite is green.
3. Change Spec Lens snapshot provenance from `unavailable` to `available` only
   when the artifact is present, hash-bound, and valid. Older revisions retain
   the current `typespec-source-files` fallback and must not be presented as
   declaration-level traceability.
4. Surface provenance in PR diff tooling: a changed OpenAPI pointer reports its
   owning TypeSpec symbol and extension restore source; an unowned pointer is a
   failed check, not a guessed attribution.

The implementation stores `typespec-source-ast` entries in new historical
snapshots and uses them for the Spec Lens graph, timeline provenance diff, and
path index. The path-item entry is derived from its owned operation pointer;
it is an indexing convenience, not an emitter-native source-map claim. Legacy
snapshots without the artifact retain `typespec-source-files` source evidence
and do not create pointer-level nodes or path rows.

## Implementation ownership and commands

| Area | Primary location | Change |
|---|---|---|
| Compile/restore integration | `packages/codegen/src/cli/lib/typespec-bundle-check.ts` | invoke generator and validator after restore |
| Artifact/domain logic | new `typespec-ref-provenance.ts` plus focused tests | schema, deterministic serialization, invariants |
| `$ref` authority | `packages/parser/src/ref-graph.ts` | reuse existing graph; do not reimplement resolver logic |
| Extension attribution | `typespec-oa-sdk-extensions.ts`, sidecar restore code | expose restore entry source/target evidence |
| Production gate | `scripts/schema-typespec-check.ts`, root `package.json`, CI | shadow then blocking command |
| Historical view | `packages/spec-lens/.../typespec-bundle-snapshot-builder.ts` | store valid artifact and only then report availability |

Required validation before each phase lands:

```bash
pnpm --filter @oa-sdk/codegen test
pnpm --filter @oa-sdk/parser test
pnpm schema:typespec-check
pnpm schema:validate
pnpm schema:downstream-check
pnpm check:feature-tests
pnpm check:docs
```

Each phase is separately reviewable and commit-friendly: artifact schema and
fixture first, production shadow report second, CI enforcement third, and Spec
Lens presentation last. No phase may modify `approved.openapi.yaml` directly.
