# @oa-sdk/typespec-decorators

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
