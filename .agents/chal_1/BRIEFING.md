# BRIEFING — 2026-09-02T15:12:00Z

## Mission
Empirically stress-test and adversarially challenge Proposal 1 (Discriminated Union Projection) and Proposal 2 (Surface Linting / Non-AST Patching Metadata) across @oa-sdk.

## 🔒 My Identity
- Archetype: EMPIRICAL CHALLENGER
- Roles: critic, specialist
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/chal_1
- Original parent: 68ae2354-2e51-4b8a-8016-61950725263e
- Milestone: Empirical Verification Proposals 1 & 2
- Instance: 1 of 1

## 🔒 Key Constraints
- Review-only — do NOT modify implementation code
- Run all verification code ourselves empirically
- Put only metadata in .agents/
- Deliver challenge.md and handoff.md with explicit APPROVE/REJECT verdict

## Current Parent
- Conversation ID: 68ae2354-2e51-4b8a-8016-61950725263e
- Updated: 2026-09-02T15:12:00Z

## Review Scope
- **Files to review**:
  - `packages/openapi-projection-contract/src/discriminated-union.ts`
  - `packages/openapi-projection-contract/src/surface-extensions.ts`
  - `packages/parser/src/lint.ts`
  - `packages/openapi-projection-contract/test/e2e/discriminated-union.e2e.test.ts`
  - `packages/openapi-projection-contract/test/e2e/surface-extensions.e2e.test.ts`
  - `packages/parser/test/e2e/surface-lint.e2e.test.ts`
- **Interface contracts**: PROJECT.md, oa-sdk-integration-proposals.md
- **Review criteria**: correctness, adversarial robustness, edge cases, error handling, conformance

## Attack Surface
- **Hypotheses tested**:
  - Empty variants / malformed options handling -> PASS
  - Mismatched const/enum discriminator values -> PASS
  - Surface extension constants & predicate boundaries -> PASS
  - Parser surface lint rules & category filtering -> PASS
  - MCP stdio / RPC variant schema naming heuristics -> FAIL (6 bugs found in E2E suite)
  - Path prefix trailing slash normalization -> FAIL (1 bug found in E2E suite)
  - Variant naming collisions for distinct keys -> FAIL (1 bug found in E2E suite)
- **Vulnerabilities found**:
  - `determineVariantSchemaName` truncates `unionSchemaId` prefix when `unionSchemaId` ends with `Request` (e.g. `McpRequest` + `tools/list` -> `ToolsListRequest` instead of `McpRequestToolsList`).
  - `pathPrefix` with trailing slashes (e.g. `/rpc/`) creates double slashes `/rpc//ping`.
  - Silent key collision when two distinct variant keys produce identical PascalCase names (e.g. `user.get` and `user_get` both map to `MsgUserGet`), overwriting schema definitions.
- **Untested angles**:
  - None within Proposals 1 & 2 scope; full coverage reached.

## Loaded Skills
None currently required beyond standard critic/specialist methodology.

## Key Decisions Made
- Executed full test suites for both packages.
- Authored and executed dedicated adversarial test suites in both packages.
- Identified 3 distinct defects in Proposal 1 causing 6 E2E test failures.
- Verified Proposal 2 has 100% test pass rate and high adversarial robustness.
- Issued verdict: **REJECT** (due to Proposal 1 E2E failures).

## Artifact Index
- `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/DISPATCH.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/BRIEFING.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/progress.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/challenge.md`
- `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/handoff.md`
- `packages/openapi-projection-contract/test/adversarial-proposals-1-2.test.ts`
- `packages/parser/test/adversarial-surface-lint.test.ts`
