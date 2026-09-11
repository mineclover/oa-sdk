# @oa-sdk/spec-lens

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
