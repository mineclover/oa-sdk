---
"@oa-sdk/typespec-decorators": minor
---

Validate `@chunkStream`, `@traceId` and the wire decorators the way their documentation says. Review the items marked **behavior change** when upgrading.

- `@chunkStream` honors the `targetChunkBytes`, `maxResidentBytes` and `maxL1MemoryBytes` overrides and emits `maxL1MemoryBytes` (default half of `maxResidentBytes`) after `maxResidentBytes` in `x-oa-sdk-chunk-stream`. **Behavior change:** a wrongly typed or out-of-range numeric or string option, or an options argument that is not an object, reports `invalid-chunk-stream-rule` and emits no extension instead of silently falling back to defaults, so such specs no longer compile.
- **Behavior change:** `@traceId` puts `x-oa-sdk-trace.trackingId` on the declaring type and on the clones TypeSpec's mutation engine makes of it, so `@versioned` services and `MergePatchUpdate<T>` variants compile and carry the id in every per-version document, where they used to report Duplicate traceId. Derived copies (`model B is A`, `op b is a`, operations cloned by `interface B extends A`, spread copies and template instances, `@friendlyName` ones included) compile without an id; `model B is A` and template instances used to fail with Duplicate traceId. A template instantiated once no longer carries the template's id.
- `@rpc` and `@wireFormat` on an interface apply to each of its operations (operation values win), and `@protobuf` or a `methodName` on an interface reports a diagnostic instead of compiling and emitting nothing. `$onValidate` reports duplicate `@field` numbers; a property that redeclares an inherited one, such as a narrowed discriminator, replaces it and is not reported.
- `@oa-sdk/typespec-decorators/governance` exports `verifyAtlasSchemaDrift`, `AtlasSchemaInspectOutputSchema` and the drift report types. There is no `./storage-drift` subpath.
