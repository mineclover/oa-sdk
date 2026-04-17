# User Scenario Tests

This document is the single source of truth for user-facing end-to-end scenario coverage.
Each row maps a user concern to the executable test that protects it.

| Priority | Scenario | User Trust Signal | Test Location | Status |
|---:|---|---|---|---|
| 1 | Schema diff / breaking change gate | Contract changes are automatically classified before release. | `apps/playground/tests/schema-diff-breaking-gate.test.ts` | Covered |
| 2 | bun-graph-db projection consumption E2E | Runtime table projections can be consumed by OA SDK validation, typegen, client, and mock flows. | `apps/playground/tests/bun-graph-db-projection-consumption.test.ts` | Covered |
| 3 | Definition Builder replacement dry-run | Builder replacement candidates can be tested without mutating `.merged.yaml`. | `packages/codegen/src/__tests__/builder-replacement-dry-run.test.ts` | Covered |
| 4 | OpenAPI 3.2 <-> 3.1 roundtrip no-loss check | Downgrade sidecar data restores 3.2-only fields without loss. | `packages/schemas/scripts/__tests__/roundtrip-lossless.test.ts` | Covered |
| 5 | Multi-target API generation | Public, admin, and internal targets emit isolated OpenAPI/typegen/client surfaces. | `packages/codegen/src/__tests__/builder-multi-target.test.ts` | Covered |
| 6 | Auth/security client + mock scenario | Generated auth middleware satisfies mock-server enforcement for bearer, apiKey, OAuth2, query key, and mTLS pass-through. | `apps/playground/tests/security-contract.test.ts` | Covered |
| 7 | Webhook + callback full loop | An inbound operation records an outbound callback attempt, and that payload is accepted by an inbound webhook route. | `packages/mock-server/src/__tests__/integration/webhook-callback-loop.test.ts` | Covered |
| 8 | Incremental cache invalidation under target builds | Shared fragment changes invalidate every dependent target while unrelated targets stay clean. | `packages/codegen/src/__tests__/builder-incremental-targets.test.ts` | Covered |
| 9 | Generated router/client compile together with real handlers | Generated types, router, client, and concrete handler implementations typecheck together. | `apps/playground/tests/generated-handler-contract.test.ts` | Covered |
| 10 | Example quality / mock readiness gate | Mock response examples are checked against their documented schema before being trusted. | `packages/mock-server/src/__tests__/oas32/spec-examples.test.ts` | Covered |

## Maintenance Rule

When a user scenario test is added, removed, renamed, or materially changes scope, update this document in the same change.
The table should stay scenario-oriented rather than feature-oriented; lower-level unit tests remain tracked by package-local test files and the feature test matrix.
