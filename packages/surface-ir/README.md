# `@oa-sdk/surface-ir`

Target-neutral API surface IR built from the `ParsedDocument` of `@oa-sdk/parser`, plus a Cloudflare
Forge projection adapter. The parser IR keeps the wire-contract facts; the surface IR adds SDK and
CLI surface policy: group paths, method names, lifecycle (availability), visibility, aliases, CLI
arguments, and runtime profiles (envelope, error shape, pagination, streaming).

## Installation

```bash
npm install @oa-sdk/surface-ir @oa-sdk/parser
```

Requires Node.js 22 or later. `@oa-sdk/surface-ir` is published to npm for the first time with the
`@oa-sdk/codegen` 0.9.0 release; it cannot be installed from npm before that release. It depends on
`@oa-sdk/parser`; install the parser next to it to call `parseDocument()` yourself.

The `oa-gen surface` command of `@oa-sdk/codegen` runs this package and writes the results to files
(see [CLI](#cli)).

## Usage

```ts
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { parseDocument } from '@oa-sdk/parser'
import { buildSurfaceIr, emitForgeOverlays, toForgeProjection } from '@oa-sdk/surface-ir'

const parsed = parseDocument(parse(readFileSync('openapi.yaml', 'utf8')))

const surface = buildSurfaceIr(parsed, {
  target: 'forge',
  operationOverrides: {
    listUsers: { groupPath: ['accounts', 'users'], methodName: 'list', availability: 'preview' },
  },
})
const projection = toForgeProjection(surface, parsed) // x-fern-* / x-forge-* metadata per operation
const overlays = emitForgeOverlays(surface, parsed)    // one OpenAPI Overlay per top-level command

for (const diagnostic of surface.diagnostics) console.warn(diagnostic.severity, diagnostic.code, diagnostic.message)
```

The input is any OpenAPI 3.x document parsed by `@oa-sdk/parser` with complete reference resolution.
In oa-sdk's own pipeline that document is the OpenAPI artifact generated from TypeSpec. The package
reads the document only; it does not modify TypeSpec sources, approved snapshots, or generated
artifacts.

## `buildSurfaceIr(document, options?)`

Returns a `SurfaceIr`: `{ schemaVersion, target, source: { openapiVersion, operationCount, artifactHash }, operations, diagnostics, versionHash }`.
`schemaVersion` is `SURFACE_IR_VERSION` (`'oa-sdk.surface-ir.v1'`). Each operation keeps its
`contract` (path, method, tags, summary, description), `projection`, `cli`, `runtime`, and
`provenance` (the JSON Pointer of the operation).

| Option | Default | Description |
|---|---|---|
| `target` | `'generic'` | `'generic'` or `'forge'` (adds Forge-specific diagnostics) |
| `defaultAvailability` | `'generally-available'` | `alpha`, `beta`, `preview`, `generally-available`, `deprecated`, or `legacy` |
| `groupForOperation(operation)` | the first tag, kebab-cased (`api` without tags) | Group path of an operation |
| `methodForOperation(operation)` | operationId | SDK method name of an operation |
| `operationOverrides` | — | Per-operationId `groupPath`, `methodName`, `availability`, `visibility`, `aliases`, and `cli` (`args`, `params`, `globals`) |
| `defaultEnvelope`, `defaultErrors` | `'direct'`, `'status-body'` | Runtime profile: direct bodies or the Cloudflare `result` envelope, status-body errors or the Cloudflare error envelope |

Problems are reported as diagnostics, not thrown:

| Code | Severity | When |
|---|---|---|
| `surface-ir/incomplete-document` | error | The `ParsedDocument` has unresolved references |
| `surface-ir/missing-operation-id` | error | An operation has no `operationId` (it is skipped) |
| `surface-ir/unsupported-method` | error | The HTTP method is not one the builder supports |
| `surface-ir/method-collision` | error | Two operations map to the same group path and method name |
| `surface-ir/forge-query-method` | error | `target: 'forge'` and the operation uses the OpenAPI 3.2 `QUERY` method |
| `forge-projection/empty-group` | error | Reported by `toForgeProjection` when an operation has an empty group path |

## Forge projection

| Export | Description |
|---|---|
| `toForgeProjection(ir, document)` | `{ operations, commands, diagnostics }`: per-operation `x-fern-sdk-group-name`, `x-fern-sdk-method-name`, `x-fern-availability`, `x-fern-ignore`, `x-forge-hidden`, `x-forge-internal`, `x-forge-args`, `x-forge-params`, `x-forge-globals`, and a command catalog built from the top-level groups and tag descriptions |
| `emitForgeOverlays(ir, document, options?)` | One OpenAPI Overlay 1.0 document per top-level command, which matches Forge's one-command-per-overlay resolution; returns `[{ name, overlay }]` |
| `emitForgeOverlay(ir, document, options?)` | A single overlay with every operation's metadata (`options.name`, `options.version`) |

## CLI

`oa-gen surface` (in `@oa-sdk/codegen`) runs the same steps on an OpenAPI YAML/JSON file or a
TypeSpec `.tsp` file:

```bash
npx oa-gen surface --spec ./openapi.json --target forge --mapping ./forge-surface.yaml --out-dir artifacts/surface/forge
```

It writes `surface-ir.json`, `forge-projection.json`, one `forge.<command>.overlay.yaml` per
command, and `surface-manifest.json` to `--out-dir` (default `artifacts/surface/forge`), and fails on
error diagnostics (and on warnings with `--fail-on-warning`).
