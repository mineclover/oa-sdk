---
"@oa-sdk/mock-server": patch
---

The MSW and Node HTTP adapters now build each route's response once and reuse it. The response bytes, response-schema checks and error output they serve are unchanged, except in the two cases noted below (dropped optional properties, and spec objects changed in place).

- With the built-in generator, the documented `401` and `422` responses and the operation's own response are picked, validated, serialized and (for streams) generated once per route. Request validation, `422` validation details, callbacks and plugin responses are still computed per request. `updateSpec()`, or building new MSW handlers, starts over with the new spec.
- A customized shared generator turns reuse off while it is in place, so every request generates its response anew as before. Customizing means replacing or adding a `generateAlgebra` handler, patching `generator`, `GenerateFolder.prototype`, `streamer` or `StreamFolder.prototype`, including a test spy on one of their methods.
- The Node adapter no longer keeps a `405` `Allow` header for every distinct request URL. Its per-route state is now bounded by the number of operations.
- The built-in generator no longer generates optional properties it then drops. Output is unchanged, but an error a built-in handler would raise inside a dropped optional property, such as a `minLength` beyond the engine's string length limit, no longer occurs. A `GenerateFolder` with any customized handler still visits every property.
- Spec objects are read-only once an adapter is built. A change made in place through a `ParsedDocument` or a plugin's `context.entry` no longer reaches reused responses. Use `override()`, `updateSpec()`, new MSW handlers or a plugin `onMatch` response instead.
- An `onResponse` hook must return a changed copy of the response body rather than change it in place. Example-backed bodies, and `example`, `default` and `const` values inside generated ones, are the spec's own objects.
