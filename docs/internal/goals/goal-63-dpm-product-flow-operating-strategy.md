# Goal 63 - DPM Product Flow Operating Strategy

**Status: complete 2026-07-08**

> Predecessor: [Goal 62 - DPM Package Consumer Audit Readback Smoke](./goal-62-dpm-package-consumer-audit-readback-smoke.md)

## Purpose

Recent DPM stabilization work proved several important product paths, but the goal/test unit size started drifting toward one assertion per small rule. That makes the package safer in the short term but harder to operate: every natural readback or helper invariant becomes another goal, another matrix sentence, and another test to maintain.

Goal 63 sets the operating strategy for future DPM work: prove large product flows, add narrow tests only for high-risk contracts, and avoid creating new goals for behavior that is already naturally covered by a representative flow.

## Operating Model

### Representative Flow Gates

Use representative flow gates as the default proof surface. A representative flow may assert several checkpoints, but it should be owned as one product path.

| Flow gate | Purpose | Current evidence |
|---|---|---|
| public package consumer workflow | focused subpaths can run the product review path without deep imports | `packages/dpm/test/package-consumer-workflow-smoke.mjs` |
| gateway consumer workflow | documented OpenAPI contract can be resolved into runtime handlers and repositories | `packages/dpm/test/gateway-consumer-smoke.test.ts` |
| profile Kafka demo | captured Kafka evidence can move through profile, analysis, review, approval, and registry export | `packages/dpm/examples/profile-kafka/run-demo.mjs` |
| storage demo | storage-backed catalog/registry/report flow works without live source credentials | `packages/dpm/examples/customer-orders-storage/run-demo.mjs` |
| package surface gate | built subpaths, declaration consumption, and pack boundary stay usable | root `pnpm check:dpm-surface` |

### Separate Narrow Tests Only When Needed

Create a separate narrow test or goal only when one of these conditions is true:

- A public API/export contract can regress independently of the representative flow.
- A privacy/safety boundary can leak raw values, credentials, token material, or reverse lookup behavior.
- A storage or adapter contract has materially different behavior across implementations.
- A real bug, review finding, or production-risk gap was found and needs a regression guard.
- A schema/taxonomy enum is a cross-surface contract consumed by generated OpenAPI, runtime responses, or package subpaths.

Do not add a separate goal/test when the behavior is just a natural readback inside an already covered product path. For example, after a workflow proves approval, audit readback, conflict blocking, and registry state stability, avoid adding another goal only to call the snapshot export runtime unless that call reveals a distinct contract risk.

## Goal Sizing Policy

Future DPM goals should be product-slice sized:

- Good: "public review workflow covers profile analysis, approval, audit readback, and blocking behavior."
- Good: "storage adapter conflicts are normalized across Postgres and split repositories."
- Too small: "call registry snapshot export after approval from the same in-memory repository."
- Too small: "assert one more field from an already schema-valid response."

When a new assertion belongs to an existing representative flow, update the flow smoke in place and reference the same gate. Do not mint a new goal unless the assertion changes ownership, public contract, risk class, or operator behavior.

## Documentation Policy

- `docs/internal/spec.md` records the stable strategy and current source-of-truth paths.
- `docs/internal/feature-test-matrix.*` names representative capabilities, not every internal assertion.
- `docs/internal/goals/progress-index.md` remains a progress checklist only. It should not become a detailed test inventory.
- Package README explains the consumer route and gate commands, not every expected field.

## Verification Policy

Default DPM stabilization evidence should be:

```bash
pnpm check:dpm-surface
pnpm --filter @oa-sdk/dpm typecheck
pnpm build:scripts && pnpm check:feature-tests
pnpm check:api-index
pnpm check:release-policy
git diff --check
```

Add focused `vitest` commands only for the changed contract. Avoid broadening the command list to every nearby test file when the representative gate already exercises the product path.

## Stop Rule

Before adding a new test or goal, ask:

1. Is this a user-visible product flow, public contract, privacy/safety boundary, storage/adapter divergence, or real regression?
2. Would an existing representative flow prove the behavior if it fails?
3. Will a new test make future design decisions clearer, or only freeze another implementation detail?

If the answer to 1 is no, or 2 is yes and 3 is "only implementation detail," do not add a new test. Prefer documenting the judgment or leaving the behavior covered by the representative flow.

## Done Criteria

- Future DPM work has a documented strategy for choosing representative flow gates over micro-goals.
- The strategy preserves high-risk tests while reducing test/goal churn around naturally covered readbacks.
- Existing representative gates remain the primary proof path for product usability.
