## 2026-09-02T14:53:24Z

You are the Worker for Milestone 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture).
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/m4_worker
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

File Ownership:
- `packages/codegen/src/ast-sync/entity-spec.ts`
- `packages/codegen/src/ast-sync/adapter-interface.ts`
- `packages/codegen/src/ast-sync/adapters/zod.ts`
- `packages/codegen/src/ast-sync/adapters/ts-ast.ts`
- `packages/codegen/src/ast-sync/adapters/typia.ts`
- `packages/codegen/src/ast-sync/diff-engine.ts`
- `packages/codegen/src/ast-sync/text-edit.ts`
- `packages/codegen/src/ast-sync/type-sync.ts`
- `packages/codegen/src/ast-sync/index.ts`
- `packages/codegen/src/index.ts` (re-exporting ast-sync)
- `packages/codegen/test/ast-sync/`

Task:
1. Implement canonical `EntitySpec`, `EntityPropertySpec`, `PropertyConstraint`, `TextEdit`, `ASTDiff` in `packages/codegen/src/ast-sync/entity-spec.ts`.
2. Implement `TypeAdapter` interface in `packages/codegen/src/ast-sync/adapter-interface.ts`.
3. Implement pluggable type adapters:
   - `ZodTypeAdapter` (`packages/codegen/src/ast-sync/adapters/zod.ts`): parses `z.object({...})` AST and emits Zod code, unwrapping `.optional()`, `.nullable()`, `.describe()`, `.min()`, `.max()`, etc.
   - `TsAstTypeAdapter` (`packages/codegen/src/ast-sync/adapters/ts-ast.ts`): parses TypeScript `interface` / `type` alias AST and emits interface code.
   - `TypiaTypeAdapter` (`packages/codegen/src/ast-sync/adapters/typia.ts`): parses TypeScript interfaces with JSDoc validation tags (`@minimum`, `@maximum`, `@format`, `@default`) and preserves non-Typia JSDoc comments.
4. Implement `computeEntitySpecDiff(currentSpec: EntitySpec, targetSpec: EntitySpec): ASTDiff[]` in `packages/codegen/src/ast-sync/diff-engine.ts`.
5. Implement reverse-offset bottom-up `applyTextEdits(originalSource: string, edits: TextEdit[]): string` in `packages/codegen/src/ast-sync/text-edit.ts`:
   - Validates descending sort order (`start` desc), throws if overlapping ranges (`next.end > current.start`).
   - Guarantees 0 offset shifting, preserves whitespace, comments, trailing commas, and surrounding trivia.
6. Implement `syncEntitySpecWithCode(existingCode: string, updatedSpec: EntitySpec, options?: { adapter?: string | TypeAdapter }): SyncResult` in `packages/codegen/src/ast-sync/type-sync.ts`.
7. Write unit and integration tests in `packages/codegen/test/ast-sync/` covering AST parsing, code emission, diff calculation, reverse-offset patching, comment preservation, and type adapters.
8. Run tests and typecheck:
   `pnpm --filter @oa-sdk/codegen test`
   `pnpm --filter @oa-sdk/codegen typecheck`
9. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/m4_worker/handoff.md`.
