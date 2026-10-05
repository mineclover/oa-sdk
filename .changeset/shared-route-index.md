---
"@oa-sdk/parser": patch
"@oa-sdk/codegen": patch
"@oa-sdk/mock-server": patch
---

@oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes.

These changes apply to every document, including fully dereferenced ones on the default pipeline:

- `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions onto route entries.
- In both `loadSchema()` and `parseDocument()`, an `additionalOperations` entry is now ignored when it repeats a method that the same Path Item defines as a fixed field. The method names are compared case-insensitively. Code generated from `parseDocument()`, such as typegen output and generated clients and routers, no longer includes that entry.

The following change only affects documents that still contain Reference Objects after the pass pipeline, such as with a custom pass list like `[]` or with unresolved external refs. In those documents, local references at operation positions (Path Item, parameter, requestBody, response, callback) are now resolved by following the reference chain. Before, they were dropped or left in place.

- At parameter, requestBody, response and callback positions, the `$ref` is an OAS 3.2 Reference Object. Only a `summary` or `description` beside it overrides the target, and only when the target's object type defines that field: `description` for parameters and request bodies, both for responses, neither for callbacks. Other sibling fields are ignored.
- Fields declared beside a Path Item `$ref` overlay the referenced Path Item.
- The operations declared beside an unresolvable Path Item `$ref` are kept.

References that the default pipeline's deref pass resolves are not affected by this change. That pass resolves them before indexing and still merges every sibling field into the target.

@oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses with `parseDocument(spec, [])`. Its output changes in the following cases.

Local references at operation positions:

- A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`. Whether the body is required comes from the referenced request body.
- A Path Item `$ref` in `paths` or `webhooks` now emits the operation types of the referenced Path Item.
  - Operations, `parameters` and other fields declared beside the `$ref` replace the referenced ones.
  - Operations declared beside a Path Item `$ref` that cannot be resolved, such as one into another file, are now emitted too. Before, the whole Path Item was skipped.
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
