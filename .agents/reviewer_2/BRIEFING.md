# BRIEFING — 2026-09-11T06:06:00Z

## Mission
Conduct independent adversarial and quality review of Mock Server HTTP response serialization and static header preallocation (Milestone M2) in @oa-sdk/mock-server.

## 🔒 My Identity
- Archetype: reviewer / critic
- Roles: reviewer, critic
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/reviewer_2
- Original parent: d0cddab6-f867-4aaa-b30e-0224e58b2fac
- Milestone: Final Review
- Instance: 2 of 2
- Current Task Milestone: Milestone M2 Review (Mock Server & Governance)
- Parent Agent ID: 6e9162db-e15b-42e5-9757-50c9b9433e62

## 🔒 Key Constraints
- Review-only — do NOT modify implementation code
- Check integrity violations (hardcoded test results, facade implementations, bypassed tasks, fabricated outputs)
- Issue verdict: APPROVE or REQUEST_CHANGES

## Current Parent
- Conversation ID: 6e9162db-e15b-42e5-9757-50c9b9433e62
- Updated: 2026-09-11T05:58:45Z

## Review Scope
- **Files to review**: `packages/mock-server/src/adapters/node-http.ts`
- **Interface contracts**: PROJECT.md, ORIGINAL_REQUEST.md (## 2026-09-11T05:20:05Z), oa-runtime SKILL.md
- **Review criteria**:
  1. Precomputed static response payloads & header records in `ServerRoutingState.precomputed`.
  2. Fast-path bodiless request bypass in `readBody`.
  3. URL pathname and query parsing fast paths.
  4. `req.headers` extraction using fast `for..in` loop.
  5. Streaming responses, dynamic overrides, and schema validation preservation.
  6. 0.00% error rate and 0 file descriptor leaks under Keep-Alive HTTP load.
  7. Verification gates: mock-server test (656 tests), test:downstream, test-parity.ts, check:docs, check:cli-spec, check:api-index.

## Key Decisions Made
- Confirmed `packages/mock-server/src/adapters/node-http.ts` contains genuine, highly optimized implementation without facade or shortcut patterns.
- Verified precalculation accurately captures deterministic responses while preserving dynamic fallbacks via `picked.status === precalc.status && picked.body === precalc.originalBody`.
- Verified bodiless request bypass uses RFC 9110 compliant checks (`te === undefined && (cl === undefined || cl === '0')`) with `req.resume()`, preventing socket stalls and eliminating promise/listener allocations.
- Verified URL parsing fast path avoids WHATWG URL parser allocations for relative paths while cleanly falling back for absolute/proxy URLs.
- Conducted independent adversarial testing covering absolute proxy URLs, chunked bodiless GET, complex query parameters, HEAD method, SSE streaming, and 1,000 Keep-Alive requests with concurrent `updateSpec` swaps (0 errors).
- All 6 verification commands passed with 100% compliance.
- Final verdict: APPROVE.

## Artifact Index
- handoff.md — Milestone M2 review report
- progress.md — Liveness heartbeat
- DISPATCH.md — Task dispatches

## Review Checklist
- **Items reviewed**: `packages/mock-server/src/adapters/node-http.ts`, `packages/mock-server/src/__tests__/integration/node-http.test.ts`, `scripts/bench/bench-zod-mock.ts`, `.agents/explorer_m2_1/test-parity.ts`.
- **Verdict**: APPROVE
- **Unverified claims**: None. All claims independently reproduced and verified.

## Attack Surface
- **Hypotheses tested**:
  1. Absolute forward-proxy URLs break fast-path URL parsing -> RESOLVED (clean fallback to WHATWG URL parser).
  2. Bodiless GET with `Transfer-Encoding: chunked` hangs with `req.resume()` -> RESOLVED (`te !== undefined` bypasses fast path to `readRaw`).
  3. Dynamic overrides or streaming responses are bypassed by `precalc` -> RESOLVED (checked before `precalc` or excluded).
  4. Concurrent `updateSpec` under Keep-Alive HTTP load causes race conditions -> RESOLVED (atomic `state` snapshot capture in handler).
  5. Repeated query parameters (`?filter=a&filter=b`) misparsed -> RESOLVED (accumulates array; strictly validated against schema).
- **Vulnerabilities found**: None.
- **Untested angles**: None.
