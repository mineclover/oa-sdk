# @oa-sdk/chunk-stream

## 0.3.0

### Minor Changes

- 4cae342: Validate chunk server requests and keep storyboard servers stable across document revisions.

  - `@oa-sdk/chunk-stream`: `server.fetch()` decodes each path segment on its own. Malformed percent-encoding answers 400 `BAD_REQUEST` instead of rejecting with `URIError`, and an encoded `%2F` stays inside its id. A seek frame must be a non-negative safe integer, given as a number or a decimal string, and an absent frame still means 0. Any other value, or a non-empty POST seek body that is not a JSON object with a number or string `frame`, answers 400 without calling `seekFrame`; invalid and string frames used to seek to frame 0.
  - `@oa-sdk/chunk-stream` (types): the new `ChunkStreamBadRequestError` is exported, `ChunkStreamRouteResponse.status` includes 400 and `seekStreamFrame` may return `ChunkStreamBadRequestError`, so code that switches over route results sees a new variant. `SeekStreamFrameContext.body` is `{ frame?: number | string }`.
  - `@oa-sdk/chunk-stream`: `TieredStoragePort` honors `StorageTierOptions.memoryPreset`, sizing L1 at half the preset as `defineChunkStreamConfig` does. An explicit `maxL1MemoryBytes` still wins, and the 32 MiB default is unchanged.
  - `@oa-sdk/chunk-stream-ui`: `defineStoryboardChunkServer` caches its bundle per document revision (`id` and `changeToken`, or object identity without a token), so a provider that returns a fresh object keeps the bridge and its seek state, and a superseded bundle is closed and disposed. `close()` is terminal: the handlers and `fetch` answer 404, `bridge` stays closed, and `seek()` fails with `E_CLOSED`. A closed server used to rebuild a fresh bridge on the next call.

## 0.2.0

### Minor Changes

- Add a typed chunk stream server and transmission/memory presets.

  - `defineChunkStreamServer(options)` builds a `ChunkStreamTypedServer` whose handlers (`getManifest`, `getChunk`, `getPlaybackSnapshot`, `seekFrame`) answer stream manifest, chunk, playback-snapshot and seek routes with typed `ChunkStreamRouteResponse` bodies and a `ChunkStreamNotFoundError` shape.
  - `defineChunkStreamConfig(input)` resolves a `ChunkStreamConfigInput` (mode `adaptive` | `eager` | `manual`, chunk preset, memory preset) into a `ResolvedChunkStreamConfig`.
  - `CHUNK_PRESETS`, `MEMORY_PRESETS` (`mobile` | `standard` | `highperf`) and `RECOMMENDED_CHUNK_BYTES` expose the preset table.

### Patch Changes

- 33a57e3: `TieredStoragePort` checks a chunk descriptor it reads back from the L2 tier or fetches from the remote L3 tier before it builds an envelope from it: `id` must be a string and `fromFrame` and `toFrame` numbers; when present, `schemaVersion` must be `1`, `sequence` and `residentBytes` numbers, `streamId` and `payloadFormat` strings, and `resources` an array of resource references with string `id` and `type`. Prototype-poisoning keys are rejected. A descriptor that fails these checks now rejects with an `E_CHUNK_DESCRIPTOR` error instead of producing an envelope that carries the wrongly typed value. `data` and `state` stay opaque payloads, and valid descriptors behave as before.
