# TypeSpec Production Migration Goals

Status: planned. ADR-009 accepts TypeSpec-first schema authoring, but the production schema build path still uses the current OpenAPI fragments until this migration lands with rollback evidence.

This document extends the completed G1-G8 decision roadmap with production migration goals. It does not reopen the TypeSpec-first decision; it scopes the work required to make the accepted TypeSpec bundle production-authoritative.

## Scope

The migration covers:

1. A production-owned TypeSpec source layout separate from evidence fixtures.
2. Schema build wiring that can produce or verify the production OpenAPI artifact from the TypeSpec bundle.
3. Rollback gates that keep the current OpenAPI path available until TypeSpec output has equivalent proof.
4. Downstream validation for the consumers that depend on the production OpenAPI artifact.

Out of scope:

- Adding a new `oa-sdk.typespec-extensions` schema version without a separate vocabulary decision.
- Moving runtime-only OA SDK behavior into TypeSpec comments or unchecked metadata.
- Removing the current OpenAPI production path before rollback commands are documented and verified.

## Goal Roadmap

| Goal | Purpose | Depends on | Done when |
|---|---|---|---|
| G9 Production TypeSpec source layout | Move from fixture-only evidence to a production-owned TypeSpec bundle location and ownership rule. | G8 and the accepted canonical fixture. | A production bundle directory, manifest, expected OpenAPI policy, and ownership note exist; the canonical evidence fixture remains a reproducible reference, not the production source. |
| G10 Schema build wiring | Connect the schema build or validation path to TypeSpec compile, OA SDK extension restore, expected diff, and OpenAPI 3.2 validation. | G9. | The selected schema command can validate the TypeSpec production bundle and either emits or verifies `packages/schemas/src/.merged.yaml` through the same bundle-check semantics. |
| G11 Rollback gate | Keep the current OpenAPI production path green and reversible while the TypeSpec path becomes authoritative. | G10. | A documented rollback command or procedure restores the last green OpenAPI path, and CI or local gates prove both rollback and TypeSpec paths before removing any old source path. |
| G12 Downstream consumer gates | Prove parser, codegen, router, client, and mock-server behavior against the TypeSpec-derived production OpenAPI. | G10 and G11. | Focused downstream commands run against the TypeSpec-derived artifact, and the feature matrix lists the maintained commands before the migration is considered complete. |

## Goal Boundaries

G9 should be a layout and ownership commit. It may copy or regenerate the accepted canonical bundle into a production-owned location, but it should not change the production schema command yet.

G10 should be the build wiring commit. It should preserve the current OpenAPI artifact until the TypeSpec-derived output has an equivalent validation and expected diff gate.

G11 should be a rollback evidence commit. It should make the fallback path explicit enough that a failed TypeSpec migration can be repaired without guessing which file or command is authoritative.

G12 should be a downstream verification commit. It should avoid broad unrelated refactors and should focus on the consumers named by ADR-009.

## Gate Commands

Baseline commands for every production migration goal:

```bash
pnpm check:feature-tests
pnpm check:api-index
pnpm check:cli-spec
git diff --check
```

Additional commands by goal:

| Goal | Commands |
|---|---|
| G9 | `pnpm typespec:create-canonical-fixture` and `pnpm typespec:bundle-check -- --manifest <production-bundle>/oa-sdk.typespec-bundle.json --fail-on-breaking` |
| G10 | `pnpm schema:bundle`, `pnpm schema:validate`, and `pnpm typespec:bundle-check -- --manifest <production-bundle>/oa-sdk.typespec-bundle.json --fail-on-breaking` |
| G11 | The rollback command introduced by G11, plus the G10 gates before and after rollback simulation. |
| G12 | `pnpm --filter @oa-sdk/codegen test`, `pnpm --filter @oa-sdk/router test`, `pnpm --filter @oa-sdk/client test`, and `pnpm --filter @oa-sdk/mock-server test` |

## Completion Checklist

The production migration is complete only when:

- The production TypeSpec bundle is the documented schema authoring source.
- `packages/schemas/src/.merged.yaml` can be regenerated or verified from that bundle.
- The old OpenAPI path remains recoverable until removal is explicitly approved.
- `tsp-bundle-check --fail-on-breaking` passes for the production bundle.
- OA SDK OpenAPI 3.2 validation passes for emitted and restored output.
- Extension or sidecar re-extraction is stable with no missing expected entries, unexpected actual entries, or value mismatches.
- Downstream codegen, router, client, and mock-server tests are green against the TypeSpec-derived artifact.
