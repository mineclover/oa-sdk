# ADR-010 - Relationship-First DPM Implementation Baseline

## Status

Accepted, dated 2026-07-01.

This ADR closes `DPM-00 Decision Landing` for Goal 4. It fixes the implementation
baseline before package scaffolding, schema authoring, registry modeling, compiler
work, or gateway contract work begins.

## Context

Goal 4 extends OA SDK from API contract management into database-backed
pseudonymized data product contracts. The core design risk is not only direct PII
exposure. It is also relationship breakage: if related identifiers are tokenized
independently by physical column, an AI or analytics consumer can receive a
valid-looking dataset whose joins are semantically wrong.

The accepted DPM concept is therefore relationship-first:

1. collect structural catalog evidence,
2. discover candidate logical relationships,
3. approve relationships through a Relationship Registry,
4. bind token namespaces from logical entities and approved relationships,
5. validate column policy against that relationship context,
6. compile an execution plan and dry-run report,
7. publish AI-readable relationship context without exposing source DB, vault, or
   token reverse lookup APIs.

## Decision

Adopt DPM as an independent relationship governance package and implement it
through a CLI-first deterministic contract loop.

| Decision point | Accepted decision |
|---|---|
| Package ownership | Create `@oa-sdk/dpm` as a new private workspace package. |
| Manifest schema source | Use JSON Schema as the source of truth for DPM manifest syntax. |
| Gateway contract source | Use TypeSpec/OpenAPI for the DPM gateway API after the CLI loop is stable. |
| Registry storage default | Treat Postgres as the canonical long-term registry store and YAML snapshots as deterministic review/test artifacts. |
| MVP DB engine | Support PostgreSQL catalog semantics first; use SQLite only for lightweight fixtures if needed. |
| Execution mode | Start CLI-first with `validate`, `compile`, and `dry-run`; defer HTTP runtime. |
| Condition representation | Use `condition_sql` text plus metadata in v1; revisit structured predicate AST before `DPM-05` if needed. |
| Auto approval | Keep relationship candidate auto-approval off by default. |

## Alternatives Considered

### Package ownership

`@oa-sdk/dpm` was chosen because the feature includes manifest syntax, registry
snapshots, semantic validation, compilation, dry-run, gateway contracts, and AI
publishing context. The package name leaves room for that lifecycle.

Rejected alternatives:
- `@oa-sdk/pseudonymization-manifest`: too narrow once registry, compiler, and
  publishing context become first-class.
- absorbing DPM into `@oa-sdk/codegen`: mixes privacy governance with code
  generation and makes package ownership unclear.

### Schema authoring source

JSON Schema was chosen for the manifest because DPM policy needs deterministic
fixture validation before any DB access or API runtime exists.

Rejected alternatives:
- TypeSpec-first for the manifest: aligns with ADR-009 for production OpenAPI
  artifacts, but is less direct for policy-file validation fixtures.
- dual source of truth: too likely to drift between manifest validation and API
  contract generation.

The gateway API remains TypeSpec/OpenAPI-owned. OpenAPI describes operations such
as validate, compile, dry-run, execute job, and report retrieval. It does not own
the DPM policy body.

### Registry storage

Postgres plus YAML snapshots was chosen because relationship lifecycle is
database-like while review and tests need stable files.

Rejected alternatives:
- file-only registry: easy to review, but weak for lifecycle, audit, ownership,
  and concurrent approval workflows.
- storage abstraction first: flexible, but premature before the relationship
  lifecycle and compiler inputs are proven.

### MVP database engine

PostgreSQL-first was chosen because relationship discovery and catalog validation
depend on real catalog semantics: schemas, indexes, unique constraints, foreign
keys, type compatibility, and stable source coordinates.

Rejected alternatives:
- SQLite-first: useful for small tests, but too different from target catalog
  semantics.
- multi-engine-first: broadens the MVP before the relationship model is stable.

### Gateway mode

CLI-first was chosen so the deterministic loop can be proven without introducing
HTTP auth, job persistence, deployment, or secret-boundary concerns.

Rejected alternatives:
- HTTP-first: product-shaped earlier, but pulls runtime concerns into the core
  manifest/registry/compiler decision phase.
- library-only: simple for internal use, but delays the contract shape needed for
  OA SDK gateway integration.

## Consequences

- `@oa-sdk/dpm` becomes the owner for DPM manifest schema, fixtures, catalog
  snapshot types, registry snapshot types, semantic validator, compiler, dry-run,
  CLI, gateway contract bindings, and publishing context.
- `@oa-sdk/codegen` and `@oa-sdk/schemas` can integrate with DPM, but do not own
  relationship policy semantics.
- Root `build`, `test`, and `typecheck` wiring should wait until the DPM package
  has meaningful schema/model tests.
- The first code milestone is package scaffold plus manifest schema fixtures,
  not catalog discovery or runtime execution.
- Runtime token vault behavior, reversible token APIs, physical FK creation, and
  HTTP execution jobs remain out of v1 core.

Implementation note, 2026-07-01: root wiring has landed after the DPM package gained
schema/model/validator/compiler/CLI/gateway/publishing tests. Runtime storage remains
the Goal 5 boundary.

## Breakpoints

Stop and update the goal documents before proceeding if any of these decisions
become necessary:

- `condition_sql` text plus metadata cannot express polymorphic or temporal
  relationships safely.
- Discovery needs query logs or ORM metadata to produce useful review reports.
- Compiler work requires real token vault semantics instead of plan-only output.
- HTTP gateway work requires authentication, job persistence, or secret storage.
- Publishing context requires physical FK creation in a target database.
- Multi-tenant canonical key rendering requires escaping beyond the v1 format.

## DPM-00 Exit Criteria Mapping

| Criterion | Evidence |
|---|---|
| package ownership decided | `@oa-sdk/dpm` accepted in this ADR |
| registry storage default decided | Postgres canonical store plus YAML snapshots accepted |
| schema authoring source decided | JSON Schema-first manifest and TypeSpec/OpenAPI gateway split accepted |
| `condition_sql` v1 representation decided | text plus metadata accepted, AST breakpoint deferred |
| MVP DB engine and fixture strategy decided | PostgreSQL-first with optional SQLite fixtures accepted |
| gateway mode decided | CLI-first with later HTTP runtime accepted |

## Verification

This ADR is documentation-only. The required gate is:

- `git diff --check`

## Related Documents

- [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)
- [Relationship-First Data Pseudonymization Manifest PRD](../../../tasks/prd-data-pseudonymization-manifest.md)
- [Goal 4 - Relationship-First DPM Roadmap](../goals/goal-4-dpm-relationship-first-roadmap.md)
- [Goal 4 - DPM Implementation Strategy](../goals/goal-4-dpm-implementation-strategy.md)
- [Goal Progress Index](../goals/progress-index.md)
