# @oa-sdk/typespec-decorators

## 0.5.0

### Minor Changes

- Publish the `./tool-pipeline` TypeSpec entrypoint and its generated runtime
  surface as a public package export.

## 0.4.0

### Minor Changes

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

- f0edbd0: Validate `@chunkStream`, `@traceId` and the wire decorators the way their documentation says. Review the items marked **behavior change** when upgrading.

  - `@chunkStream` honors the `targetChunkBytes`, `maxResidentBytes` and `maxL1MemoryBytes` overrides and emits `maxL1MemoryBytes` (default half of `maxResidentBytes`) after `maxResidentBytes` in `x-oa-sdk-chunk-stream`. **Behavior change:** a wrongly typed or out-of-range numeric or string option, or an options argument that is not an object, reports `invalid-chunk-stream-rule` and emits no extension instead of silently falling back to defaults, so such specs no longer compile.
  - **Behavior change:** `@traceId` puts `x-oa-sdk-trace.trackingId` on the declaring type and on the clones TypeSpec's mutation engine makes of it, so `@versioned` services and `MergePatchUpdate<T>` variants compile and carry the id in every per-version document, where they used to report Duplicate traceId. Derived copies (`model B is A`, `op b is a`, operations cloned by `interface B extends A`, spread copies and template instances, `@friendlyName` ones included) compile without an id; `model B is A` and template instances used to fail with Duplicate traceId. A template instantiated once no longer carries the template's id.
  - `@rpc` and `@wireFormat` on an interface apply to each of its operations (operation values win), and `@protobuf` or a `methodName` on an interface reports a diagnostic instead of compiling and emitting nothing. `$onValidate` reports duplicate `@field` numbers; a property that redeclares an inherited one, such as a narrowed discriminator, replaces it and is not reported.
  - `@oa-sdk/typespec-decorators/governance` exports `verifyAtlasSchemaDrift`, `AtlasSchemaInspectOutputSchema` and the drift report types. There is no `./storage-drift` subpath.

## 0.3.0

### Minor Changes

- Add the `@crdt` and `@crdtEntity` decorators for CRDT contract specification.
  - `@crdt(options)` on a model property emits `x-oa-sdk-crdt`. `type` is required (`lww-register`, `pn-counter`, `or-set`, `text-sequence` or `flag`); `resolution`, `engine` and `role` are optional. An unknown value is reported as `invalid-crdt-rule`.
  - `@crdtEntity(options)` on a model emits `x-oa-sdk-crdt-entity` with `partitionKey`, `timeRange`, `compaction` and `strategy`. An unknown `compaction` is reported as `invalid-crdt-entity-rule`.
  - The accepted values are exported as `VALID_CRDT_TYPES`, `VALID_CRDT_RESOLUTIONS`, `VALID_CRDT_ENGINES`, `VALID_CRDT_ROLES` and `VALID_CRDT_COMPACTIONS`.
- Add standard HTTP contracts in `lib/contracts.tsp`. `lib/main.tsp` imports it, so `import "@oa-sdk/typespec-decorators"` loads them together with the decorators: `Ok<T>` (200), `Created<T>` (201), `NoContent<T = void>` (204, no body), the `PageResult<T>` body model (`items`, `total`, `page`, `limit`), `ErrorResponse<Status>` with a `StandardError` body, `StandardError`, `StandardValidationError`, and the `StandardHttpErrors` alias for `ErrorResponse<400> | ErrorResponse<401> | ErrorResponse<403> | ErrorResponse<404> | ErrorResponse<500>`.
  - They are declared in namespace `OaSdkTypeSpec`, next to the decorators, so `using OaSdkTypeSpec;` brings both into scope. There is no `OaSdkContracts` namespace. The OpenAPI emitter names the error schemas `OaSdkTypeSpec.StandardError` and `OaSdkTypeSpec.StandardValidationError`.
  - When upgrading from 0.2.0: a file that has `using OaSdkTypeSpec;` and also `using`s another namespace that declares one of these names now gets an `ambiguous-symbol` error where it references the name. Use the fully qualified name. A declaration in the namespace that contains the reference still takes precedence.
- The package now depends on `@typespec/http` `^1.16.0`, which the contracts use, and requires `@typespec/compiler` and `@typespec/openapi` `^1.16.0` instead of `^1.13.0`.

## 0.2.0

_Reconstructed from the repository history: 0.2.0 was published to npm on 2026-09-11 from source revision 0f69f47a without a changeset, so it had no entry here._

### Minor Changes

- Add `@personaCapability(...traits)` for operations. Each trait must be one of the standard persona capability traits from `packages/personas/src/traits/skill.yaml` (exported as `VALID_PERSONA_TRAITS`); an unknown trait is reported as `invalid-persona-trait`. The decorator merges the traits of repeated uses, sorts them, and emits them as `x-oa-sdk-persona-traits`.
- Add `@pseudonymize(transform, role?, pii?, relationship?)` for model properties. It checks `transform` against `VALID_DPM_TRANSFORMS` and `role` against `VALID_DPM_ROLES`, enforces the DPM safety rules (SAF001: a `direct_identifier` cannot use `keep`; SAF002: a `pii` `foreign_identifier` needs `relationship`; SAF010: a `pii` field cannot use `keep`), reports violations as `invalid-pseudonymize-rule`, and emits `x-oa-sdk-dpm-projection`.
- Export `reportDiagnostic`, `VALID_PERSONA_TRAITS`, `VALID_DPM_TRANSFORMS` and `VALID_DPM_ROLES`.

## 0.1.2

### Patch Changes

- e0f2d5b: Prepare the OA Gen CLI and its runtime dependency closure (including the TypeSpec decorator
  library required by provenance tooling) for public npm distribution,
  including explicit package boundaries, Node runtime requirements, and a packed-artifact smoke test.
