# Goal 70 - Sirius Web Studio Integration

**Status: Phase A B1·B2 approved (2026-10-05); B3 waits for the B4 comparison.**

## Purpose

Eclipse Sirius Web is a graphical studio layer: it represents and edits domain
concepts as diagrams, forms, tables, and other representations on a
Spring / React / PostgreSQL / GraphQL stack with EMF-based semantic models.
Goal 70 evaluates Sirius Web as a visual review and editing surface over the
oa-sdk contract model.

## Ownership Boundary

- TypeSpec under `packages/schemas/typespec/` remains the only source of truth
  (ADR-009). Sirius Web never owns contract data.
- Sirius Web persists only representation state (layout, styles, view
  configuration) keyed by stable oa-sdk identifiers.
- The Sirius Web studio lives in a separate Java repository. This monorepo
  owns only the exchange artifact and the edit API.
- Rejected: Sirius/Ecore as the source of truth with TypeSpec generated from
  it. That introduces a second type system and bypasses the existing TypeSpec
  gates.

## Existing Hooks

| Need | oa-sdk asset |
|---|---|
| Graph model | spec-lens `SpecGraph` (`packages/spec-lens-contract/src/index.ts`), `LogicalErdArtifact` (`packages/logical-erd-contract/src/types.ts`) |
| Stable identity | `canonicalId`, `contentHash` in spec-lens provenance |
| OpenAPI to TypeSpec span mapping | `TypeSpecRefProvenance` (`packages/codegen/src/cli/lib/typespec-ref-provenance.ts`), logical ERD source spans |
| Formatting-preserving edits | ast-sync `TextEdit` / `applyTextEdits` (no TypeSpec adapter yet) |
| Drift policy vocabulary | `x-surface-patch-policy` (`onDrift: abort / rebase / force`) |
| Edit API exposure | `@oa-sdk/tools` `defineTool` (MCP, CLI, REST) |

## Phases

| Phase | Content | Exit criterion |
|---|---|---|
| A. Read-only projection | Export the Goal 69.7 ref-preserving graph (`projectRefGraph` in `@oa-sdk/parser`, available) as a versioned JSON artifact; a Sirius importer maps it to an EMF model with oa-sdk identifiers as object ids | Diagram and table views of the real `schemas` contract; layout survives re-import |
| Decision gate | Compare against extending `apps/spec-lens` (React + d3) for the same use cases | Continue only if model-level editing or multi-notation views are required |
| B. Edit proposals | TypeSpec adapter that turns structured edits (`addField`, `addRelationship`, `rename`) into span-targeted `TextEdit`s; edit API via `defineTool`; result lands as a git branch and is re-verified by `schema:typespec-check`, provenance check, and `tsp diff` | A Sirius edit produces a reviewable TypeSpec diff that passes existing gates |

## First Domain

Start with spec-lens `SpecGraph` because it is populated from the production
contract. Logical ERD has richer semantics (cardinality, keys, TypeSpec spans)
but production `.tsp` files do not use the `typespec-erd` decorators yet.

## Scope Decision (2026-10-05)

The user approved only the oa-sdk side of Phase A (orchestration decision D1).
B3 (Sirius importer) waits for the B4 comparison.

| Decision item | Recorded decision |
|---|---|
| User problem | Review the contract model as a graph without losing `$ref` structure, keyed by identifiers that stay stable across regeneration. |
| Core relation | B1 and B2 stay inside Core packages (`parser`, `codegen`, `spec-lens`, `spec-lens-contract`): a versioned export of `projectRefGraph` and a shared node-to-`canonicalId` mapping. No new workspace is added. |
| Owner | OA SDK maintainers own the exchange artifact schema and its compatibility. The Sirius-side Java repository has no owner yet; naming one is a precondition for B3. |
| Release/CI | The export command and its schema are covered by codegen tests and `check:cli-spec`; no new release track. |
| Location | This monorepo for B1/B2. Sirius Web code never enters it. |
| Exit condition | B1/B2: the artifact is versioned, schema-validated, and deterministic, and every node carries a stable `canonicalId` (or an explicit reason it has none). Goal 70 continues past Phase A only if B4 shows model-level editing or multi-notation views are required. |

| Unit | Content | Status |
|---|---|---|
| B1 | `oa-gen` command exporting `projectRefGraph` as a versioned artifact (`oa-sdk.ref-projection.v1`) with a schema contract and tests | approved |
| B2 | Map projection node ids to provenance `canonicalId`; promote spec-lens `nearestCanonicalId` to a shared function | approved |
| B3 | Sirius Web importer (separate Java repository) | waits for B4 |
| B4 | Decision gate: compare with extending `apps/spec-lens` | not started |

## Non-goals

- Bridging `collab-workspace` / `chunk-stream-crdt` into Sirius Web. Those are
  line-granular text CRDTs; Sirius Web has its own representation event model.
- Hosting or operating Sirius Web from this monorepo.
