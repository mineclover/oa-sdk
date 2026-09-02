# Handoff Report: Milestone 1 — Native Discriminated Union Projection

## 1. Observation
- **Package Under Modification 1**: `@oa-sdk/openapi-projection-contract`
  - Created `packages/openapi-projection-contract/src/discriminated-union.ts` implementing `projectDiscriminatedUnion`, `projectDiscriminatedUnionDocument`, and associated types `DiscriminatedUnionProjectionOptions`, `DiscriminatedUnionProjectionResult`, and `DiscriminatedUnionDocumentOptions`.
  - Re-exported from `packages/openapi-projection-contract/src/index.ts`.
  - Created unit tests in `packages/openapi-projection-contract/test/discriminated-union.test.ts` and `packages/openapi-projection-contract/src/discriminated-union.test.ts`.
- **Package Under Modification 2**: `@oa-sdk/codegen`
  - Modified `packages/codegen/src/zod-to-schema.ts` in `convertType` for `z.ZodDiscriminatedUnion` to construct OpenAPI 3.1 `discriminator.mapping` by matching variant literal / enum values with registered component names in `context.refs`.
  - Added unit test cases to `packages/codegen/src/__tests__/zod-to-schema.test.ts`.
- **Command Results**:
  - `pnpm --filter @oa-sdk/openapi-projection-contract test`: 8 test files passed (122 tests).
  - `pnpm --filter @oa-sdk/openapi-projection-contract typecheck`: exited 0 with no errors.
  - `pnpm --filter @oa-sdk/codegen test src/__tests__/zod-to-schema.test.ts`: 1 test file passed (83 tests).
  - `pnpm --filter @oa-sdk/codegen typecheck`: exited 0 with no errors.

## 2. Logic Chain
1. Multi-operation RPC transports (e.g. Chrome Native Messaging, MCP JSON-RPC 2.0 stdio) multiplex diverse procedures over a single stream.
2. In OpenAPI 3.1, polymorphic union models must be represented via `discriminator` with `propertyName` and explicit `mapping` dictionaries referencing component schemas, accompanied by `oneOf` arrays containing reference objects.
3. `projectDiscriminatedUnion` accepts `DiscriminatedUnionProjectionOptions` (`discriminatorProperty`, `unionSchemaId`, `variants`, `profile`, `pathPrefix`, `description`, `baseProperties`, `baseRequired`, `componentRefPrefix`), validates presence and integrity of discriminator keys, extracts/normalizes variant schemas, injects discriminator `const` and `required` where omitted, builds the root `unionSchema`, and conditionally generates operation paths (e.g. `/rpc/{method}`, `/mcp/{op}`) with standard 200/422/500 responses when `profile === 'operation-contract'` or `pathPrefix` is defined.
4. In `zod-to-schema.ts`, `z.ZodDiscriminatedUnion` now examines `context.refs` to resolve variant schemas into `#/components/schemas/{RefName}` and populates `discriminator.mapping` for both single literals and string enums.

## 3. Caveats
- `projectDiscriminatedUnion` operates on raw schema representations / objects without imposing an external runtime dependency on `zod` inside the leaf package `@oa-sdk/openapi-projection-contract`, while `@oa-sdk/codegen` handles Zod AST mappings directly.

## 4. Conclusion
- Native discriminated union projection is fully implemented, strictly type-checked, and thoroughly verified across both `@oa-sdk/openapi-projection-contract` and `@oa-sdk/codegen`.

## 5. Verification Method
Execute the following verification commands from repository root `/Users/junwoobang/workflow/oa-sdk`:
```bash
pnpm --filter @oa-sdk/openapi-projection-contract build
pnpm --filter @oa-sdk/openapi-projection-contract test
pnpm --filter @oa-sdk/openapi-projection-contract typecheck
pnpm --filter @oa-sdk/codegen test src/__tests__/zod-to-schema.test.ts
pnpm --filter @oa-sdk/codegen typecheck
```
All commands must exit with code 0 and all tests must pass.
