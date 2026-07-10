# Goal 66 — spec-lens TypeSpec observability and cache v2

**Status: phase 1 complete 2026-07-10; phase 2 in progress**

## Objective

Make the production TypeSpec bundle a first-class spec project identity while
ensuring that no snapshot, diff, timeline entry, or path read model can cross a
source, manifest/target, builder-version, or snapshot-schema boundary.

## Phase 1 safe milestone

Implemented in this slice:

- `SpecProjectConfig` is a discriminated `definition-builder | typespec-bundle`
  union. Legacy top-level `fragmentsDir` / `targetPath` resolves to the
  Definition Builder variant.
- `SpecProjectKey` hashes source kind, source root, manifest-or-target digest,
  builder version, and snapshot schema version.
- SQLite cache schema v2 uses `project_key` for snapshots, diffs, timeline, and
  path read models. An existing unscoped v1 DB is intentionally invalidated and
  rebuilt from Git history.
- Source adapters accept a project source kind. TypeSpec projects collect
  `.tsp`, `.json`, `.yaml`, and `.yml`; Definition Builder keeps the existing
  JSON/YAML policy.
- Snapshot build options are discriminated by project kind and builder
  selection is centralized. Snapshot storage has matching Definition Builder
  and TypeSpec bundle variants, so the next adapter does not need placeholder
  target/composition fields. The Definition Builder adapter remains active.
- A synthetic Git regression proves a commit that changes only `main.tsp`
  appears as a TypeSpec project revision candidate.

## Phase 2 handoff

Implement `TypeSpecBundleSnapshotBuilder` behind the existing builder-selection
boundary:

1. Reconstruct the bundle files for each selected revision in a temporary
   workspace.
2. Restrict compilation to the reviewed TypeSpec/OpenAPI emitter path.
3. Run compile, OA SDK extension/sidecar restore, validation, and expected diff.
4. Store the restored OpenAPI document as a `spec-lens.snapshot.v2` snapshot.
5. Add TypeSpec source provenance or an explicit unavailable-provenance state;
   do not fabricate Definition Builder canonical IDs.
6. Promote the TypeSpec bundle project to the default CLI/server target only
   after historical revision compilation and cache reuse tests pass.

## Acceptance evidence

- Project-key tests vary every identity field independently.
- SQLite tests prove snapshot, diff, timeline, and clear operations are isolated
  by project key and that a v1 DB is rebuilt as v2.
- Cross-project snapshot diff is rejected.
- Local Git tests prove multiple NUL-delimited revisions are retained and a
  TypeSpec-only revision includes `main.tsp` while excluding unrelated files.
- `pnpm --dir packages/spec-lens typecheck`, test, and build remain green.

## Risks

- Historical TypeSpec compilation can execute unreviewed emitter configuration;
  Phase 2 must restrict emitters and use an isolated temporary workspace.
- TypeSpec provenance does not match Definition Builder provenance. The UI must
  tolerate an explicit unavailable state until source mapping is designed.
- Rebuilding a long timeline is more expensive than migrating unsafe v1 rows,
  but invalidation is required because the missing project/compiler identity
  cannot be reconstructed reliably.
