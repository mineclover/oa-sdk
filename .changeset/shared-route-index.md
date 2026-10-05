---
"@oa-sdk/parser": patch
"@oa-sdk/codegen": patch
"@oa-sdk/mock-server": patch
---

@oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes.

These changes apply to every document, including fully dereferenced ones on the default pipeline:

- `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions onto route entries.
- In both `loadSchema()` and `parseDocument()`, an `additionalOperations` entry is now ignored when it repeats a method that the same Path Item defines as a fixed field. The method names are compared case-insensitively.

The following change only affects documents that still contain Reference Objects after the pass pipeline, such as with a custom pass list like `[]` or with unresolved external refs. In those documents, local references at operation positions (Path Item, parameter, requestBody, response, callback) are now resolved by following the reference chain. Before, they were dropped or left in place.

- At parameter, requestBody, response and callback positions, the `$ref` is an OAS 3.2 Reference Object. Only a `summary` or `description` beside it overrides the target, and only when the target's object type defines that field: `description` for parameters and request bodies, both for responses, neither for callbacks. Other sibling fields are ignored.
- Fields declared beside a Path Item `$ref` overlay the referenced Path Item.
- The operations declared beside an unresolvable Path Item `$ref` are kept.

References that the default pipeline's deref pass resolves are not affected by this change. That pass resolves them before indexing and still merges every sibling field into the target.

@oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses with `parseDocument(spec, [])`. Its output changes for specs with local operation-position references:

- A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`. Whether the body is required comes from the referenced request body.
- A Path Item `$ref` in `paths` or `webhooks` now emits the operation types of the referenced Path Item.
  - Operations, `parameters` and other fields declared beside the `$ref` replace the referenced ones.
  - Operations declared beside a Path Item `$ref` into another file are now emitted too. Before, the whole Path Item was skipped.
- A `description` beside a parameter `$ref` now replaces the referenced description in the generated JSDoc.
- A parameter or response `$ref` whose target is itself a Reference Object is now followed to the final target. The parameter field and `<Op>Response` are now emitted.
- Other fields beside a Reference Object, such as `required`, `name`, `in`, `schema` or `content`, are still ignored and do not change the generated types.

For local references at operation level (a Path Item under `paths` or `webhooks`, and an operation's parameters, requestBody and responses), the generated `types.ts` now declares the operation types that the generated client imports for them.

Typegen still does not resolve these references:

- References nested inside those objects, such as a response header `$ref` or an OAS 3.2 media-type `$ref` under `content`.
- Operation-level references into other files.

For those specs the client can still import a type that `types.ts` does not declare, such as `<Op>ResponseHeaders`, `<Op>Body` or `<Op>Response`.
