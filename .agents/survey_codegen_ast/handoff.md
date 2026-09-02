# Handoff Report: Codegen, AST & Projection Integration Blueprint

## 1. Observation

1. **Workspace and Package Layout**:
   - Monorepo packages located at `/Users/junwoobang/workflow/oa-sdk/packages/`:
     - `openapi-projection-contract` (`package.json`, `src/index.ts`)
     - `parser` (`package.json`, `src/lint.ts`, `src/schema-validator.ts`, `src/definition-openapi-projection.ts`)
     - `codegen` (`package.json`, `src/zod-to-schema.ts`, `src/type-registry-canonical-ir.ts`, `src/typegen/schema-to-ts.ts`, `src/cli/commands/generate.ts`, `src/cli/lib/source-adapters.ts`)
     - `spec-lens` (`package.json`, `src/domain/`, `src/infrastructure/`)
     - `spec-lens-contract` (`package.json`, `src/index.ts`)
     - `schemas` (`package.json`, `src/domains/`, `src/targets/`)
2. **Current Projection Profile Semantics**:
   - In `packages/openapi-projection-contract/src/index.ts:1-5`:
     ```typescript
     export const OPENAPI_PROJECTION_PROFILES = [
       'component-bundle',
       'operation-contract',
       'full-api-document',
     ] as const
     ```
   - Extensions currently registered: `x-schema-engine-profile`, `x-schema-engine-version-hash`, `x-schema-engine-sources`, `x-schema-engine-refs`.
3. **Current OAS Linter**:
   - In `packages/parser/src/lint.ts:48`:
     ```typescript
     categories?: Array<'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components'>
     ```
   - No current checks for `x-surface-*` vendor extensions.
4. **Current Codegen & Dependencies**:
   - In `packages/codegen/package.json:57-71`:
     `dependencies` includes `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`, `@typespec/*`, `yaml`, `zod`.
     `ajv` is **not** present in `packages/codegen/package.json` (it is in `packages/parser/package.json:37`).
   - In `packages/codegen/src/cli/commands/generate.ts:13-19`:
     CLI options support `config`, `drizzle-schema`, `output`, `merge-into`, `schemas`. `--target` for standalone guards is not yet handled.
   - In `packages/codegen/src/type-registry-canonical-ir.ts:1-488`:
     Robust TypeScript AST normalization and canonical IR (`TYPE_REGISTRY_CANONICAL_IR_VERSION`) already exists, providing the AST parsing foundation for `EntitySpec` adapters.
5. **Monorepo Baseline Verification**:
   - Running `pnpm -r typecheck` executed cleanly across all 21 packages without errors.

---

## 2. Logic Chain

1. **Proposal 1 (Discriminated Union Projection)**:
   - Observation 2 shows `@oa-sdk/openapi-projection-contract` provides profile-based envelopes.
   - Adding `projectDiscriminatedUnion` and `DiscriminatedUnionProjectionOptions` in `packages/openapi-projection-contract/src/discriminated-union.ts` allows constructing OpenAPI 3.1 `discriminator` + `mapping` + `oneOf` objects for both `operation-contract` and `component-bundle` profiles.
   - In `packages/codegen/src/zod-to-schema.ts`, augmenting `convertType()` for `z.ZodDiscriminatedUnion` ensures discriminator mappings are automatically attached to generated schemas.
2. **Proposal 2 (Non-AST Surface Range Patching Metadata Extensions)**:
   - Observation 2 & 3 show extension naming conventions and linter rule structure.
   - Adding `packages/openapi-projection-contract/src/surface-extensions.ts` standardizes `x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style`, and `x-surface-patch-policy`.
   - Adding the `'surface'` category to `packages/parser/src/lint.ts` allows validating surface anchors, character range bounds, and SHA-256 hashes during document linting.
3. **Proposal 3 (Standalone Lightweight Type Guard Generator Plugin)**:
   - Observation 4 shows `ajv` is currently missing from `@oa-sdk/codegen`.
   - Adding `"ajv": "^8.17.0"` and `"ajv-formats": "^3.0.1"` to `packages/codegen/package.json` enables invoking `Ajv2020` with `standaloneCode` (`ajv/dist/standalone/index.js`).
   - Creating `packages/codegen/src/standalone-guards/generator.ts` and wiring `--target standalone-guards` into `packages/codegen/src/cli/commands/generate.ts` generates pure ESM `.js` with 0 external dependencies and 0 `eval()` calls alongside `.d.ts` declarations.
4. **Proposal 4 (TypeScript AST Bidirectional Synchronization / V3 Architecture)**:
   - Observation 4 shows existing AST canonical IR extraction in `packages/codegen/src/type-registry-canonical-ir.ts`.
   - Creating `packages/codegen/src/ast-sync/` with `EntitySpec`, `TypeAdapter` interface, `TsAstAdapter`, `ZodAdapter`, and `TypiaAdapter` establishes bidirectional synchronization.
   - The reverse-offset bottom-up `TextEdit` patching algorithm in `packages/codegen/src/ast-sync/text-edit.ts` guarantees lossless preservation of comments, formatting, and indentation when updating TypeScript source files.

---

## 3. Caveats

- **External Toolchain Compatibility**: Standalone guard generation requires compiling against JSON Schema Draft 2020-12 / OpenAPI 3.1; any legacy OpenAPI 3.0 schemas must be normalized or upgraded before standalone compilation.
- **Typia Runtime Dependency**: `TypiaAdapter` operates on TypeScript AST types at build time. Generating pure Typia transformers requires TypeScript compiler transformations during code emission.

---

## 4. Conclusion

All 4 architectural proposals map directly and cleanly onto existing `@oa-sdk` packages:
1. `projectDiscriminatedUnion` in `@oa-sdk/openapi-projection-contract` + `zod-to-schema.ts`.
2. `x-surface-*` extensions in `@oa-sdk/openapi-projection-contract` + `lint.ts` in `@oa-sdk/parser`.
3. Standalone type guard plugin (`generateStandaloneGuards`) in `@oa-sdk/codegen` with `ajv/dist/standalone`.
4. V3 Unified Architecture `EntitySpec` engine and `TypeAdapter`s (`TsAstAdapter`, `ZodAdapter`, `TypiaAdapter`) with reverse-offset bottom-up `TextEdit` patching in `@oa-sdk/codegen`.

The integration plan is detailed in `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/analysis.md`.

---

## 5. Verification Method

To verify the integration and subsequent implementation:
1. **Typecheck verification**:
   ```bash
   pnpm -r typecheck
   ```
2. **Package unit tests**:
   ```bash
   pnpm --filter @oa-sdk/openapi-projection-contract test
   pnpm --filter @oa-sdk/parser test
   pnpm --filter @oa-sdk/codegen test
   ```
3. **Full test suite**:
   ```bash
   pnpm test
   ```
4. **Artifact verification**:
   - Inspect `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/analysis.md`
   - Inspect `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/handoff.md`
