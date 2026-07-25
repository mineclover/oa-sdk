# Goal 66 — spec-lens TypeSpec observability and cache v2

**Status: complete 2026-07-10**

## Objective

Make the production TypeSpec bundle a first-class spec project identity while
ensuring that no snapshot, diff, timeline entry, or path read model can cross a
source, manifest/target, builder-version, or snapshot-schema boundary.

## Phase 1 safe milestone

Implemented in this slice:

- `SpecProjectConfig` is a discriminated `definition-builder | typespec-bundle`
  union. Legacy top-level `fragmentsDir` / `targetPath` resolves to the
  Definition Builder variant.
- `SpecProjectKey` hashes authoring kind, source root, manifest-or-target digest,
  builder version, snapshot schema version, and an observation identity made of
  adapter kind, credential-free repository/project coordinate, and branch/ref.
  TypeSpec identities also include the codegen-owned compiler/http/OpenAPI
  package versions, restore contract, and concrete resource policy.
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

## Phase 2 implementation

`TypeSpecBundleSnapshotBuilder` is active behind a kind-correlated builder
selection boundary:

1. Historical entries are path-validated and only the manifest, referenced
   compatibility/expected artifacts, and reachable relative `.tsp` sources are
   reconstructed in an isolated temporary workspace.
2. Revision `tspconfig.yaml` / `tspconfig.yml` is discarded. The official
   `@typespec/compiler/ast` parser must produce no parse diagnostics; only its
   top-level `ImportStatementNode` values are inspected. spec-lens writes an
   allowlisted `@typespec/openapi3` 3.2 config and accepts source package imports
   only from `@typespec/http`, `@typespec/openapi`, or source-root-contained
   relative `.tsp` files.
3. Codegen resolves compiler/http/openapi/openapi3 from its own dependency
   boundary, exposes only http/openapi/openapi3 in the temporary project, and
   runs its bound compiler CLI directly. Source entries are limited to 256,
   2 MiB each, and 16 MiB total; artifacts are limited to 32 MiB. Compile uses a
   60 second timeout, 256 KiB combined-output cap, 512 MiB V8 old-space cap, and
   process-tree termination. TypeSpec revisions compile serially. The existing
   bundle-check path then performs compile, OA SDK
   extension/sidecar restore, restored validation, and expected breaking-diff
   gates. The restored document becomes the snapshot spec.
4. TypeSpec snapshots record `provenance.status = unavailable` with reachable
   source-file hashes and compile evidence. Diff, path, and graph handlers never
   manufacture Definition Builder canonical IDs; graph returns source-file
   evidence and the path API returns an explicit `unavailable` envelope.
5. CLI/server configuration and UI wire types are discriminated unions. With no
   config, the production
   `packages/schemas/typespec/oa-sdk.typespec-bundle.json` is preferred over
   rollback Definition Builder targets.
6. Compile failures remain visible as `snapshotCached=false` timeline entries
   and refresh errors, while successful revision snapshots/diffs are reused.
7. A no-limit revision listing is authoritative. GitHub/GitLab paginate to
   exhaustion, local detached HEAD is pinned to its commit SHA, and refresh
   transactionally removes unreachable snapshots, diffs, timeline rows, path
   projections, and orphan blobs. Explicitly limited windows never prune.
8. TypeSpec source adapters require the codegen-owned
   `oa-sdk.spec-lens.source-read-budget.v1` policy before credentials, Git, HTTP,
   or filesystem content reads. The canonical ceiling is 256 files, 2 MiB per
   file, 16 MiB total, and four concurrent reads; stricter caller budgets are
   accepted, while upward overrides are rejected. Local Git and GitHub reject
   missing/invalid size metadata and preflight known sizes, GitLab bounds raw
   responses and tracks the running aggregate, and file-diff stats and
   realpath-checks candidates before bounded reads. Any TypeSpec read failure
   rejects the whole revision, and codegen reasserts the same limits before
   admission to AST parsing or compilation. GitLab treats `Content-Length` as
   untrusted for aggregate accounting: every body reserves the per-file ceiling,
   and the final body that cannot obtain a full reservation reads exclusively
   against the remaining capacity. A tracker-global byte-oriented EOF probe may
   consume exactly one detection byte past a file or aggregate cap; that byte is
   never admitted or stored. Failure aborts header-pending fetches, cancels active
   readers, rejects queued reads, and waits for workers to quiesce.

## Acceptance evidence

- Project-key tests vary every identity field independently.
- Observation identity tests prove different repository coordinates, adapter
  kinds, and refs produce different project keys; local Git resolves its real
  repository path and current branch.
- SQLite tests prove snapshot, diff, timeline, and clear operations are isolated
  by project key and that a v1 DB is rebuilt as v2.
- Cross-project snapshot diff is rejected.
- Local Git tests prove multiple NUL-delimited revisions are retained and a
  TypeSpec-only revision includes `main.tsp` while excluding unrelated files.
- Codegen tests cover official-AST triple/template parsing, scanner-bypass and
  unterminated inputs, source/artifact limits, process-tree timeout/output
  bounds, package isolation, a fake compiler, and a real production bundle.
- TypeSpec refresh tests cover TypeSpec-only revisions, timeline/diff writes,
  snapshot and diff cache reuse, explicit source evidence, and compile failure.
- Source-adapter tests cover the required budget boundary, stricter and upward
  override handling, file count/per-file/aggregate rejection, missing metadata,
  HTTP `Content-Length` and streamed-body caps, root-escaping symlinks, bounded
  concurrency, and whole-revision failure without partial success.
- SQLite decoding validates nested snapshot/diff payloads and selected revision
  correlation. Reconciliation tests cover force-push-style stale rows, removed
  paths, orphan blobs, and histories beyond SQLite's variable limit.
- UI/query tests distinguish TypeSpec provenance `unavailable` from an empty
  Definition Builder path set and keep project-kind/diff variants correlated.
- Closeout validation: codegen `718` tests and build; spec-lens `134` tests
  (`4` integration skips) and build; UI typecheck/test/build; TypeSpec schema
  freshness/restore gate; API-index check; frozen offline install; diff check.

## Risks

- TypeSpec output-pointer provenance remains unavailable. Source-file evidence
  is honest and query-safe, but precise path/component-to-`.tsp` mapping needs a
  future compiler source-map contract.
- Revision candidates include `project.sourceRoot` and declared bounded
  `observationInputs`. `candidate-only` inputs are discovery-only, while
  `evidence-only` inputs record a hash/status envelope without becoming a
  compiler input. A trusted historical toolchain registry remains future work.
- Rebuilding a long timeline is more expensive than migrating unsafe v1 rows,
  but invalidation is required because the missing project/compiler identity
  cannot be reconstructed reliably.
- AST parse CPU is bounded indirectly by the 2 MiB per-entry and 16 MiB
  aggregate source limits; there is no separate in-process parser deadline.
