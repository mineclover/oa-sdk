# @oa-sdk/ast-sync

V3 Unified Architecture: Zero-loss bidirectional TypeScript AST synchronization, type shape taxonomy analysis, and standalone pre-compiled guard generation.

## Features

- **Bidirectional AST Sync**: Seamless synchronization between `EntitySpec` (OpenAPI 3.2 schema representations) and TypeScript AST with reverse-offset patch engine preserving comments, formatting, and custom statements.
- **Pluggable Type Adapters**: Pluggable adapters for Typia AOT type tags, Zod schemas, and raw TypeScript AST types.
- **Type Shape Taxonomy & Feasibility Diagnostics**: Classifies TypeScript syntax into 24 distinct syntax features with 3-tier projection feasibility:
  - `direct`: Clean 1:1 mapping to OpenAPI 3.2 / TypeSpec.
  - `policy-required`: Requires an explicit authoring policy (e.g. record, utility types).
  - `unsupported`: Complex dynamic constructs (conditional types, mapped types, indexed access).
- **Checker-Resolved Symbol Cycle Detection**: Graph DFS cycle detector using canonical TypeScript TypeChecker symbol IDs (`symbol.id`), resolving through aliased imports and multi-file re-export chains.
- **Standalone Pre-compiled Type Guards**: Generates self-contained, zero-dependency validation functions using AJV standalone code generation, fully conforming to strict CSP (zero `eval`, zero `new Function`).
- **Tiered AOT Fast-Path Guards**: Inlines zero-overhead \(O(1)\) structural checks (`is<Name>Fast`) for high-frequency loops (e.g. 60fps/120fps UI streams or network packet loops), short-circuiting before deep Ajv validation.
- **Polymorphic `oneOf` O(1) Dispatcher**: Resolves `discriminator.propertyName` into compile-time hash tables (`__dispatch_is<Name>`) for \(O(1)\) branch lookup instead of sequential array scans.

## Install

```bash
pnpm add -D @oa-sdk/ast-sync
```

Requires Node.js **22 or later** and TypeScript **5.0 or later**.

## Minimal ESM Example

```typescript
import ts from 'typescript'
import { extractDeclarationShape, detectSymbolCycles } from '@oa-sdk/ast-sync'

// Analyze declaration feasibility:
const shape = extractDeclarationShape(typeNode)
console.log(shape.feasibility) // 'direct' | 'policy-required' | 'unsupported'

// Detect cyclic dependencies using TypeChecker symbol IDs:
const cycleResult = detectSymbolCycles(program)
if (cycleResult.hasCycles) {
  console.warn('Cycles detected:', cycleResult.cycles)
}
```

## Standalone Guard Generation with Tiered Fast-Path & Polymorphic Dispatch

```typescript
import { generateStandaloneGuards } from '@oa-sdk/ast-sync/guards'

const artifacts = await generateStandaloneGuards({
  schemaDocument: openApiDoc,
  outDir: './src/guards',
  tiered: true,               // Generates is<Name>Fast(data) and tiered wrappers
  polymorphicDispatch: true,  // Generates O(1) discriminator dispatch tables
  guards: [
    { name: 'isActionPayload', schema: '#/$defs/ActionPayload', typeName: 'ActionPayload' },
    { name: 'isTimeSeriesPayload', schema: '#/$defs/TimeSeriesPayload', typeName: 'TimeSeriesPayload' },
    { name: 'isStreamItem', schema: '#/$defs/StreamItem', typeName: 'StreamItem' },
  ],
})
```

Generated code exports:
1. `isActionPayloadFast(data: unknown): boolean` — High-speed inline \(O(1)\) check.
2. `isActionPayload(data: unknown): data is ActionPayload` — Tiered composite guard with full Draft 2020-12 accuracy.
3. `const __dispatch_isStreamItem = { "ui-action@v1": isActionPayload, "time-series@v1": isTimeSeriesPayload }` — Instant \(O(1)\) discriminator routing.

## CLI Audit

Use the `oa-gen` CLI from `@oa-sdk/codegen` to audit TypeScript files for type shape feasibility:

```bash
pnpm exec oa-gen audit:shape --source src/models/user.ts
```
