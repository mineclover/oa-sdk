# TypeSpec Roundtrip Plans

This folder contains versioned implementation plans for the TypeSpec roundtrip track.

The parent evaluation document is [`../typespec-roundtrip.plan.md`](../typespec-roundtrip.plan.md). It owns the current evidence and TSP-first declaration criteria.

The sidecar-less authored bundle vocabulary is standardized in [`oa-sdk-typespec-extensions.v1.md`](./oa-sdk-typespec-extensions.v1.md) and [`oa-sdk-typespec-extensions.v2.md`](./oa-sdk-typespec-extensions.v2.md).

The current authoring source-of-truth boundary is summarized in [`authoring-ownership-guide.md`](./authoring-ownership-guide.md).

The current sidecar-to-extension migration workflow is documented in [`sidecar-to-extension-migration.md`](./sidecar-to-extension-migration.md).

The current full canonical authored fixture is [`fixtures/authored-canonical-bundle/`](./fixtures/authored-canonical-bundle/).

The OpenFGA resource registry consumer analysis fixture is [`fixtures/openfga-resource-registry-consumer/`](./fixtures/openfga-resource-registry-consumer/).
It is a shadow contract for the external demo service and is not part of the production schema bundle.

The TypeSpec-first decision design and completed G1-G8 evidence are tracked in [`tsp-first-decision-design.md`](./tsp-first-decision-design.md).

The production migration goals G9-G15 and source-path switch are tracked in [`production-migration-goals.md`](./production-migration-goals.md).

The current publish, validation, versioning, rollback, and source-ownership procedure is tracked in [`production-operations.md`](./production-operations.md).

The production TypeSpec source bundle is [`../../../packages/schemas/typespec/`](../../../packages/schemas/typespec/).

## Versions

| Target | Package | Plan | Status |
|---|---|---|---|
| `v0.3.0` | `@oa-sdk/codegen` | [`v0.3.0/implementation-roadmap.plan.md`](./v0.3.0/implementation-roadmap.plan.md) | complete |

Version folders are planning artifacts. They do not change package versions by themselves.
