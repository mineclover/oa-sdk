# @oa-sdk/chunk-stream-react

## 0.2.1

### Patch Changes

- Updated dependencies [4cae342]
  - @oa-sdk/chunk-stream@0.3.0
  - @oa-sdk/chunk-stream-ui@0.2.1
  - @oa-sdk/chunk-stream-crdt@0.1.2

## 0.2.0

### Minor Changes

- - `useChunkTelemetry` also returns the stream's `preset`, `memoryPreset` and `targetChunkBytes` (defaults `optimal-web`, `standard`, 7168 when the manifest does not set them).
  - `useChunkPlayback` looks up the envelope for a slide through the package's `slideEnvelopeMap` or a memoized slide index instead of scanning every envelope on start and on each autoplay tick.

### Patch Changes

- Updated dependencies [33a57e3]
- Updated dependencies
- Updated dependencies
  - @oa-sdk/chunk-stream@0.2.0
  - @oa-sdk/chunk-stream-ui@0.2.0
  - @oa-sdk/chunk-stream-crdt@0.1.1
