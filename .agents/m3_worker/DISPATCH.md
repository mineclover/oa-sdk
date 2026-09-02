## 2026-09-02T15:00:12Z

You are the Worker for Milestone 3: Standalone Lightweight Type Guard Generator Plugin in @oa-sdk/codegen.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/m3_worker
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

File Ownership:
- `packages/codegen/src/standalone-guards/`
- `packages/codegen/src/cli/commands/generate.ts`
- `packages/codegen/package.json` (ensure ajv and ajv-formats dependencies are present)
- `packages/codegen/test/standalone-guards/`

Task:
1. Ensure `ajv` (>=8.17.0) and `ajv-formats` (>=3.0.1) are available in `packages/codegen/package.json` dependencies.
2. Implement `generateStandaloneGuards(options: StandaloneGuardGeneratorOptions): Promise<GeneratedGuardArtifact[]>` in `packages/codegen/src/standalone-guards/generator.ts`:
   - Pre-compile JSON Schema Draft 2020-12 / OpenAPI 3.1 schemas using `ajv/dist/2020` and `ajv/dist/standalone` (`standaloneCode`).
   - Emit pure ESM `.js` validator functions with ZERO runtime dependencies and ZERO `eval()` or `new Function()` calls (strict CSP-safe).
   - Emit TypeScript `.d.ts` declarations with type guard signatures (`export declare function isType(data: unknown): data is Type;`) with configurable `--type-import` / `typeImportSpecifier`.
   - Support standalone bundles with index re-exports.
3. Wire `--target standalone-guards` into the CLI generator in `packages/codegen/src/cli/commands/generate.ts`:
   - Support `--input <path>`, `--out-dir <path>`, `--target standalone-guards`, `--type-import <specifier>`, `--module-format esm`.
4. Re-export `generateStandaloneGuards` and types from `packages/codegen/src/index.ts`.
5. Author comprehensive unit tests in `packages/codegen/test/standalone-guards/`:
   - Happy path schema compilation (primitives, objects, arrays, oneOf/discriminator, formats).
   - Zero-eval & zero-dependency invariant assertions on emitted JS content.
   - Type guard `.d.ts` declaration generation.
   - CLI invocation verification.
6. Run tests and typechecks:
   `pnpm --filter @oa-sdk/codegen test`
   `pnpm --filter @oa-sdk/codegen typecheck`
7. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/m3_worker/handoff.md`.
