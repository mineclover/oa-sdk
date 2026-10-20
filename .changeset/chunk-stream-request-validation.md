---
"@oa-sdk/chunk-stream": minor
"@oa-sdk/chunk-stream-ui": patch
---

Validate chunk server requests and keep storyboard servers stable across document revisions.

- `@oa-sdk/chunk-stream`: `server.fetch()` decodes each path segment on its own. Malformed percent-encoding answers 400 `BAD_REQUEST` instead of rejecting with `URIError`, and an encoded `%2F` stays inside its id. A seek frame must be a non-negative safe integer, given as a number or a decimal string, and an absent frame still means 0. Any other value, or a non-empty POST seek body that is not a JSON object with a number or string `frame`, answers 400 without calling `seekFrame`; invalid and string frames used to seek to frame 0.
- `@oa-sdk/chunk-stream` (types): the new `ChunkStreamBadRequestError` is exported, `ChunkStreamRouteResponse.status` includes 400 and `seekStreamFrame` may return `ChunkStreamBadRequestError`, so code that switches over route results sees a new variant. `SeekStreamFrameContext.body` is `{ frame?: number | string }`.
- `@oa-sdk/chunk-stream`: `TieredStoragePort` honors `StorageTierOptions.memoryPreset`, sizing L1 at half the preset as `defineChunkStreamConfig` does. An explicit `maxL1MemoryBytes` still wins, and the 32 MiB default is unchanged.
- `@oa-sdk/chunk-stream-ui`: `defineStoryboardChunkServer` caches its bundle per document revision (`id` and `changeToken`, or object identity without a token), so a provider that returns a fresh object keeps the bridge and its seek state, and a superseded bundle is closed and disposed. `close()` is terminal: the handlers and `fetch` answer 404, `bridge` stays closed, and `seek()` fails with `E_CLOSED`. A closed server used to rebuild a fresh bridge on the next call.
