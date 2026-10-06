# @oa-sdk/codegen

## 0.9.0

### Minor Changes

- `oa-gen init` writes `@oa-sdk` dependency specifiers the project can install: `workspace:*` only when the project and the package are members of the same pnpm workspace, otherwise the range of the release this codegen was built against (`^<version>`). `@oa-sdk/personas`, which is private, is added only inside a workspace that contains it, and `init` says when it leaves it out.
- `oa-gen init` lists the companion packages its scaffold needs (`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`). `mock`, `generate:client`, `pack:client`, `generate:tanstack`, and `oa-gen generate` for explicitly enabled outputs exit with an install command pinned to the companion versions this codegen was built against instead of silently skipping the output.
- `oa-gen init` then reports every `@oa-sdk` entry of package.json that the project cannot install where it lives, with what to do about it, instead of leaving it unreported or printing "not added" for it. A `workspace:` entry outside a pnpm workspace that has the package, such as one an earlier `init` wrote, is to be replaced with the range `init` prints (`--force` does this for the packages `init` writes). `@oa-sdk/personas` outside a workspace that has it is to be removed whatever its specifier: no registry has it, and `--force` leaves the entry in place because `init` no longer writes it.
- `oa-gen mock` runs without `msw`, an optional peer of `@oa-sdk/mock-server` that neither the package manager nor `oa-gen init` installs. It loads the root of `@oa-sdk/mock-server`, which does not load the MSW adapter: that adapter imports `msw` and is exported only from `@oa-sdk/mock-server/adapters/msw` and `@oa-sdk/mock-server/browser`. While the root still re-exported it, `oa-gen mock` failed on a clean install with `Cannot find package 'msw'`.
- Without `--tsp` and `--spec`, `oa-gen mock` serves the spec target of the project configuration, compiling a `.tsp` schema entry as `--tsp` does. The `mock` script that `oa-gen init` adds (`oa-gen mock --watch`) now starts a server; before, it exited 1 asking for `--tsp` or `--spec`. A configuration with several spec targets, or none, still needs one of the options.
- `oa-gen validate` without `--spec` reads the spec targets with their configuration defaults, as `oa-gen generate` does. A target without `profile`, which `oa-gen init` writes, is validated as a `full-api-document` instead of failing with `openapi-projection/invalid-profile`, so the `validate` script of an init scaffold passes, and `product.specs` is used when `specs` is absent.
- A TypeScript configuration written as an ES module, like the `oa.config.ts` that `oa-gen init` writes, loads in a project whose `package.json` has `"type": "commonjs"`, which `npm init` writes since npm 11. Node loaded the file as CommonJS, and every command that reads the configuration (`generate`, `validate`, `generate:tanstack` and the others) failed with "Cannot use import statement outside a module". Such a file is now transpiled to a temporary ES module first; a configuration written as CommonJS still loads natively.
- `oa-gen typegen --incremental` now reuses earlier output. Before, an incremental run parsed, generated and wrote everything again. typegen keeps one record per target (command, entry spec and output destination) in the SQLite workspace index (`--cache-dir`, default `./.oa-cache`) and skips regeneration when all of these are unchanged:

  - the installed versions of the generator packages (codegen, parser, core and yaml, plus `@typespec/compiler` and `@typespec/openapi3` for a `.tsp` entry);
  - `--style`;
  - every input the previous run consumed: the entry spec and every external `$ref` document by content (a document that was missing is recorded as absent, so creating it invalidates the target), and for a `.tsp` entry every file the TypeSpec compiler read, whether each path it probed while resolving imports was a file, a directory or missing, where links resolved, and the module graph of the JavaScript decorator libraries it loaded (authored modules by content and import resolution, installed packages by their `package.json`, failed optional imports by the candidates Node checked);
  - the output: a file output must still exist with the recorded hash. A stdout output and the warnings of the recorded run are replayed from the record.

  A reused run does not parse or compile the spec and leaves the workspace index unchanged. Every incremental run prints one status line on stderr: `incremental: typegen up to date, regeneration skipped (<output>)` or `incremental: typegen regenerating (<reason>)`. An input that may have changed while typegen generated, or that a run cannot check again, is recorded as unverified and makes the next run regenerate (`input not verified: <path> (<reason>)`); before Node.js 22.15, a target with authored JavaScript decorators therefore regenerates every time. Files that decorator code reads by itself are not tracked. When the SQLite index is unavailable, typegen regenerates (`incremental state unavailable`).

  The records live in two new workspace index tables, `generation_targets` and `generation_target_observations`. They are additive: the index schema version is unchanged, older readers ignore them, and a compatibility reset clears them with the rest of the cache.
- `oa-gen typegen` and `oa-gen validate` without `--incremental` no longer scan the entry spec for a workspace index they do not use.
- New `oa-gen surface --spec <openapi|typespec>` builds the target-neutral surface IR of the new `@oa-sdk/surface-ir` dependency and writes `surface-ir.json`, the Forge projection, one OpenAPI Overlay per top-level Forge command and `surface-manifest.json` to `--out-dir` (default `artifacts/surface/forge`). It accepts `--target forge` (the only target), `--mapping <json|yaml>` for operation group, method, lifecycle and CLI overrides, and `--fail-on-warning`.
- Normalization (`normalizeOpenApiDocument()`, `oa-gen normalize`, `oa-gen collect`) handles a node that the input shares at several locations, for example through YAML aliases, at every location: noise removal and key ordering apply at each, and the output keeps the input's sharing, cycles included. Before, only the first location was normalized. `upgradeOpenApiDocumentTo32()` (`oa-gen upgrade`, `oa-gen collect`) reports a conversion at every location of a shared container instead of only the first.
- `zodToSchema()` expands only the root of a conversion and emits `$ref: '#/components/schemas/<name>'` for every registered schema below it, so its result no longer depends on earlier conversions or on component order. A registered schema used at several locations is referenced at each instead of being inlined at the first, and `generateComponents()` and `adaptZodSchemas()` no longer emit a self-reference such as `Id: { $ref: '#/components/schemas/Id' }` for a component first met inside another one.
- TypeSpec reference provenance attributes emitted enum components to their `enum` declarations.
- Faster startup and generation: the TypeSpec compiler and TypeScript load only in the commands that use them, `oa-gen generate` parses each projected spec once, and `audit:csp` skips files that cannot violate its rules.
- `oa-gen tsp diff` with a git ref that has no path (`--base origin/main --head HEAD`) reads the other side's repository-relative entry point from its own commit. Before, it re-read the base extraction, compared the base with itself, printed "No semantic changes detected" and let `--fail-on-breaking` pass. When the entry point cannot be determined (missing from that commit, or several `main.tsp` files), the command fails and asks for `<ref>:<path>`; when both sides resolve to the same commit and entry point it says so on stderr. Symbolic links in a working-tree entry keep their names, so each commit resolves them itself; a `<ref>:<path>` or committed link that leaves the repository is rejected.
- `oa-gen drift`, `oa-gen drift:live` and `oa-gen review` accept relative paths. Before, a relative `--managed-openapi`, `--runtime-openapi` or `--base` exited 1 with `Invalid behavior record: ... must match between input and target` even when nothing differed. Relative paths resolve from the project root, and reports and behavior records hold absolute paths. A missing or doubled runtime source is reported as a usage error.
- `oa-gen generate` honors `outputRouting.pruneOrphans: false` and, with pruning on, deletes only orphaned files its own runs recorded in `.oa-manifest.json` for the same configuration file (or, with `--spec`, the same spec file). It no longer deletes `oa-gen generate:tanstack` output or files from other configurations or spec files. Manifest records gain optional `producer`, `configFile`, `specFile` and `target` fields (records from before 0.9.0 are attributed to configuration runs by spec target id), `OaManifestManager.writeArtifacts` records `producer: "unspecified"` when none is given, and the new `PruneOrphansOptions.scope` limits what a `pruneOrphans` call may delete.
- `oa-gen generate` exits 1, writing no files and leaving `.oa-manifest.json` unchanged, when an output the configuration turns on explicitly (`core.contracts.pureHandlers: true`, `core.client.enabled: true`) throws during generation. An output that is only on by default is skipped with a warning naming the error. The summary counts operations instead of paths and prints the version the document declares (for example `OpenAPI 3.2.0`) instead of a fixed "OpenAPI 3.1"; the schema pipeline report header does the same, and `SchemaPipelineTransparencyManifest.stages.stage3_openApi31.specVersion` is now a `string` holding the projected documents' versions.
- `oa-gen init` writes only scripts that run as written. Every target gets `generate` and `mock`, and `mvp` adds `validate`. The `generate:router`, `generate:client` and `generate:contract` aliases are gone (they only ran `oa-gen generate`); `microservice` no longer adds `test:contract` or `audit:wire`; `enterprise` replaces `diff`, `ci:gate`, `lint:spec`, `audit:csp`, `audit:shape` and `personas:check` with `lint:spec`, `diff`, `baseline:update` and `ci:gate` on the spec entry point, compared against a committed `openapi.baseline.yaml` that init creates with `oa-gen normalize` and never overwrites. On a package.json from an earlier init, init lists each retired script that still has the earlier command, with the reason and what to do (`InitResult.retiredScripts`). An upper-case `.yaml`/`.yml`/`.json` spec extension is recognized.
- `oa-gen normalize` reads TypeSpec (`.tsp`) specs. `oa-gen normalize` and `oa-gen diff` copy in the files a spec's `$ref`s name, so a breaking change in a referenced file fails `diff --fail-on-breaking`, and `oa-gen diff` compares the operations of a `paths` entry that is a `$ref` to `#/components/pathItems/...`.
- `oa-gen generate`, `oa-gen generate:tanstack` and `oa-gen mock` resolve the `$ref`s of a spec that point into other files (`./schemas.yaml#/Health`, `./paths/user.yaml`) from the spec file, as `oa-gen generate:client` does, before the router, client and mock-server companions read the spec, and `oa-gen generate` looks for CRDT entities in the resolved schemas. Before, the companions received those references unresolved and rejected the spec (`requires complete $ref resolution; received a partial ParsedDocument: unsupported-ref (./schemas.yaml#/Health)`), so these commands produced no handler contracts, client SDK, TanStack Query options or mock server for a spec split across files, and `generate` left out the four CRDT modules, without a warning, for a CRDT entity whose `components.schemas` entry is a `$ref` to its schema in another file. A `$ref` that still cannot be resolved, such as one to a missing file or a cycle of references, fails the same way, and the error names it with its diagnostic code (`external-ref-read-failed (./missing.yaml#/Health)`, `ref-cycle (./a.yaml#/A)`); `generate` exits 1 for an output the configuration turns on explicitly. The new `oa-gen surface` resolves them the same way before it builds the Surface IR, so the operations of a path item in another file are projected, and exits 1 with the `surface-ir/incomplete-document` error when one cannot be resolved. The `<id>.openapi.json` and `<id>.schema.json` that `generate` writes keep the `$ref`s as the spec writes them, relative to the spec file.

### Patch Changes

- b4f5dd4: @oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes.

  These changes apply to every document, including fully dereferenced ones on the default pipeline:

  - `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions onto route entries.
  - In both `loadSchema()` and `parseDocument()`, an `additionalOperations` entry is now ignored when it repeats a method that the same Path Item defines as a fixed field. The method names are compared case-insensitively. Code generated from `parseDocument()`, such as typegen output and generated clients and routers, no longer includes that entry.

  The following changes only affect documents that still contain Reference Objects at operation positions (Path Item, parameter, requestBody, response, callback) after the pass pipeline. What happens to them depends on whether a pass of the pipeline resolves `$ref`s. `SpecPass` has a new optional `resolvesRefs` flag for this. `createDerefPass()` sets it, so `derefPass`, the default passes and the deref pass that `parseDocument()` builds from its options have it. Set it on a custom pass that resolves references, for example one that wraps `derefSpec()`.

  Before this change, the two entry points handled such references differently, whatever the pipeline:

  - `parseDocument()` resolved a parameter or response `$ref` one hop against the entry document, without `summary`/`description` overrides, and dropped it when that hop found no object. It dropped requestBody `$ref`s and every Path Item that has a `$ref`, including the operations declared beside it. It kept callback Reference Objects as written.
  - `loadSchema()` returned parameter, requestBody, response and callback Reference Objects as written. Several `$ref` parameters collapsed into one entry under the merge key `undefined:undefined`. For a Path Item with a `$ref`, it indexed only the operations declared beside the `$ref`.

  With a pass that resolves `$ref`s, a reference left at an operation position is one the pass could not resolve, such as an external file without `basePath`, a missing target or a cycle. Route entries now omit it.

  - The reference keeps the spelling of the file it was written in. With `basePath`, that can be an external file that the pass inlined, so resolving it against the entry document could return an unrelated object with the same pointer.
  - This includes the default pipeline. `loadSchema()`, which `@oa-sdk/mock-server` re-exports, no longer returns Reference Objects in `parameters`, `requestBody`, `responses` or `callbacks`, and `parseDocument()` no longer returns callback Reference Objects. To detect references that stayed unresolved, check `parseDocument(...).resolution`: its status is `partial` and its diagnostics list the unresolved `$ref` values.
  - Fields declared beside a Path Item `$ref` that could not be resolved still apply.

  Without such a pass, for example with a custom pass list like `[]`, local references at operation positions are now resolved by following the reference chain, and the overrides below apply.

  - At parameter, requestBody, response and callback positions, the `$ref` is an OAS 3.2 Reference Object. Only a `summary` or `description` beside it overrides the target, and only when the target's object type defines that field: `description` for parameters and request bodies, both for responses, neither for callbacks. Other sibling fields are ignored.
  - Fields declared beside a Path Item `$ref` overlay the referenced Path Item.
  - A reference that cannot be resolved locally (an external file, a missing target, a cycle) is omitted at parameter, requestBody, response and callback positions.
  - When a Path Item `$ref` chain cannot be followed to its end, the fields declared beside every `$ref` up to the failing hop still apply, and the outermost wins. The deref pass keeps the same fields, so both pipelines index the same operations.

  References that the default pipeline's deref pass resolves are not affected by these changes. That pass resolves them before indexing and still merges every sibling field into the target.

  `derefSpec()`, `DerefFolder` and the deref pass, which `@oa-sdk/mock-server` re-exports, now dereference the fields beside a `$ref` they cannot resolve, as `derefInternalSpec()` already did. The `$ref` itself stays as written. Before, the whole object was kept as written, so, for example, the operations declared beside an unresolvable Path Item `$ref` kept their own parameter, requestBody, response and callback references unresolved. Inside an external file, those fields resolve against that file.

  @oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses with `parseDocument(spec, [])`. Its output changes in the following cases.

  Local references at operation positions:

  - A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`. Whether the body is required comes from the referenced request body.
  - A Path Item `$ref` in `paths` or `webhooks` now emits the operation types of the referenced Path Item.
    - Operations, `parameters` and other fields declared beside the `$ref` replace the referenced ones.
    - Operations declared beside a Path Item `$ref` that cannot be resolved, such as one into another file, are now emitted too. This includes the operations declared beside every `$ref` of a Path Item `$ref` chain whose later hop cannot be followed. Before, the whole Path Item was skipped.
  - A `description` beside a parameter `$ref` now replaces the referenced description in the generated JSDoc.
  - A parameter or response `$ref` whose target is itself a Reference Object is now followed to the final target. The parameter field and `<Op>Response` are now emitted.
  - A callback `$ref` is now resolved. Typegen emits no callback types, but nested component schema references inside the referenced callback, such as `#/components/schemas/Pet/properties/owner`, now get exported alias declarations. Inline callbacks already got them.
  - Other fields beside a Reference Object, such as `required`, `name`, `in`, `schema` or `content`, are still ignored and do not change the generated types.

  Other changes:

  - An `additionalOperations` entry that repeats a fixed-field method of the same Path Item no longer emits operation types.
  - An exported name that typegen numbered or renamed to avoid a collision can now refer to a different operation or schema. Typegen numbers operation types in sorted `operationId` order and nested schema aliases in sorted reference order, and it renames external schema aliases that collide with operation type names. The cases above add or remove operations and nested schema references, which changes those collisions. For example, when an ignored `additionalOperations` entry has an `operationId` with the same type name as the fixed operation, the fixed operation's types can lose their numeric suffix and take the names the ignored entry had.

  `generateTypesFromSpec()` from `@oa-sdk/codegen/typegen/browser` parses with the browser `parseDocument()`, which resolves internal references in memory before indexing. Of the changes above, only the `additionalOperations` rule, the operations beside an unresolvable Path Item `$ref`, and the resulting name changes affect it.

  For local references at operation level (a Path Item under `paths` or `webhooks`, and an operation's parameters, requestBody and responses) that carry no fields other than `summary` and `description`, the generated `types.ts` now declares the operation types that the generated client imports for them.

  The generated client and `types.ts` can still disagree in these cases:

  - References nested inside those objects, such as a response header `$ref` or an OAS 3.2 media-type `$ref` under `content`. Typegen does not resolve them, so the client can import `<Op>ResponseHeaders`, `<Op>Body` or `<Op>Response` without `types.ts` declaring it.
  - Operation-level references into other files, which typegen does not resolve either.
  - Fields other than `summary` and `description` beside a parameter, requestBody or response Reference Object. `generateClient()` parses with the default deref pass, which still merges every such field into the target, while typegen ignores them.
    - `in: header` beside a `$ref` to a query parameter makes the client import `<Op>HeaderParams`, which `types.ts` does not declare.
    - A `content` sibling that adds `application/json` to a request body without a JSON media type makes the client import `<Op>Body`, which `types.ts` does not declare.
    - `required: true` beside a parameter `$ref` makes the client reject calls without that parameter, while `types.ts` keeps it optional.

    This lasts until the deref pass applies only `summary` and `description` at Reference Object positions.

- Updated dependencies
- Updated dependencies
- Updated dependencies [b4f5dd4]
- Updated dependencies
  - @oa-sdk/core@0.3.1
  - @oa-sdk/parser@0.4.0
  - @oa-sdk/typespec-decorators@0.3.0
  - @oa-sdk/surface-ir@0.1.1

## 0.8.1

### Patch Changes

- Resolve 9 platform deficiencies across router envelope defense, handler error typing, AbortSignal pass-through, infinite queries, monorepo import resolution, RouterRenderOptions typing, unified oa-gen generate pipeline, init outputRouting presets, and Linux file watching fallback.

## 0.8.0

### Minor Changes

- - @oa-sdk/codegen: Add Output Path Routing Customization Engine (`outputRouting`), Target-Separated Interactive Onboarding Engine (`oa-gen init`), TanStack Query generation CLI (`oa-gen generate:tanstack`), and Live Mock Hot-Reloading (`oa-gen mock --watch`).
  - @oa-sdk/client: Implement TanStack Query (React Query) v5 3-Tier Generator (Tier 1 hierarchical query keys, Tier 2 pure options factories, Tier 3 client composition wrappers).
  - @oa-sdk/router: Implement multi-framework router stubs (Fastify JIT schema, Elysia zero-copy context, Hono, Express) and decoupled handler contracts (`*.contract.ts`).

## 0.7.0

### Minor Changes

- - @oa-sdk/core: Introduce recursive `JsonPrimitive<T>` and `Resolved<T>` wire-format types stripping methods, getters, and symbols to guarantee JSON wire safety.
  - @oa-sdk/parser: Add zero-decorator `@oaOperation <METHOD> <PATH>` JSDoc route extraction (`extractTsOperationsFromSource`, `extractTsOperationsFromFile`).
  - @oa-sdk/codegen: Implement OpenAPI 3.2 Schema Object to Zod 4 generator (`generateZodFromSpec`, `oa-gen generate:zod`) with automated preflight validation/normalization, and add `oa-gen audit:shape` CLI for 24-feature TypeScript shape taxonomy auditing.
  - @oa-sdk/client: Apply wire-safe response payload signatures using `Resolved<T>`.
  - @oa-sdk/spec-lens: Add transitive `tsconfig` universe dependency digestion (`computeTsconfigUniverse`) and SQLite cache key invalidation.

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.3.0
  - @oa-sdk/parser@0.3.0

## 0.6.0

### Minor Changes

- Harden public OpenAPI generation and release tooling. Core now exposes safe
  TypeScript literal helpers; parser adds OAS 3.2 querystring support and stricter
  reference handling; codegen improves generated client/type output and fails
  closed when TypeSpec export would lose contract-bearing semantics.

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.2.0
  - @oa-sdk/parser@0.2.0

## 0.5.0

### Minor Changes

- e0f2d5b: Prepare the OA Gen CLI and its runtime dependency closure (including the TypeSpec decorator
  library required by provenance tooling) for public npm distribution,
  including explicit package boundaries, Node runtime requirements, and a packed-artifact smoke test.

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/core@0.1.2
  - @oa-sdk/openapi-projection-contract@0.1.2
  - @oa-sdk/parser@0.1.2
  - @oa-sdk/typespec-decorators@0.1.2
  - @oa-sdk/client@0.1.1
  - @oa-sdk/router@0.1.1
