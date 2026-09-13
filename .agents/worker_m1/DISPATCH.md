## 2026-09-12T18:52:20Z
You are the Router Core Worker for Milestone 1 in @oa-sdk/router.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m1

MANDATORY INPUTS:
- You MUST read the authoritative user request at: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (under ## 2026-09-12T18:45:11Z)
- You MUST read the project architecture at: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_11/PROJECT.md
- You MUST read the survey findings and blueprints at: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_router/report.md
- Relevant skills: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-runtime/SKILL.md and /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md

EXCLUSIVE FILE WRITE OWNERSHIP:
You own exclusively:
- `packages/router/src/targets/elysia.ts`
- `packages/router/src/targets/fastify.ts`
- `packages/router/src/targets/hono.ts`
- `packages/router/src/targets/express.ts`
- `packages/router/src/contracts/handler-contract.ts`
- `packages/router/src/generate-router-renderer.ts`
- `packages/router/src/__tests__/*`
- `tests/e2e/multi-framework-router/*`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

TASK REQUIREMENTS:
1. R1: Router Response Envelope Collision Defense:
   - In `packages/router/src/targets/{elysia.ts,fastify.ts,hono.ts,express.ts}`, replace the heuristic with the strict 3-part predicate:
     `result !== undefined && result !== null && typeof result === 'object' && 'body' in result && ((result as any).status === undefined || typeof (result as any).status === 'number') && ((result as any).headers === undefined || typeof (result as any).headers === 'object')`
   - Ensure entities with `status: string`, `body: string`, or `headers: string` (e.g. `{ id: 'order_1', status: 'PENDING', total: 5000 }` or `{ status: 'ACTIVE' }`) fall through to default 200 serialization without property loss across all 4 targets.
   - For envelopes with `resp.status === 204`, ensure 204 no-content handling is preserved (e.g. `reply.status(204).send()` in Fastify, `c.body(null, 204)` in Hono, `return` in Elysia).

2. R2: Handler Contract Multi-Status & Error Response Type Union:
   - In `packages/router/src/contracts/handler-contract.ts`:
     Upgrade `HandlerResponse` to:
     ```ts
     export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =
       | TSuccess
       | { status: 200; body: TSuccess; headers?: THeaders }
       | { [K in keyof TErrorMap]: { status: K; body: TErrorMap[K]; headers?: Record<string, string> } }[keyof TErrorMap]
     ```
   - In operation handler signatures, generate `HandlerResponse<${bodyType}>` (or with headers when present) so handlers can return `{ status: 404, body: ... }` with 100% type safety and zero `as any` casting.
   - Update string assertions in existing tests (`packages/router/src/__tests__/handler-contract.test.ts`, `tests/e2e/multi-framework-router/tier1-feature-coverage.test.ts`, `tests/e2e/multi-framework-router/challenger2-empirical.test.ts`) that check the exact text of `HandlerResponse`.

3. R6: Router Render Options & Facade Typing Integrity:
   - In `packages/router/src/generate-router-renderer.ts`:
     Add `contextInjection?: boolean`, `context?: boolean`, `contextImport?: string`, and `contextTypeName?: string` to `RouterRenderOptions`.
   - Remove `as any` casting in `packages/router/src/__tests__/challenger-tier5-context.test.ts` (lines 329, 343, 355, 381, etc.).

4. Unit & Stress Tests:
   - Add new tests verifying R1 envelope collision defense for entities with `status: string`, `body: string`, `headers: string` across Fastify, Elysia, Hono, and Express.
   - Add new tests verifying R2 typed error return without `as any`.
   - Add new tests verifying R6 context injection options in `generateRouter` without `as any`.

VERIFICATION:
Run the following build and test commands and include their exact outputs in your handoff report:
- `pnpm --filter @oa-sdk/router build`
- `pnpm --filter @oa-sdk/router test`
- `pnpm vitest run tests/e2e/multi-framework-router`
- `pnpm --filter @oa-sdk/router typecheck` (or `tsc --noEmit`)

DELIVERABLE:
Write your complete handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m1/handoff.md` with:
- Observation
- Logic Chain
- Code Changes Made
- Build and Test Results
- Caveats
Then send a completion message back to the orchestrator using `send_message`.
