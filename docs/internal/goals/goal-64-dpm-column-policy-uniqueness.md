# Goal 64 - DPM Column Policy Uniqueness

**Status: complete 2026-07-10**

> Predecessor: [Goal 63 - DPM Product Flow Operating Strategy](./goal-63-dpm-product-flow-operating-strategy.md)

## Purpose

A DPM manifest must declare exactly one policy for each physical `(table, column)` coordinate. Previously, identical or conflicting duplicate entries passed semantic validation and the compiler emitted multiple steps for the same `columnRef`, leaving execution precedence ambiguous.

Goal 64 makes column policy uniqueness a compile-blocking safety invariant shared by the library, CLI, and gateway paths.

## Decision

- The first policy for a `(table, column)` coordinate owns that coordinate.
- Every later policy for the same coordinate is rejected, including an identical copy.
- `SAF013` identifies the duplicate policy at `/columns/{duplicateIndex}` and includes the table/column catalog coordinate.
- Duplicate policies are not merged and no first-wins or last-wins execution precedence is introduced.
- The JSON Schema remains responsible for shape. Cross-item coordinate uniqueness remains a semantic validator rule.

## Implementation

- `packages/dpm/src/validator/safety-column-uniqueness-gates.ts` owns coordinate uniqueness diagnostics.
- `packages/dpm/src/validator/safety-validator.ts` runs the collection gate before per-column safety gates.
- `packages/dpm/src/validator/diagnostic-taxonomy.ts` publishes `SAF013` to library and generated gateway diagnostic schemas.
- `compileDpmPlan()` continues to call the shared manifest validator before plan assembly, so a duplicate never produces a compiled plan.
- CLI validate and gateway validate/compile paths continue to use the same shared validator.

## Verification

Focused regression coverage proves:

- identical and conflicting duplicates both return `SAF013`;
- the diagnostic points to the later `/columns/{index}` entry;
- compiler and gateway compile responses do not contain a plan;
- CLI validation exits non-zero;
- gateway blocking responses remain schema-valid.

Required gates:

```bash
corepack pnpm --filter @oa-sdk/dpm test
corepack pnpm --filter @oa-sdk/dpm typecheck
corepack pnpm check:dpm-surface
git diff --check
```

## Done Criteria

- A valid manifest contains at most one policy for each `(table, column)` coordinate.
- Identical and conflicting duplicates are compile-blocking.
- Library, CLI, and gateway paths expose the same `SAF013` contract.
- Existing valid manifests and representative DPM flows remain green.
