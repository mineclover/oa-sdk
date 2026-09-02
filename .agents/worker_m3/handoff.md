# Handoff Report: Milestone 3 — Manifest V3 CSP Audit Command (R3)

**Author**: Worker Agent M3  
**Date**: 2026-09-03T07:16:50Z  
**Scope**: Manifest V3 Content Security Policy (CSP) Audit CLI Command (`oa-codegen audit:csp --bundle <dir>`) and TypeScript AST Scanner  
**Status**: COMPLETE

---

## 1. Observation

### 1.1 Requirements & Constraints
- Requirement R3 specifies a dedicated CLI command `oa-codegen audit:csp --bundle <dir>` (or alias `oa-gen audit:csp`) scanning bundled JavaScript/TypeScript files for Manifest V3 CSP compliance:
  1. `eval(...)` calls (`csp/no-eval`)
  2. `new Function(...)` / `Function(...)` invocations (`csp/no-new-function`)
  3. `setTimeout(string, ...)` and `setInterval(string, ...)` calls where the first argument is a string literal or template literal (`csp/no-string-settimeout`, `csp/no-string-setinterval`)
  4. Disallowed heavy schema engines or SDK runtime imports: `ajv`, `zod`, `@oa-sdk` (or subpaths) via static ESM imports/exports, dynamic imports, or CommonJS `require(...)` (`csp/no-disallowed-import`)
- Upon encountering any violation, the CLI must output structured diagnostics (rule, message, file:line:col, code excerpt) and exit with code 1 via `CliExitError(1)`. On clean bundles, it must report 0 violations and exit with code 0.

### 1.2 Implemented Files & Code Layout
- `packages/codegen/src/cli/commands/audit-csp.ts`:
  - `auditCsp: Command` CLI command definition with required `--bundle, -b` option.
  - `auditCspSourceSync` / `auditCspSource`: AST visitor analyzing JavaScript files via `ts.createSourceFile` and node traversal.
  - `collectBundleFiles`: Recursive bundle file collector supporting directory traversal and direct single-file targets.
  - `auditCspBundle`: High-level bundle scanner returning structured `CspAuditResult`.
  - Dynamic TypeScript module loader (`getTs`) preventing esbuild/tsup from bundling the 10MB TypeScript compiler into the CLI binary startup graph.
- `packages/codegen/src/cli/commands.ts`:
  - Registered `auditCsp` in the exported `commands` array.
- `packages/codegen/test/audit-csp/audit-csp.test.ts`:
  - 15 comprehensive unit and integration tests covering clean bundles, generated split guards, all violation rules, and error handling.

---

## 2. Logic Chain

1. **AST Syntactic Analysis**:
   - Rather than relying solely on naive regex matching that could produce false positives (e.g. comments, property names like `obj.eval`, or valid `setTimeout(() => {}, 100)`), the scanner uses the TypeScript Compiler API AST (`ts.createSourceFile`) to inspect CallExpressions, NewExpressions, ImportDeclarations, ExportDeclarations, and ImportEqualsDeclarations.
2. **Identifier & Expression Normalization**:
   - Unwrapping helper `unwrapExpression` handles parenthesized expressions (e.g. `(0, eval)("code")`) and comma expressions.
   - Callee checks (`isTargetIdentifier`) detect direct invocations as well as global property accesses on `window`, `globalThis`, and `self` (e.g. `window.eval`, `globalThis.Function`).
3. **Timer String Argument Differentiation**:
   - Timers with function callbacks (e.g. `setTimeout(() => {}, 1000)` or `setTimeout(myHandler, 500)`) are allowed. Only timers where the first argument is a `StringLiteral`, `NoSubstitutionTemplateLiteral`, or `TemplateExpression` trigger `csp/no-string-settimeout` or `csp/no-string-setinterval`.
4. **Disallowed Module Specifier Pattern**:
   - Pattern `/^(ajv(-[a-z0-9_]+)?(\/.*)?|zod(\/.*)?|@oa-sdk(\/.*)?)$/` catches `ajv`, `ajv-formats`, `ajv/dist/2020`, `zod`, `zod/...`, `@oa-sdk`, and all `@oa-sdk/*` runtime imports across ESM `import`, `export ... from`, CommonJS `require(...)`, and dynamic `import(...)`.
5. **CLI Startup Bundle Size & Runtime Safety**:
   - Statically importing `typescript` in CLI commands causes `tsup` to bundle `typescript` into `dist/cli/index.js`, where CommonJS `require('fs')` inside typescript fails in ESM chunks. By dynamically loading `typescript` at execution time, `dist/cli/index.js` remains lightweight (494 KB) and runs cleanly.
6. **Diagnostics & Exit Code**:
   - Position mapping calculates exact 1-indexed `line` and `column` from `sourceFile.getLineAndCharacterOfPosition`.
   - On violations: logs formatted diagnostic list with rule ID, line:col, and source snippet, then throws `CliExitError(1)`.

---

## 3. Caveats

- The bundle scanner skips `node_modules` and `.git` subdirectories during recursive directory scans to prevent traversing external third-party development tools.
- Typescript type declarations (`.d.ts`) and TypeScript source files (`.ts`) are not treated as client execution bundles; only JavaScript files (`.js`, `.mjs`, `.cjs`) within the `--bundle` target are audited as runtime bundle artifacts.

---

## 4. Conclusion

Milestone 3 (Manifest V3 CSP Audit Command - R3) is fully implemented, verified, and integrated into `@oa-sdk/codegen`.
- Running `oa-gen audit:csp --bundle <dir>` cleanly audits JavaScript bundles.
- Standalone guard generation outputs (both unified and `--split` modular guards) pass with 0 CSP violations.
- Violating bundles with `eval()`, `new Function()`, string timers, or `ajv`/`zod`/`@oa-sdk` imports are accurately diagnosed and exit with code 1.

---

## 5. Verification Method

### 5.1 Automated Test Execution

```bash
# 1. Run CSP Audit unit and integration test suite (15 tests)
pnpm --filter @oa-sdk/codegen test test/audit-csp/audit-csp.test.ts

# 2. Run E2E test suite (62 tests)
pnpm --filter @oa-sdk/codegen test test/e2e/cli-expansions.e2e.test.ts

# 3. Run Standalone Guards test suite (23 tests)
pnpm --filter @oa-sdk/codegen test test/standalone-guards/

# 4. Build codegen package
pnpm --filter @oa-sdk/codegen build

# 5. Verify full monorepo typecheck (21 packages)
pnpm -r typecheck
```

### 5.2 Direct CLI Invocation

```bash
# Check CLI command help
node packages/codegen/dist/cli/index.js --help

# Audit clean bundle (exit code 0)
node packages/codegen/dist/cli/index.js audit:csp --bundle <clean-dir>

# Audit violating bundle (exit code 1)
node packages/codegen/dist/cli/index.js audit:csp --bundle <violating-dir>
```
