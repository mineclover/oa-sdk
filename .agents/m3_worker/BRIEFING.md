# BRIEFING — 2026-09-02T15:08:40Z

## Mission
Implement Milestone 3: Standalone Lightweight Type Guard Generator Plugin in @oa-sdk/codegen (`generateStandaloneGuards`, CLI `--target standalone-guards`, pure ESM zero-eval validator + .d.ts generation).

## 🔒 My Identity
- Archetype: implementer
- Roles: implementer, qa, specialist
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/m3_worker
- Original parent: 68ae2354-2e51-4b8a-8016-61950725263e
- Milestone: M3 (Standalone Lightweight Type Guard Generator Plugin)

## 🔒 Key Constraints
- Pure ESM validator with ZERO runtime dependencies and ZERO `eval()` or `new Function()` calls (CSP-safe).
- Pre-compile JSON Schema Draft 2020-12 / OpenAPI 3.1 using `ajv/dist/2020` and `ajv/dist/standalone`.
- Emit TypeScript `.d.ts` declarations with `export declare function isType(data: unknown): data is Type;`.
- CLI `--target standalone-guards` in `packages/codegen/src/cli/commands/generate.ts`.
- Re-export `generateStandaloneGuards` and related types in `packages/codegen/src/index.ts`.
- Thorough unit and integration tests under `packages/codegen/test/standalone-guards/`.
- Zero tolerance for shortcuts, cheating, or hardcoded fake validations.

## Current Parent
- Conversation ID: 68ae2354-2e51-4b8a-8016-61950725263e
- Updated: 2026-09-02T15:08:40Z

## Task Summary
- **What to build**: Standalone ESM Type Guard Generator using Ajv 2020 standalone compilation, CLI wiring in generate command, TypeScript .d.ts guard generation, and unit tests.
- **Success criteria**: All `@oa-sdk/codegen` tests and typechecks pass (86 test files / 974 tests), zero eval / zero dependency invariants verified, CLI works cleanly.
- **Interface contracts**: PROJECT.md § Interface Contracts (@oa-sdk/codegen), Proposal 3 Spec §3.2-3.3.
- **Code layout**: `packages/codegen/src/standalone-guards/` (`generator.ts`, `types.ts`, `index.ts`), `packages/codegen/src/cli/commands/generate.ts`.

## Key Decisions Made
- Added `ajv` (^8.18.0) and `ajv-formats` (^3.0.1) as direct dependencies in `packages/codegen`.
- Generated validator functions are compiled via `ajv/dist/standalone` and post-processed to emit explicit `export function <name>(data, ...args) { return <fn>(data, ...args); }` signatures.
- Emitted `.d.ts` declarations include `import type { ... } from '<typeImportSpecifier>'` if configured, and declare `(data: unknown): data is <TypeName>` predicates.
- Output includes both `guards.js`/`guards.d.ts` and barrel `index.js`/`index.d.ts` re-exports.

## Artifact Index
- `.agents/m3_worker/DISPATCH.md` — Worker assignment and instructions
- `.agents/m3_worker/BRIEFING.md` — Situational awareness and state
- `.agents/m3_worker/progress.md` — Step-by-step progress tracking
- `.agents/m3_worker/handoff.md` — 5-component handoff report
- `packages/codegen/src/standalone-guards/types.ts` — Type definitions
- `packages/codegen/src/standalone-guards/generator.ts` — Core generator implementation
- `packages/codegen/src/standalone-guards/index.ts` — Module entrypoint
- `packages/codegen/src/cli/commands/generate.ts` — CLI `--target standalone-guards` wiring
- `packages/codegen/test/standalone-guards/generator.test.ts` — Comprehensive generator unit tests
- `packages/codegen/test/standalone-guards/cli.test.ts` — CLI command unit tests

## Change Tracker
- **Files modified**:
  - `packages/codegen/package.json` — Added ajv, ajv-formats
  - `packages/codegen/src/index.ts` — Re-exported generateStandaloneGuards and types
  - `packages/codegen/src/cli/commands/generate.ts` — Added `--target standalone-guards` and options
  - `PROJECT.md` — Updated M3 status to DONE
- **Files created**:
  - `packages/codegen/src/standalone-guards/types.ts`
  - `packages/codegen/src/standalone-guards/generator.ts`
  - `packages/codegen/src/standalone-guards/index.ts`
  - `packages/codegen/test/standalone-guards/generator.test.ts`
  - `packages/codegen/test/standalone-guards/cli.test.ts`
- **Build status**: PASS
- **Pending issues**: none

## Quality Status
- **Build/test result**: 86/86 test files passed, 974/974 tests passed; typecheck passed
- **Lint status**: clean
- **Tests added/modified**: 12 new unit tests added across 2 test files covering schema compilation, invariants, .d.ts generation, and CLI invocation
