---
"@oa-sdk/chunk-stream": patch
---

`TieredStoragePort` checks a chunk descriptor it reads back from the L2 tier or fetches from the remote L3 tier before it builds an envelope from it: `id` must be a string and `fromFrame` and `toFrame` numbers; when present, `schemaVersion` must be `1`, `sequence` and `residentBytes` numbers, `streamId` and `payloadFormat` strings, and `resources` an array of resource references with string `id` and `type`. Prototype-poisoning keys are rejected. A descriptor that fails these checks now rejects with an `E_CHUNK_DESCRIPTOR` error instead of producing an envelope that carries the wrongly typed value. `data` and `state` stay opaque payloads, and valid descriptors behave as before.
