# Type Registry governance

Status: active internal governance contract

Owner: OA SDK maintainers

The Type Registry is evidence about the workspace's TypeScript contract. It is
not a second authoring source. Handwritten production TypeScript remains the
authority, generated TypeScript is derived, and declaration files are build
observations.

## Operating model

`pnpm type-registry:check` performs one deterministic pipeline:

1. Read package export maps under the policy's workspace roots.
2. Discover production `.ts`, `.tsx`, `.mts`, `.cts`, and source `.d.ts` files
   in lexical order. Policy-defined test, fixture, build, dependency, and ignored
   generated-output paths are excluded so a clean checkout and a developer tree
   produce the same reviewed baseline.
3. Classify each artifact before extraction:
   - handwritten source: `origin=handwritten`, `role=authority`;
   - `*.generated.ts` or a generated directory: `origin=generated`,
     `role=derived`;
   - source declaration files: `origin=generated`, `role=observation`.
4. Map runtime export targets back to their source authority. Manifest `types`
   targets are recorded as declaration observations, but `dist/*.d.ts` is not
   treated as source authority and is not required in a clean checkout.
5. Run `extractTypeRegistryFile` for each source/runtime/export-key view, then
   `replaceTypeFileIndex` in the SQLite workspace index. Files no longer in the
   scan are invalidated. The default database is isolated under the system
   temporary directory and is deleted after the run; `--db` enables an
   explicitly reusable local index.
6. Atomically write canonical local evidence to
   `.oa-sdk/type-registry/{snapshot,report}.json`.
7. Compare declaration identities and separately report syntax, shape, and
   semantic hash changes against the reviewed baseline.
8. Evaluate public reexports, runtime-conditioned export parity, and boundary
   budgets.

The check fails for baseline drift, a missing baseline, an expired/invalid
allowlist, an unresolved public reexport, a runtime export mismatch, or a
boundary rule that grew against the baseline.

## Commands

```bash
# Read-only with respect to source and the reviewed baseline.
pnpm type-registry:check

# Focused implementation tests.
pnpm test:type-registry-governance

# After reviewing local snapshot/report and the source change.
pnpm type-registry:write
```

`--write` is the only mode that replaces
`docs/internal/type-registry-baseline.json`. The replacement is atomic and is
refused while any policy gate fails. A normal check can update ignored local
evidence, but cannot edit source, policy, or the baseline.

Useful options are `--policy`, `--baseline`, `--output-dir`, `--db`, and
`--no-output`. Run `pnpm type-registry:check -- --help` for the complete CLI.

## Reviewed changes

The declaration diff has independent buckets:

- `syntaxChanged`: normalized TypeScript tokens changed;
- `shapeChanged`: structural type shape changed;
- `semanticChanged`: resolved canonical meaning changed;
- `added` / `removed`: the stable declaration identity entered or left the
  registry.

Policy-hash and resolved public-surface changes are also baseline drift even
when declaration hashes are unchanged. This keeps export-map and budget edits
inside the same explicit review flow.

A change can appear in more than one bucket. Review semantic and shape changes
as public contract candidates, then inspect syntax-only changes for deliberate
authoring changes. The baseline must be updated in the same change only after
the report is reviewed.

## Policy and budgets

The machine-readable policy is
`docs/internal/type-registry-policy.json`. It owns:

- workspace roots and scan exclusions;
- generated-source classification patterns;
- boundary rules for explicit `any`, double assertions, and deserialization that
  is not immediately passed to a named validator;
- narrowly scoped false-positive allowlist entries.

Boundary rules are per-file ratchets against the reviewed baseline, not numeric
budgets. The gate counts each rule per source file (after the allowlist) and
compares it with the same count recorded in the baseline:

- a file may keep or reduce its count; a reduction needs no policy or baseline
  edit, and `check` reports it as `resolved` so the next `--write` locks it in;
- a file whose count grows, or a new file that introduces a boundary, fails the
  gate even when another file shrank by the same amount;
- to accept a deliberate increase, review it and run
  `pnpm type-registry:write -- --allow-increase`. The new floor is the baseline
  diff in the same change; the flag is rejected without `--write`.

A rule may still carry an optional `maximum` as an absolute workspace-wide cap.
It is not needed for the ratchet and is not set in the committed policy.
Moving or renaming a file reads as growth in the new path until the baseline is
rewritten.

When a ceiling or ratchet fails:

1. `boundary:any`: model the value, use a narrow generic, or accept `unknown`
   and validate it.
2. `boundary:double-assertion`: remove the cast chain or introduce a runtime
   validator at the boundary.
3. `boundary:unvalidated-deserialize`: pass parsed data through a named schema
   validator before assigning a domain type.
   The detector counts calls that read data (`JSON.parse`, `decode`, and
   `.json()` without arguments such as `response.json()`). A `.json(value)` call
   with an argument builds a response, so it is not a boundary.

## Allowlist accountability

An allowlist entry is for a proven false positive, not for type debt. Every
entry must include all of the following or the policy is rejected:

```json
{
  "id": "stable-unique-id",
  "rule": "boundary:any",
  "filePath": "packages/example/src/adapter.ts",
  "owner": "team-or-person",
  "reason": "Why the detector is wrong and what evidence was reviewed.",
  "expiresOn": "2026-12-31"
}
```

Optional selectors are `boundaryId`, `packageName`, and `exportKey`.
`filePath` accepts the policy's simple `*`, `**`, and `?` patterns. Expired
entries fail the gate; active but unused entries are reported so their owners
can remove them.

## Public export remediation

- For `unresolved-public-reexport`, repair the relative target or add the
  target package/subpath to its actual export map. Do not silence a missing
  module with a declaration-only shim.
- For `runtime-export-mismatch`, reconcile the type surface of conditional
  `browser`, `bun`, `node`, and fallback targets for the same export key, or
  document a time-bounded detector false positive with an accountable owner.
- Resource exports such as OpenAPI JSON or persona YAML are observations, not
  TypeScript runtime/type authorities.

CI should run `pnpm type-registry:check` after dependency installation. Local
snapshot/report files are diagnostic evidence; the reviewed baseline and
policy are the committed governance inputs.
