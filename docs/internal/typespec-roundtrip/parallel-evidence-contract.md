# Parallel Evidence Contract

Status: review-evidence contract. It does not define an API authoring surface,
does not generate OpenAPI, and does not grant implementation analysis any
contract authority.

## Purpose

`oa-sdk.parallel-evidence.v1` joins independent provenance artifacts so a
reviewer can inspect the API contract and implementation structure together.
Its machine-readable transport schemas are
[`parallel-evidence.v1.schema.json`](./parallel-evidence.v1.schema.json) and
the baseline-capable
[`parallel-evidence-report.v1.schema.json`](./parallel-evidence-report.v1.schema.json).
The current adapters are:

| Source | Input artifact | Role |
| --- | --- | --- |
| TypeSpec | `oa-sdk.typespec-ref-provenance.v1` | `contract-authority` |
| ttsc | `ttsc-contract-provenance.v2` | `implementation-observation` |

The envelope always sets `contractAuthority: "typespec"` and
`purpose: "review-evidence-only"`. No consumer may use the envelope to write
TypeSpec, OpenAPI, snapshots, or code generation inputs.

## Metric contract and retention

Every envelope includes `oa-sdk.parallel-evidence-metrics.v1`. It is a
deterministic snapshot: it has no clock, run id, or mutable threshold. Persist
the JSON report in CI/artifact storage (or use `review-bundle --behavior-db`
for the selected summary metrics) when a time series is needed.

| Dimension | Metrics | Interpretation |
| --- | --- | --- |
| Pointer coverage | contract/implementation/union totals, matched count, three ratios | Scope alignment only; 0% is expected for unrelated repositories. |
| Declarations | total, emitting, and shape-annotated declarations | Producer breadth and whether ttsc has sufficient AST classification. |
| Relations | total and target-resolved counts per source | How much reference evidence can be connected to an emitted pointer. |
| ttsc shapes | `direct`, `policy-required`, `unsupported`, `unclassified`, feature histogram | Adoption research queue; never an automatic TypeSpec translation queue. |

Ratios are exact `[0, 1]` values, not rounded display percentages. A prior
`oa-sdk.parallel-evidence-report.v1` or metrics artifact can be supplied as a
baseline. The report emits one sorted numeric delta map; missing feature keys
are zero, so a newly observed shape is measurable without changing the schema.

## Join rule

The sole automatic join key is an exact OpenAPI JSON Pointer.

```text
TypeSpec declaration --emits/restores--> #/components/schemas/Widget
ttsc declaration     --emits----------> #/components/schemas/Widget
                                      \-> matched-pointer
```

Subjects are classified as follows:

| Status | Meaning | Review action |
| --- | --- | --- |
| `matched-pointer` | Both artifacts independently name exactly the same output pointer. | Compare the source declarations and implementation shape evidence. |
| `contract-only` | The public contract has no supplied implementation observation. | Check whether the implementation analysis scope is intentionally partial. |
| `implementation-only` | The implementation convention projects a pointer not present in TypeSpec evidence. | Treat as a mapping or ownership question; never create the contract from it. |

Equal pointers prove only identity of the review subject. They do **not** prove
that TypeSpec and TypeScript structural types are equivalent. Their raw artifact
hashes and source spans remain in the envelope for that reason.

## Relations and non-joinable evidence

The envelope preserves TypeSpec OpenAPI `$ref` relations and ttsc resolved
`type-ref` relations independently. A TypeScript property has no automatically
derived OpenAPI pointer unless its producer supplies one, so it remains a
relation anchored by its declaration id. This avoids false schema ownership
created from property-name or symbol-name heuristics.

ttsc `shape` evidence (`union`, `intersection`, `generic-instantiation`,
`utility-type`, `conditional`, and similar) is carried as an implementation
observation. Its `typeSpecProjection` is a review cue only:

- `direct`: candidate for TypeSpec-native authoring, still requiring emitted
  OpenAPI and provenance gates.
- `policy-required`: requires an explicit OA SDK authoring policy.
- `unsupported`: code-level structure, not an instruction to extend TypeSpec.

Generated TypeScript may represent an operation as a type alias rather than a
function. Such an alias is an operation only when its generator emits the same
explicit `/** @oaOperation METHOD /path */` annotation accepted for functions.
The extractor never infers an operation from a `*Op` suffix, a `method` field,
or a `path` field. The standard OA SDK type generator emits that annotation on
its operation bundle aliases.

## Invariants

1. There is exactly one contract authority: TypeSpec.
2. Every input artifact is identified by schema version, provenance kind, and a
   stable SHA-256 content hash.
3. Pointer joins are exact; aliases, names, and source paths are not fallback
   join keys.
4. Input order cannot change the ordered subjects or relations in the envelope.
5. A `matched-pointer` never upgrades ttsc evidence into a source of truth.
6. The normal TypeSpec restored-OpenAPI, provenance, API-version, and
   downstream gates remain authoritative; this envelope is additive review
   evidence.

## Integration boundary

The reference implementation is
`packages/codegen/src/cli/lib/parallel-evidence.ts`. It accepts an existing
TypeSpec provenance artifact and a structurally compatible external ttsc
artifact. Keeping the ttsc input structural, rather than importing the
`samchon` package, prevents either repository from becoming a build-time
dependency or an authority for the other.

Use this report in a PR/review bundle after both producer artifacts have been
generated:

```bash
oa-gen review-bundle \
  --base approved.openapi.yaml \
  --head candidate.openapi.yaml \
  --artifact candidate.openapi.yaml \
  --typespec-provenance .artifacts/typespec-ref-provenance.json \
  --ttsc-provenance .artifacts/ttsc-contract-provenance.json
```

The two provenance options are an all-or-nothing pair. The command writes the
derived envelope under `sections.parallelEvidence` in its JSON report and adds
a Markdown section, but it does not alter the review recommendation. Its
behavior record carries matched-pointer, coverage-ratio, relation-resolution,
and shape-classification summary metrics for a queryable SQLite/JSONL history.
Do not
add either producer artifact or the derived envelope to a TypeSpec bundle
manifest, approved OpenAPI snapshot, or a codegen write path.

For a durable, independently diffable metric snapshot, run the dedicated
command and store its JSON output in the CI artifact store:

```bash
oa-gen parallel-evidence \
  --typespec-provenance .artifacts/typespec-ref-provenance.json \
  --ttsc-provenance .artifacts/ttsc-contract-provenance.json \
  --baseline .artifacts/parallel-evidence.previous.json \
  --format json > .artifacts/parallel-evidence.current.json
```

The command has no failure threshold: coverage is a measurement and an input
to an explicit review policy, not a second contract gate. A team may compare
the persisted delta against a separately versioned policy, but must not use it
to synthesize a TypeSpec or OpenAPI change.
