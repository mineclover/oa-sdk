---
"@oa-sdk/parser": patch
"@oa-sdk/codegen": patch
"@oa-sdk/mock-server": patch
---

@oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes. `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now also indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions. These changes only affect documents that still contain Reference Objects after the pass pipeline, such as custom pass lists or unresolved external refs. In those documents, local references at operation positions (Path Item, parameter, requestBody, response, callback) are now resolved with sibling overlay; before, they were dropped or left in place. An `additionalOperations` entry that repeats a fixed-field method is now ignored.

@oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses without deref, so its output changes for specs with local operation-position references:

- A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`.
- Operations behind a Path Item `$ref` in `paths` or `webhooks` now get operation types.
- A `description` beside a parameter `$ref` now overrides the referenced description.

With local references, the generated `types.ts` now declares every operation type that the generated client imports.
