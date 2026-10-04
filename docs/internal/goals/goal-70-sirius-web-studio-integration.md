# Goal 70 - Sirius Web Studio Integration (candidate)

**Status: scope-gated candidate (opened 2026-10-05). Requires Goal 69.7 and a
scope decision before implementation.**

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
| A. Read-only projection | Export the Goal 69.7 ref-preserving graph as a versioned JSON artifact; a Sirius importer maps it to an EMF model with oa-sdk identifiers as object ids | Diagram and table views of the real `schemas` contract; layout survives re-import |
| Decision gate | Compare against extending `apps/spec-lens` (React + d3) for the same use cases | Continue only if model-level editing or multi-notation views are required |
| B. Edit proposals | TypeSpec adapter that turns structured edits (`addField`, `addRelationship`, `rename`) into span-targeted `TextEdit`s; edit API via `defineTool`; result lands as a git branch and is re-verified by `schema:typespec-check`, provenance check, and `tsp diff` | A Sirius edit produces a reviewable TypeSpec diff that passes existing gates |

## First Domain

Start with spec-lens `SpecGraph` because it is populated from the production
contract. Logical ERD has richer semantics (cardinality, keys, TypeSpec spans)
but production `.tsp` files do not use the `typespec-erd` decorators yet.

## Non-goals

- Bridging `collab-workspace` / `chunk-stream-crdt` into Sirius Web. Those are
  line-granular text CRDTs; Sirius Web has its own representation event model.
- Hosting or operating Sirius Web from this monorepo.
