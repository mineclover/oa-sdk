# Goal 65 - Browser Ref Completeness Contract

**Status: complete 2026-07-10**

## Purpose

The browser parser previously treated an already-loaded OpenAPI object as if its
references were ready for downstream generation. Ref-backed path items or schemas
could therefore be omitted or flattened with loss while client and router
generation still succeeded.

Goal 65 makes reference completeness explicit and requires runtime-code generators
to consume only complete parser IR.

## Contract

- Every parser-produced `ParsedDocument` carries `resolution` evidence with a
  `complete` or `partial` status, an `internal` / `all` / `custom` scope, and
  diagnostics.
- `CompleteParsedDocument`, `isParsedDocumentComplete()`, and
  `assertParsedDocumentComplete()` define the downstream safety boundary.
- A legacy hand-built `ParsedDocument` without resolution metadata is not assumed
  complete.
- The browser parser synchronously resolves in-memory internal references.
- Missing internal refs, cycles, and external refs without a loader produce a
  partial document with the ref and source pointer in diagnostics.
- Browser code does not fetch external refs implicitly. A caller-owned asynchronous
  loader remains a separate future contract.

## Generator Behavior

Client and router generation in both Node and browser entrypoints accepts raw
OpenAPI or parser IR, but generation stops with `IncompleteParsedDocumentError`
when the resulting IR is partial. Browser `loadSchema()` uses the same guard.

Node parsing with a `basePath` can resolve supported external file refs and records
an `all` scope. Custom parser-pass arrays remain conservative: if the source began
with refs, the result is partial unless a future resolver-aware custom contract can
prove completeness.

## Verification

- Internal path-item refs generate the same operations and routes in Node and
  browser entrypoints.
- Missing, cycle, and external-without-loader fixtures are partial and rejected by
  client/router generation.
- Legacy metadata-less IR is rejected explicitly.
- Parser, client, and router full suites pass.
- All three packages pass typecheck and declaration build.
- Built browser entrypoints import without Node built-ins and preserve partial
  rejection behavior.

## Deferred Contract

External browser resolution will use a separate asynchronous API with caller-owned
loading, authentication, CORS, caching, and base-URI policy. It must reuse the same
resolution diagnostics and may mark a document complete only after nested external
refs and cycles have been checked.
