---
"@oa-sdk/codegen": minor
---

Extract complete wire schemas from composed, map-shaped and namespaced models. **Behavior change:** regenerate `.proto` files and codecs together after upgrading, because field numbers and default names can change.

- `extractWireSchemaFromOas` merges `allOf` members (inline objects and component `$ref`s), so TypeSpec `extends` models keep their inherited fields. Automatic field numbers are assigned after the explicit ones, inherited fields first, so an inheriting model without `@field` numbers can get other numbers than an earlier version generated. Duplicate or invalid explicit `x-oa-sdk-protobuf-field` numbers (outside 1–536870911, or in the reserved 19000–19999) throw.
- Default service, tag and method names use `pascalCase` from `@oa-sdk/core` (`TodoItems_list` becomes `TodoItemsList`, not `TodoItemslist`). Map-only and free-form object components become `kind: 'object'` models with a MessagePack codec and a TypeScript type but no `.proto` message or Protobuf codec, instead of empty messages that dropped their content. `WireModel.tsTypeName` and `WireEnum.tsTypeName` hold the `types.ts` names, which the generated Protobuf, MessagePack and RPC TypeScript now uses, so models in sub-namespaces compile.
- Generated Protobuf decoders fill absent required scalar and enum fields with their proto3 defaults. The synthetic empty message is named `Empty` unless a model, enum or service already uses that name, and `Empty2`, `Empty3` and so on otherwise (`emptyMessageName` and `WireNameScope` are exported). The generated RPC client rejects an empty path value (`''`, `[]`) with a `TypeError` before the request.
- `Proto3TargetAdapter` honors its `emitEmptyMessage` constructor default. `TypeSpecWirePipeline` treats a string as a path only when it has no newline, `;` or brace and ends in `.tsp` or exists on disk, instead of whenever it contains `model`, `service` or `namespace`, and gains `extractModelFromFile` and `extractModelFromSource`.
