## 2026-09-02T15:09:09Z
You are Challenger 1 for empirical verification of Proposals 1 & 2 in @oa-sdk.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/chal_1
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read TEST_READY.md at /Users/junwoobang/workflow/oa-sdk/TEST_READY.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

Task:
Empirically stress test and adversarially challenge Proposal 1 (Discriminated Union Projection) and Proposal 2 (Non-AST Character Range Patching Metadata Extensions & Surface Linting):
1. Adversarially test `projectDiscriminatedUnion`:
   - Empty variant record, missing discriminator properties, mismatched const/enum values.
   - Multiplexed Chrome Native Messaging RPC protocols and MCP stdio operations.
   - Profile tagging under both `component-bundle` and `operation-contract`.
2. Adversarially test `x-surface-*` metadata extensions and parser linting:
   - Invalid SHA-256 fingerprint strings (non-hex, wrong length, bad prefix).
   - Inverted or negative character ranges.
   - Unknown quotation styles or patch policies.
   - Linting category filtering (`categories: ['surface']`).
3. Run all unit and E2E test suites in `@oa-sdk/openapi-projection-contract` and `@oa-sdk/parser`.
4. Write your challenge report to `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/challenge.md` and handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/chal_1/handoff.md` with an explicit verdict: APPROVE or REJECT.

Send a message to parent upon completion.
