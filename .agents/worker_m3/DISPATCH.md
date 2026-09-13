## 2026-09-12T19:24:16Z
You are the Codegen Core Worker for Milestone 3 in @oa-sdk/codegen.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3

MANDATORY INPUTS:
- You MUST read the authoritative user request at: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (under ## 2026-09-12T18:45:11Z)
- You MUST read the project architecture at: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_11/PROJECT.md
- You MUST read the survey findings and blueprints at: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_codegen/report.md
- Relevant skills: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-codegen/SKILL.md, /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-onboarding/SKILL.md, and /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md

EXCLUSIVE FILE WRITE OWNERSHIP:
You own exclusively:
- `packages/codegen/src/routing/import-resolver.ts`
- `packages/codegen/src/cli/commands/generate.ts`
- `packages/codegen/src/cli/commands/init.ts`
- `packages/codegen/src/cli/lib/init/composer.ts`
- `packages/codegen/src/cli/lib/init/interactive.ts`
- `packages/codegen/src/cli/lib/init/types.ts`
- `packages/codegen/src/cli/lib/init/index.ts`
- `packages/codegen/src/cli/lib/spec-watcher.ts`
- `packages/codegen/src/__tests__/*`

TASK REQUIREMENTS:
1. R5: Monorepo Package Boundary Awareness in Import Resolver:
   - In `packages/codegen/src/routing/import-resolver.ts`:
     - Implement `findNearestPackageJson(startPath)` searching upwards for the nearest package.json with a valid package name (skipping root monorepo manifests that define workspaces).
     - Implement `resolvePackageSpecifier(resolvedTo, toPkg)` resolving cross-package imports to canonical package names (`@oa-sdk/client`, `@my-org/api-client`, or `@org/pkg/subpath`), avoiding fragile `../../../../packages/...` paths while strictly preserving `./...` relative paths within the same package.
     - Integrate into `resolveImportSpecifier`.

2. R7: Unified Declarative Execution in `oa-gen generate`:
   - In `packages/codegen/src/cli/commands/generate.ts`:
     - Extend `runConfigDrivenPipeline` to inspect `core.contracts`, `core.client`, and `product.outputRouting`.
     - Orchestrate the complete declarative pipeline: Schema projection -> Type Guards -> Handler Contracts (`generateHandlerContract` from `@oa-sdk/router`) -> Client SDK (`generateClient` from `@oa-sdk/client`) -> TanStack Query options (`generateTanstackQuery` from `@oa-sdk/client`), dispatched to paths configured in `outputRouting` via `createPathDispatcher` and tracked by `OaManifestManager`.

3. R8: `outputRouting` Presets in `oa-gen init`:
   - In `packages/codegen/src/cli/commands/init.ts`, `composer.ts`, `interactive.ts`, `types.ts`, `index.ts`:
     - Support `--routing <default|fsd|monorepo|by-kind>` (short: `-r`) flag and prompt during interactive onboarding.
     - Emit an idiomatic `product.outputRouting` configuration block in generated `oa.config.ts`.
     - FIX CRITICAL SYNTAX ERROR in `composer.ts` `formatObject`: array of objects (`rules: [...]`) must wrap items with `{ ... }` so valid TypeScript syntax is emitted.

4. R9: Linux-Compatible File Watching Fallback in `spec-watcher.ts`:
   - In `packages/codegen/src/cli/lib/spec-watcher.ts`:
     - Detect Linux environments (`process.platform === 'linux'`).
     - Implement recursive directory walker (ignoring `node_modules`, `.git`, `dist`, `.turbo`, `.next`) to attach individual `fs.watch` instances across each directory level on Linux and dynamically attach watchers to newly created subdirectories without errors or process crashes.

5. Unit & Integration Tests:
   - Add tests for monorepo package boundary resolution in `import-resolver`.
   - Add tests for `oa-gen generate` full pipeline orchestration.
   - Add tests for `oa-gen init --routing <preset>`.
   - Add tests for `spec-watcher.ts` nested directory watching and Linux fallback.

## 2026-09-12T19:40:10Z
[From: 637f3fa4-5819-4bf3-a4bf-2056e9d9736f (orchestrator)]
**Context**: Milestone 3 Codegen Core Implementation (R5, R7, R8, R9)
**Content**: Checking in on your progress. Please report your current status on:
1. R5: Monorepo Package Boundary Awareness in Import Resolver
2. R7: Unified Declarative Execution in oa-gen generate
3. R8: outputRouting presets & syntax error fix in oa-gen init
4. R9: Linux-Compatible File Watching Fallback in spec-watcher.ts
5. Tests and verification commands
**Action**: Please update your progress.md with your current step and reply with your status.
