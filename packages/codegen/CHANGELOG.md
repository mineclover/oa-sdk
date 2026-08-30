# @oa-sdk/codegen

## 0.6.0

### Minor Changes

- Harden public OpenAPI generation and release tooling. Core now exposes safe
  TypeScript literal helpers; parser adds OAS 3.2 querystring support and stricter
  reference handling; codegen improves generated client/type output and fails
  closed when TypeSpec export would lose contract-bearing semantics.

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.2.0
  - @oa-sdk/parser@0.2.0

## 0.5.0

### Minor Changes

- e0f2d5b: Prepare the OA Gen CLI and its runtime dependency closure (including the TypeSpec decorator
  library required by provenance tooling) for public npm distribution,
  including explicit package boundaries, Node runtime requirements, and a packed-artifact smoke test.

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/core@0.1.2
  - @oa-sdk/openapi-projection-contract@0.1.2
  - @oa-sdk/parser@0.1.2
  - @oa-sdk/typespec-decorators@0.1.2
  - @oa-sdk/client@0.1.1
  - @oa-sdk/router@0.1.1
