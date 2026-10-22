# @oa-sdk/spec-lens

## 0.1.7

### Patch Changes

- Updated dependencies [6239a85]
- Updated dependencies [fe143f7]
- Updated dependencies [c565468]
- Updated dependencies [791657c]
- Updated dependencies [8a06e73]
- Updated dependencies [1f37428]
- Updated dependencies [9743fb4]
- Updated dependencies [4538f7c]
- Updated dependencies [9743fb4]
- Updated dependencies [3063402]
- Updated dependencies [f0edbd0]
- Updated dependencies [e4e82a7]
- Updated dependencies [4538f7c]
- Updated dependencies [4538f7c]
- Updated dependencies [0f84ddf]
  - @oa-sdk/codegen@0.10.0
  - @oa-sdk/parser@0.5.0
  - @oa-sdk/spec-lens-contract@0.1.1

## 0.1.6

### Patch Changes

- Timeline refresh decodes a path-item pointer such as `#/paths/~1users` to `/users`. Before, it decoded it to `//users`, so no diff entry matched a spec path and every path reported the newest revision as `lastChangedRevisionId`. Pointers below a path item are ignored instead of being decoded into a path such as `/users/parameters`.
- The graph handler maps `$ref` edges through the parser's ref-preserving `projectRefGraph()`. Path-level edges, which went missing because path keys were not pointer-escaped, are reported, and a dangling `$ref` no longer produces an edge. Self-edges stay hidden.
- `spec-lens.config` files are validated against what the CLI reads. Only the section of the selected `source` is read, and it must be present for `github` and `gitlab`; a missing or empty `source` means `local-git`, and any value other than `local-git`, `github` or `gitlab` is rejected; a key with an empty value counts as not set; `port` accepts a number or a numeric string and must be an integer from 0 to 65535; `project`, `fragmentsDir` and `targetPath` pass through to project resolution. An empty or comment-only config file makes the CLI auto-detect the project. A config that breaks these rules fails with `Failed to parse config`; before, an unknown `source` fell back to `local-git` and wrongly typed fields were used as they were.
- Updated dependencies
- Updated dependencies
- Updated dependencies [b4f5dd4]
  - @oa-sdk/codegen@0.9.0
  - @oa-sdk/parser@0.4.0

## 0.1.5

### Patch Changes

- Updated dependencies
  - @oa-sdk/codegen@0.8.1

## 0.1.4

### Patch Changes

- Updated dependencies
  - @oa-sdk/codegen@0.8.0

## 0.1.3

### Patch Changes

- - @oa-sdk/core: Introduce recursive `JsonPrimitive<T>` and `Resolved<T>` wire-format types stripping methods, getters, and symbols to guarantee JSON wire safety.
  - @oa-sdk/parser: Add zero-decorator `@oaOperation <METHOD> <PATH>` JSDoc route extraction (`extractTsOperationsFromSource`, `extractTsOperationsFromFile`).
  - @oa-sdk/codegen: Implement OpenAPI 3.2 Schema Object to Zod 4 generator (`generateZodFromSpec`, `oa-gen generate:zod`) with automated preflight validation/normalization, and add `oa-gen audit:shape` CLI for 24-feature TypeScript shape taxonomy auditing.
  - @oa-sdk/client: Apply wire-safe response payload signatures using `Resolved<T>`.
  - @oa-sdk/spec-lens: Add transitive `tsconfig` universe dependency digestion (`computeTsconfigUniverse`) and SQLite cache key invalidation.
- Updated dependencies
  - @oa-sdk/parser@0.3.0
  - @oa-sdk/codegen@0.7.0

## 0.1.2

### Patch Changes

- Updated dependencies
  - @oa-sdk/parser@0.2.0
  - @oa-sdk/codegen@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/codegen@0.5.0
  - @oa-sdk/parser@0.1.2
