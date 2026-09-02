# BRIEFING — 2026-09-03T07:16:45Z

## Mission
Implement Milestone 3: Manifest V3 CSP Audit Command (`oa-codegen audit:csp --bundle <dir>`) with TypeScript AST scanning, structured diagnostics, and exit code handling.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: M3 (Manifest V3 CSP Audit Command - R3)

## 🔒 Key Constraints
- Exclusive Write Ownership:
  - packages/codegen/src/cli/commands/audit-csp.ts
  - packages/codegen/src/cli/commands.ts
  - packages/codegen/test/audit-csp/ (or packages/codegen/test/cli-audit-csp.test.ts)
- Zero shortcuts / dummy implementations. Real AST scanning using TypeScript compiler API.
- All implementations must maintain real state and produce genuine diagnostics and exit codes.
- Tests must cover clean bundles, violating bundles, and AST edge cases.

## Current Parent
- Conversation ID: c8e6c449-4228-4443-bc32-e90615c118a5
- Updated: 2026-09-03T07:16:45Z

## Task Summary
- **What to build**:
  - `packages/codegen/src/cli/commands/audit-csp.ts`: `audit:csp` CLI command scanning `--bundle <dir>` (or file) for:
    1. `eval(...)` (`csp/no-eval`)
    2. `new Function(...)` and `Function(...)` (`csp/no-new-function`)
    3. `setTimeout(string, ...)` and `setInterval(string, ...)` (`csp/no-string-settimeout`, `csp/no-string-setinterval`)
    4. Disallowed heavy schema engines / SDK runtime imports: `ajv`, `zod`, `@oa-sdk` via static ESM imports/exports or CJS `require(...)` (`csp/no-disallowed-import`)
  - Register `auditCsp` in `packages/codegen/src/cli/commands.ts`.
  - Comprehensive unit and integration test suite in `packages/codegen/test/audit-csp/`.
  - Verify build & test cleanly across monorepo.
- **Success criteria**:
  - Clean bundles exit code 0.
  - Violations report file path, line, column, rule code, diagnostic message, code excerpt, and exit code 1 via `CliExitError(1)`.
  - Monorepo tests pass.
- **Interface contracts**: PROJECT.md § M3 & ORIGINAL_REQUEST.md § R3
- **Code layout**: PROJECT.md § Code Layout

## Loaded Skills
- **Source**: `/Users/junwoobang/.gemini/config/plugins/modern-web-guidance-plugin/skills/chrome-extensions/SKILL.md`
- **Core methodology**: Manifest V3 CSP constraints: no `eval()`, `new Function()`, string timers, or heavy dynamic runtime parsers in extension scripts; zero dynamic evaluation primitives.

## Change Tracker
- **Files modified**:
  - `packages/codegen/src/cli/commands/audit-csp.ts`: Implemented AST-based CSP scanner & `audit:csp` command with dynamic TS loader.
  - `packages/codegen/src/cli/commands.ts`: Registered `auditCsp` command in `commands` registry.
  - `packages/codegen/test/audit-csp/audit-csp.test.ts`: Added 15 comprehensive unit and CLI integration tests covering clean bundles, generated split guards, all violation rules, and error handling.
- **Build status**: PASS (tsup build and monorepo typecheck clean)
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS (15/15 tests in `test/audit-csp/audit-csp.test.ts`, 62/62 E2E tests in `test/e2e/cli-expansions.e2e.test.ts`, 23/23 in `test/standalone-guards/`)
- **Lint status**: Clean
- **Tests added/modified**: 15 tests in `packages/codegen/test/audit-csp/audit-csp.test.ts`

## Key Decisions Made
- Used TypeScript compiler API AST traversal (`ts.createSourceFile`, `visit`) to detect `eval`, `new Function`, `Function`, `setTimeout(string)`, `setInterval(string)`, and disallowed imports (`ajv`, `zod`, `@oa-sdk`).
- Loaded TypeScript via runtime dynamic import to avoid bundling the 10MB typescript package into the CLI entry point (`dist/cli/index.js`).
- Structured diagnostic outputs to match `@oa-sdk` CLI visual standards with line:col position and source code snippet.
- Thrown `CliExitError(1)` upon finding any violation.

## Artifact Index
- `.agents/worker_m3/DISPATCH.md` — Dispatch instructions
- `.agents/worker_m3/progress.md` — Heartbeat and step tracking
- `.agents/worker_m3/handoff.md` — 5-component handoff report
- `packages/codegen/src/cli/commands/audit-csp.ts` — CSP audit CLI command implementation
- `packages/codegen/src/cli/commands.ts` — Command registry
- `packages/codegen/test/audit-csp/audit-csp.test.ts` — Test suite
