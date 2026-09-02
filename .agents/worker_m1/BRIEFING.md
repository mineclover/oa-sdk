# BRIEFING — 2026-09-02T22:13:30Z

## Mission
Implement Milestone 1: Standalone Guards Splitting & Filtering (R1) in `@oa-sdk/codegen`.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: Milestone 1 (R1 - Standalone Guards Splitting & Filtering)

## 🔒 Key Constraints
- Exclusive Write Ownership:
  - packages/codegen/src/standalone-guards/
  - packages/codegen/src/cli/commands/generate.ts
  - packages/codegen/test/standalone-guards/
- DO NOT CHEAT. All implementations must be genuine.
- Split mode (`split: true`): output `guards/<TypeName>.js` and `guards/<TypeName>.d.ts` for each schema, inlining any $ref sub-schemas so each file is 100% self-contained with 0 runtime dependencies. Emit root `index.js` and `index.d.ts` barrel re-exports.
- Filter resolved guards when `schemas` is provided.

## Current Parent
- Conversation ID: c8e6c449-4228-4443-bc32-e90615c118a5
- Updated: 2026-09-02T22:13:30Z

## Task Summary
- **What to build**: Standalone guard splitting and filtering options in `@oa-sdk/codegen`.
- **Success criteria**:
  - `StandaloneGuardGeneratorOptions` supports `split?: boolean` and `schemas?: string[]`.
  - Selective filtering by `schemas` array matching type names, guard names, or normalized prefixes.
  - Split generation outputs per-guard files (`guards/<TypeName>.js`, `guards/<TypeName>.d.ts`) + root barrel re-exports (`index.js`, `index.d.ts`).
  - Self-contained inlined refs for split guard files (0 runtime dependencies, 0 eval/new Function).
  - CLI `generate` command supports `--split` and `--schemas`.
  - All unit, CLI, and E2E tests passing and monorepo typecheck passing.
- **Interface contracts**: packages/codegen/src/standalone-guards/types.ts
- **Code layout**: packages/codegen/

## Key Decisions Made
- In split mode, each schema is compiled with `standaloneCode(ajv, { [guard.name]: guard.name })`, ensuring sub-schemas referenced via `$ref` are inlined directly into that individual module.
- Root barrels re-export each modular guard file (`export * from './guards/<fileBase>.js';`).
- Schema filter matches exact guard name, type name, prefix-normalized (`is` prefix addition/removal), and case-insensitivity.

## Artifact Index
- /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/DISPATCH.md — Assignment instructions
- /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/progress.md — Liveness & progress tracking
- /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md — Final handoff report

## Change Tracker
- **Files modified**:
  - `packages/codegen/src/standalone-guards/types.ts`: added `split` and `schemas` options
  - `packages/codegen/src/standalone-guards/generator.ts`: implemented split generation and selective schema filtering
  - `packages/codegen/src/cli/commands/generate.ts`: exposed `--split` and forwarded `split` and `schemas`
  - `packages/codegen/test/standalone-guards/generator.test.ts`: added unit tests for split mode and selective filtering
  - `packages/codegen/test/standalone-guards/cli.test.ts`: added CLI tests for `--split`, `--schemas`, and combination
- **Build status**: PASS (`tsup` build succeeded)
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS (23/23 tests in `test/standalone-guards/`, 27/27 tests in `standalone-guards.e2e.test.ts`, 20/20 R1 tests in `cli-expansions.e2e.test.ts`)
- **Lint status**: Clean
- **Tests added/modified**: 8 new unit tests in `generator.test.ts` + 3 new CLI tests in `cli.test.ts`

## Loaded Skills
- None
