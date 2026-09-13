## 2026-09-12T19:06:37Z

You are the Client Core Worker for Milestone 2 in @oa-sdk/client.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2

MANDATORY INPUTS:
- You MUST read the authoritative user request at: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (under ## 2026-09-12T18:45:11Z)
- You MUST read the project architecture at: /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_11/PROJECT.md
- You MUST read the survey findings and blueprints at: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_client/report.md
- Relevant skills: /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-runtime/SKILL.md and /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-codegen/SKILL.md

EXCLUSIVE FILE WRITE OWNERSHIP:
You own exclusively:
- `packages/client/src/generate-client-renderer.ts`
- `packages/client/src/tanstack/options-factory-generator.ts`
- `packages/client/src/tanstack/hook-factory-generator.ts`
- `packages/client/src/tanstack/generate-tanstack.ts`
- `packages/client/src/__tests__/*`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

TASK REQUIREMENTS:
1. R3: AbortSignal & RequestInit Pass-Through Pipeline:
   - In `packages/client/src/generate-client-renderer.ts`:
     - Define exported type `ClientMethodOptions = { signal?: AbortSignal; headers?: Record<string, string> }`.
     - Extend all emitted client methods (regular methods, withResponse methods, streamSse, streamNdjson) to accept optional trailing `options?: ClientMethodOptions`.
     - Upgrade `__mergeOaRequestHeaders` to merge `defaultHeaders`, operation-declared headers, and `options.headers`.
     - Introduce helper `__combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined` using `AbortSignal.any` (with fallback) to compose user-supplied signals with client-level timeout signals.
     - Ensure internal `requestResponse`, `streamSse`, `streamNdjson` pass `options?.signal` down to `fetch(url, fetchInit)`.
   - In `packages/client/src/tanstack/options-factory-generator.ts`:
     - In TanStack Query `queryFn: async ({ signal }) => ...`, pass `{ signal }` into the client call: `client[method](...args, { signal })`.

2. R4: TanStack Query Infinite Query Generator:
   - In `packages/client/src/tanstack/options-factory-generator.ts`:
     - Implement `detectPagination(op)` to detect pagination parameters (`cursor`, `page`, `offset`, `limit`, `starting_after`) in GET query parameters and responses.
     - For paginated operations, emit `export function ${methodName}InfiniteQueryOptions(...)` alongside `queryOptions()`.
     - Wire `initialPageParam` and `getNextPageParam` with sensible defaults (cursor, page, offset) and allow overriding via `options`.
   - In `packages/client/src/tanstack/hook-factory-generator.ts`:
     - Emit `use${baseName}InfiniteQuery` and register `use${baseName}Infinite` in `createApiHooks(useClient)`.
   - In `packages/client/src/tanstack/generate-tanstack.ts`:
     - Update `generateCombinedFile` to import and emit the infinite query functions.
   - Preserves strict ZERO RUNTIME DEPENDENCY LEAKS invariant in `@oa-sdk/client/package.json` (no runtime dependencies on `@tanstack/react-query`).

3. Testing & Verification:
   - Add unit tests verifying AbortSignal cancellation aborts in-flight fetch requests.
   - Add unit tests verifying TanStack Query queryFn forwards signal.
   - Add unit tests verifying cursor, page, and offset pagination generate valid infiniteQueryOptions.
   - Run `tsc --noEmit` on generated code to prove zero compilation errors.

VERIFICATION:
Run the following build and test commands and include their exact outputs in your handoff report:
- `pnpm --filter @oa-sdk/client build`
- `pnpm --filter @oa-sdk/client test`
- `pnpm --filter @oa-sdk/client typecheck`
