# ADR-008 - Browser Runtime Entrypoints

## Status

Accepted. The browser-safe public surface and the shared renderer extraction are implemented.

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

## Implemented Renderer Boundary

Router/client Node and browser entries now share a renderer and differ only at the parsing boundary.

1. Pure renderers live in `packages/router/src/generate-router-renderer.ts` and `packages/client/src/generate-client-renderer.ts`.
2. Root entries parse with the Node parser and alone expose `basePath` for filesystem-backed external `$ref` resolution.
3. Browser entries parse only in-memory input through `@oa-sdk/parser/browser`, then call the same renderer.
4. Browser option types do not expose `basePath`; this prevents an option that cannot have an effect in a browser bundle.
5. Node/browser generation parity is asserted by focused router/client tests for internally referenced documents.

The client renderer also separates generated runtime schema support, request validation, error contracts, and retry policy into focused internal modules. This keeps a change to one generated concern from requiring changes in platform adapters.

`@oa-sdk/codegen/typegen/browser` still has a separate renderer because Node typegen additionally owns filesystem-backed external schema analysis. It remains a follow-up candidate only after its output contract is normalized.

## Non-goals

- Browser surfaces do not resolve external file refs.
- Browser surfaces do not expose Node HTTP server helpers.
- `@oa-sdk/mock-server/browser` does not re-export `DerefFolder`, `derefSpec`, `runPipeline`, or `DEFAULT_PASSES`; those remain on the root package path.
