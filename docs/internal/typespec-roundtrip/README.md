# TypeSpec Roundtrip

This folder contains the active production-operation and authoring materials for the TypeSpec roundtrip track.

The sidecar-less authored bundle vocabulary is standardized exclusively in
[`oa-sdk-typespec-extensions.v5.md`](./oa-sdk-typespec-extensions.v5.md).

The current authoring source-of-truth boundary is summarized in [`authoring-ownership-guide.md`](./authoring-ownership-guide.md).

The current sidecar-to-extension migration workflow is documented in [`sidecar-to-extension-migration.md`](./sidecar-to-extension-migration.md).

The current full canonical authored fixture is [`fixtures/authored-canonical-bundle/`](./fixtures/authored-canonical-bundle/).

The OpenFGA resource registry consumer analysis fixture is [`fixtures/openfga-resource-registry-consumer/`](./fixtures/openfga-resource-registry-consumer/).
It is a shadow contract for the external demo service and is not part of the production schema bundle.

The current publish, validation, versioning, rollback, and source-ownership procedure is tracked in [`production-operations.md`](./production-operations.md).

The proposed follow-up design for historical external-input evidence, semantic
environment profiles, typed helper lifecycle, and automation-guidance alignment
is tracked in [`feedback-followup-design.md`](./feedback-followup-design.md).

The proposed declaration-to-restored-OpenAPI `$ref` provenance artifact,
validation gates, and staged CI adoption are tracked in
[`declaration-ref-provenance-validation-plan.md`](./declaration-ref-provenance-validation-plan.md).

The proposed logical-ERD TypeSpec profile, neutral artifact, catalog evidence,
and provenance/diff rollout are tracked in
[`logical-erd-typespec-profile.plan.md`](./logical-erd-typespec-profile.plan.md).

The production TypeSpec source bundle is [`../../../packages/schemas/typespec/`](../../../packages/schemas/typespec/).
