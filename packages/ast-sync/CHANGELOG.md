# @oa-sdk/ast-sync

## 0.3.0

### Minor Changes

- 020ec12: Isolate API, data-only and interface pipelines with an optional shared purpose contract.
  Preserve previous output on plugin diagnostic failures and fail Vite startup builds correctly.
  Use standalone schema validation for plugin guards, align generated declaration names, provide
  self-contained guard types and reject conflicting schemas across targets. Add in-memory guard
  rendering for composition without disk writes. Existing configurations without purpose retain
  their mixed-pipeline behavior.

  Harden schema-name escaping, dollar-sign guard identifiers and split-file collision allocation
  (including case-insensitive filesystems). Reject custom declaration names without a matching
  external type module before replacing output.

## 0.2.1

### Patch Changes

- 3063402: TanStack options/keys now work for Vue and Svelte, streaming operations no longer emit unusable cache artifacts, and guard generation accepts dotted TypeSpec contract names.

  **@oa-sdk/client**

  - Tier 2 (pure query/mutation options) imports the framework-neutral `QueryObserverOptions`,
    `MutationObserverOptions` and `InfiniteQueryObserverOptions` types that every TanStack adapter
    re-exports from `@tanstack/query-core`, instead of React-only `UndefinedInitialDataOptions` /
    `UseMutationOptions`. `generate:tanstack --framework vue|svelte` output now compiles.
  - Streaming operations (SSE, NDJSON, JSONL, `application/stream+json` in the response or request
    body) keep their query keys but no longer generate `QueryOptions`, `MutationOptions` or hooks,
    because a `queryFn` returning an `AsyncGenerator` cannot be cached.
  - Infinite query options use a distinct key (`[...<listKey>, 'infinite']`). List and infinite
    caches with the same filters no longer collide, and invalidating the list key still matches the
    infinite entry by prefix.
  - `TError` for operations with a documented error model is now `<Op>Error | Error`, so transport
    failures (network errors, aborts, `ApiClientResponseError`) are part of the generated type.

  **@oa-sdk/codegen**

  - `generate:tanstack --split --tier options|hooks` emits the lower tiers the requested tier imports
    (`options` → keys + queries, `hooks` → keys + queries + hooks), so the output compiles.
  - `generate:tanstack --framework vue|svelte --tier hooks` fails with a clear error instead of writing
    React hooks against a Vue/Svelte package.
  - `check-artifact` and `drift:check` read targets through `resolveConfigWithDefaults`, so a config
    that declares only `product.specs` no longer fails with `specs 목록이 비어 있습니다`.
  - Added a regression test for pattern-based `outputRouting` with `--split`, resolving every generated
    relative import against the routed files.

  **@oa-sdk/ast-sync**

  - Standalone guards normalize component names that are not JavaScript identifiers (for example the
    TypeSpec namespace-qualified `OaSdkTypeSpec.StandardError` to `isOaSdkTypeSpec_StandardError`)
    while keeping the qualified type in the `data is ...` declaration. Split mode uses the normalized
    file name and imports the namespace root (`import type { OaSdkTypeSpec }`) because
    `import type { A.B }` is invalid TypeScript. `--schemas` matching accepts the original dotted name.

- f0edbd0: Make Interface Sketch parsing, trace graphs and the contract canary match the source they read. Review the items marked **behavior change** when upgrading.

  - `@oa-sdk/surface-ir` **behavior change:** `INTERFACE_SKETCH_IR_VERSION` is `oa-sdk.interface-sketch-ir.v2`. `InterfaceSketchIr` has a required `diagnostics: SketchDiagnostic[]` and `SketchUnionOrEnumIr` a required `members: SketchVariantIr[]`; `SketchModelIr` gains `templateParameters`, and `baseModel` also covers `extends` and keeps template arguments. `versionHash` values change. The parser is a tokenizer and recursive-descent scanner, so `extends`, templated and `is X;` models and bodies with nested braces are no longer dropped or truncated, and doc comments and decorators attach only to the declaration that follows them.
  - `@oa-sdk/codegen`: `emitSketchArtifacts` accepts a v2 or a v1 IR, upgrading the v1 one, and throws for any other version. Emitted OpenAPI refs point to `#/components/schemas/`, enums carry their values instead of their member names, unions become `anyOf`, undeclared types are tagged `x-oa-sdk-sketch-unresolved-type`, and the Python stub uses `@dataclass(kw_only=True)` (Python 3.10+) so it imports whatever the field order. `oa-gen sketch verify` and `check-contract` use the domain (`--domain`, else the file basename) as the spec name, so `versionHash` no longer depends on the machine, and `verify`, `emit`, `check-contract` and `compare` exit 1 when the IR has error diagnostics. The CLI governance manifest declares the sketch report schema `oa-sdk.interface-sketch-ir.v2`.
  - `@oa-sdk/codegen`: `oa-gen trace` links path-item-level `parameters` `$ref`s to every operation of the path, includes the generated `*PathParams`, `*QueryParams` and `*HeaderParams` symbols of `$ref` parameters, and reads `x-persona` arrays and object-shaped storage, behavior and DPM refs. **Behavior change:** `SpecTraceGovernanceCapabilities` has a required `personas: string[]` (`persona` is deprecated), and interface operation ids are qualified as `operation:<file>:<Interface>.<op>`, with a new `typespec-provenance/duplicate-declaration-id` diagnostic. The spec, provenance map and manifest inputs of `oa-gen trace` are validated, and `loadSpecTraceabilitySidecar` validates the whole sidecar.
  - `@oa-sdk/ast-sync`: `checkImplementationContract` counts a contracted name only when the file binds it. Comments, strings, call sites, property reads and plain imports of an operation no longer count. It honors `language` (`'auto'` detects Python), no longer treats TypeScript `#private` member lines as comments, and matches lock-reflex patterns only in code.

- e4e82a7: Shared `@traceId` variants are accepted as lineage, ast-sync type boundaries are modelled, and Fastify/Hono streaming is verified with the real frameworks.

  **@oa-sdk/typespec-decorators**

  - `@traceId` now emits `x-oa-sdk-trace.declarationId` next to `trackingId`. It is a hash of the
    declaration the application is written on, so visibility variants and `MergePatchUpdate<T>`
    clones (and shared parameter/anonymous types and derived scalars) carry the same evidence.
  - The `.tsp` documentation and README describe the shared-variant policy instead of listing it as
    a known defect that fails `oa-gen trace --verify`.

  **@oa-sdk/codegen**

  - `buildSpecTraceabilityGraph` accepts one explicit `trackingId` when every node has the same
    `declarationId`; an id shared by independent declarations, or without evidence, still reports
    `traceability/duplicate-tracking-id`.
  - The trace sidecar validator accepts the optional `declarationId` field.

  **@oa-sdk/ast-sync**

  - JSON Schema `read()`/`patch()` validate parsed input through `toJsonSchemaObject` /
    `parseJsonSchemaObject`; typia `@default` tags go through `parseJsonDefaultTag`.
  - Replaced the remaining explicit `any` escapes: TypeScript's internal `symbol.id` and declaration
    names have modelled accessors, virtual-program temp directories live in a `WeakMap` exposed by
    `getProgramTempDir`, and Ajv/standalone imports plus format validators are typed.

  **@oa-sdk/spec-lens-contract**

  - Added `customData?: Record<unknown>` to `ScenarioMachineContext` in `scenario.tsp`, matching the
    TypeScript interface, with a drift test.

  **@oa-sdk/router**

  - Added real Fastify 5.12 / Hono 4.12 streaming tests: `AsyncIterable`, Web `ReadableStream` and
    Node streams send with the declared content type, and client disconnects cancel the source
    iterator. Documentation now describes the verified behaviour instead of the retired defects.
