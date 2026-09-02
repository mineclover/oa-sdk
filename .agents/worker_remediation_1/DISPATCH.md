## 2026-09-02T22:42:24Z

You are the implementation Worker for the Victory Audit Remediation in @oa-sdk/codegen.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Remediation report: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_remediation_1/handoff.md
Audit failure report: /Users/junwoobang/workflow/oa-sdk/.agents/victory_auditor_1/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive Write Ownership:
- packages/codegen/src/standalone-guards/generator.ts
- packages/codegen/test/audit-csp/adversarial-csp.test.ts
- packages/codegen/test/standalone-guards/generator.test.ts

Task:
1. Read .agents/explorer_remediation_1/handoff.md carefully.
2. Update packages/codegen/src/standalone-guards/generator.ts:
   - Replace external `ajv-formats` with `STANDALONE_FORMATS` zero-dependency regex registry (supporting uri, date-time, email, uuid, time, date, duration, hostname, ipv4, ipv6, byte, int32, int64, json-pointer, url, etc.).
   - Implement `postProcessGeneratedJs` that:
     a. Converts `export const` to named `export function`.
     b. Replaces `require("ajv/dist/runtime/ucs2length")` with inlined `__ucs2length`.
     c. Replaces `require("ajv/dist/runtime/equal")` with inlined `__equal`.
     d. Inlines format regexes if any stray format `require()` occurs.
     e. Guarantees 0 external imports, 0 `require()`, 0 `eval()`, 0 `new Function()`.
   - Ensure a minimal `package.json` with `{"type": "module"}` is written to `outDir` (if not already present) in both split mode and monolithic mode so Node.js resolves all emitted `.js` files natively as ESM.
3. Update `packages/codegen/test/audit-csp/adversarial-csp.test.ts` lines 428-454 per the remediation report.
4. Build codegen package (`pnpm --filter @oa-sdk/codegen build`) and execute tests:
   - `pnpm --filter @oa-sdk/codegen test` (verify all 95 files pass, including `R1-ADV-5`).
   - `pnpm test` (verify full monorepo test suite passes with code 0).
   - `pnpm -r typecheck` (verify 21 workspace projects clean).
   - Test CSP audit on RFC 9457 `ProblemDetails` schema with `format: "uri"` to verify 0 CSP violations and exit code 0.
5. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_remediation_1/handoff.md` and notify parent via send_message.
