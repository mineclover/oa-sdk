# ADR-008 - Browser Runtime Entrypoints

## Status

Accepted for the current browser-safe public surface. The shared renderer extraction below is a proposed follow-up.

## Context

The package roots are tooling-complete surfaces. They intentionally include Node-only capabilities such as HTTP servers, external YAML/JSON `$ref` resolution, filesystem-backed ref graphs, and CLI governance helpers.

The preview app is different: it runs in the browser and starts from an already-loaded OpenAPI object. Pulling package roots into that path made Vite resolve Node builtins (`fs`, `path`, `crypto`, `http`) and previously broke the app at runtime. A first no-deref browser parser also exposed a real mock-server issue: MSW request schema preflight still needs internal `$ref` resolution, but not filesystem-backed external ref resolution.

## Decision

Public browser surfaces are explicit subpath exports:

| Package | Browser surface | Rule |
|---|---|---|
| `@oa-sdk/core` | `@oa-sdk/core/browser` | string/codegen/format/response helpers only; no Node HTTP server |
| `@oa-sdk/parser` | `@oa-sdk/parser/browser` | in-memory parse/query/fold/route match plus `derefInternalSpec()`; no filesystem ref resolver or definition projection |
| `@oa-sdk/codegen` | `@oa-sdk/codegen/typegen/browser` | typegen for already-loaded specs; no `basePath` external ref analysis |
| `@oa-sdk/router` | `@oa-sdk/router/browser` | router code generation from in-memory specs only |
| `@oa-sdk/client` | `@oa-sdk/client/browser` | client code generation from in-memory specs only |
| `@oa-sdk/mock-server` | `@oa-sdk/mock-server/browser` | MSW/core mock surface only; internal `$ref` is resolved with `derefInternalSpec()` |

Package roots remain the Node/tooling-complete surfaces. Browser code should not deep-import implementation files to avoid bypassing export policy.

## Current Verification

- Preview production build has no Node externalization warnings.
- Preview initial JS chunk is split to roughly 105 kB; generation and MSW load lazily.
- Python Playwright smoke covers Load Example, type/router/client generation, Mock Test tab, Service Worker start, `/pets` request, `200 OK`, example response body, and no console errors.
- Focused package gates cover parser/router/client/mock-server/codegen/spec-lens tests plus CLI spec and persona checks.

## Proposed Follow-up Restructure

The current router/client browser entries duplicate the root generator implementation to preserve the Node root `basePath` behavior while unblocking preview. The maintainable target shape is:

1. Extract pure renderers:
   - `packages/router/src/render-router.ts`
   - `packages/client/src/render-client.ts`
   - optional `packages/codegen/src/typegen/render-types.ts`
2. Keep environment adapters thin:
   - root entries parse with Node/full parser when `basePath` or external ref analysis is needed.
   - browser entries parse with `@oa-sdk/parser/browser`.
   - both call the same renderer.
3. Add export drift guards for every package with browser subpaths.
4. Promote the Playwright preview smoke into a checked test script once the repo chooses a browser-test dependency strategy.
5. Keep docs aligned through `spec.md`, `api-index.md`, `feature-test-matrix.md`, and this ADR whenever a public subpath is added.

## Non-goals

- Browser surfaces do not resolve external file refs.
- Browser surfaces do not expose Node HTTP server helpers.
- `@oa-sdk/mock-server/browser` does not re-export `DerefFolder`, `derefSpec`, `runPipeline`, or `DEFAULT_PASSES`; those remain on the root package path.
