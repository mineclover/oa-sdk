---
"@oa-sdk/router": patch
---

Stream `AsyncIterable` and Node stream bodies from the Elysia target.

The generated Elysia router returned an `AsyncIterable` unchanged, so Elysia's default adapter
failed with `Received non-Uint8Array chunk` for string chunks (and the `@elysiajs/node` adapter
could wrap each value in a second SSE frame). The router now converts an `AsyncIterable`/Node
`Readable` to a Web `ReadableStream` and cancels the source iterator on disconnect, matching the
Fastify and Hono targets. Real Elysia 1.4 tests cover envelope and direct returns, SSE/NDJSON and
cancellation.

Release tooling in the same change: `pnpm version-packages` now syncs `PACKAGE_VERSION` constants,
`check:package-versions` runs in preflight/CI, and npm version lookups use `--prefer-online` so a
stale cache cannot hide a just-published version.
