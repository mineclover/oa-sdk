# E2E Test & Verification Infrastructure

> **Authoritative Specification SSOT**: [docs/concepts/test-infrastructure.md](./docs/concepts/test-infrastructure.md)  
> **Model**: Opaque-Box, Requirement-Driven 4-Tier Verification + Tier 5 Adversarial Hardening  
> **Suite Location**: `packages/codegen/src/__tests__/e2e/`  

The complete, normative documentation for the 4-Tier E2E testing architecture, test invariants (Opaque-Box Evaluation, Submodule Invariant, Deterministic Execution), and Tier 5 adversarial stress testing is maintained in:

👉 **[docs/concepts/test-infrastructure.md](./docs/concepts/test-infrastructure.md)**

---

## Quick Verification Commands

```bash
# 1. Run all 202 dedicated E2E tests (Tier 1 to 4 + Subdirectory Conformance)
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e

# 2. Run Tier 5 adversarial hardening tests
pnpm --filter @oa-sdk/codegen test src/__tests__/challenger-m5-adversarial-hardening.test.ts

# 3. Verify monorepo-wide TypeScript compilation (21 packages)
pnpm -r typecheck

# 4. Verify documentation links and CLI specification governance
pnpm check:docs
pnpm exec tsx scripts/check-cli-spec.ts
```
