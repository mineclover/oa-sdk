---
"@oa-sdk/client": minor
"@oa-sdk/codegen": patch
"@oa-sdk/ast-sync": patch
---

TanStack options/keys now work for Vue and Svelte, streaming operations no longer emit unusable cache artifacts, and guard generation accepts dotted TypeSpec contract names.

**@oa-sdk/client**

- Tier 2 (pure query/mutation options) imports the framework-neutral `QueryObserverOptions`,
  `MutationObserverOptions` and `InfiniteQueryObserverOptions` types that every TanStack adapter
  re-exports from `@tanstack/query-core`, instead of React-only `UndefinedInitialDataOptions` /
  `UseMutationOptions`. `generate:tanstack --framework vue|svelte` output now compiles.
- Streaming operations (SSE, NDJSON, JSONL, `application/stream+json` in the response or request
  body) keep their query keys but no longer generate `QueryOptions`, `MutationOptions` or hooks,
  because a `queryFn` returning an `AsyncGenerator` cannot be cached.
- Infinite query options use a distinct key (`[...<listKey>, 'infinite']`). List and infinite
  caches with the same filters no longer collide, and invalidating the list key still matches the
  infinite entry by prefix.
- `TError` for operations with a documented error model is now `<Op>Error | Error`, so transport
  failures (network errors, aborts, `ApiClientResponseError`) are part of the generated type.

**@oa-sdk/codegen**

- `generate:tanstack --split --tier options|hooks` emits the lower tiers the requested tier imports
  (`options` → keys + queries, `hooks` → keys + queries + hooks), so the output compiles.
- `generate:tanstack --framework vue|svelte --tier hooks` fails with a clear error instead of writing
  React hooks against a Vue/Svelte package.
- `check-artifact` and `drift:check` read targets through `resolveConfigWithDefaults`, so a config
  that declares only `product.specs` no longer fails with `specs 목록이 비어 있습니다`.
- Added a regression test for pattern-based `outputRouting` with `--split`, resolving every generated
  relative import against the routed files.

**@oa-sdk/ast-sync**

- Standalone guards normalize component names that are not JavaScript identifiers (for example the
  TypeSpec namespace-qualified `OaSdkTypeSpec.StandardError` to `isOaSdkTypeSpec_StandardError`)
  while keeping the qualified type in the `data is ...` declaration. Split mode uses the normalized
  file name and imports the namespace root (`import type { OaSdkTypeSpec }`) because
  `import type { A.B }` is invalid TypeScript. `--schemas` matching accepts the original dotted name.
