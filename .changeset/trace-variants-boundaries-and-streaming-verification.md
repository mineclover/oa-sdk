---
"@oa-sdk/typespec-decorators": minor
"@oa-sdk/codegen": patch
"@oa-sdk/ast-sync": patch
"@oa-sdk/spec-lens-contract": patch
"@oa-sdk/router": patch
---

Shared `@traceId` variants are accepted as lineage, ast-sync type boundaries are modelled, and Fastify/Hono streaming is verified with the real frameworks.

**@oa-sdk/typespec-decorators**

- `@traceId` now emits `x-oa-sdk-trace.declarationId` next to `trackingId`. It is a hash of the
  declaration the application is written on, so visibility variants and `MergePatchUpdate<T>`
  clones (and shared parameter/anonymous types and derived scalars) carry the same evidence.
- The `.tsp` documentation and README describe the shared-variant policy instead of listing it as
  a known defect that fails `oa-gen trace --verify`.

**@oa-sdk/codegen**

- `buildSpecTraceabilityGraph` accepts one explicit `trackingId` when every node has the same
  `declarationId`; an id shared by independent declarations, or without evidence, still reports
  `traceability/duplicate-tracking-id`.
- The trace sidecar validator accepts the optional `declarationId` field.

**@oa-sdk/ast-sync**

- JSON Schema `read()`/`patch()` validate parsed input through `toJsonSchemaObject` /
  `parseJsonSchemaObject`; typia `@default` tags go through `parseJsonDefaultTag`.
- Replaced the remaining explicit `any` escapes: TypeScript's internal `symbol.id` and declaration
  names have modelled accessors, virtual-program temp directories live in a `WeakMap` exposed by
  `getProgramTempDir`, and Ajv/standalone imports plus format validators are typed.

**@oa-sdk/spec-lens-contract**

- Added `customData?: Record<unknown>` to `ScenarioMachineContext` in `scenario.tsp`, matching the
  TypeScript interface, with a drift test.

**@oa-sdk/router**

- Added real Fastify 5.12 / Hono 4.12 streaming tests: `AsyncIterable`, Web `ReadableStream` and
  Node streams send with the declared content type, and client disconnects cancel the source
  iterator. Documentation now describes the verified behaviour instead of the retired defects.
