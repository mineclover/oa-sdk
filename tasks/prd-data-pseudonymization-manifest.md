# PRD: Relationship-First Data Pseudonymization Manifest

## Status

Accepted. Goal 4 implemented the relationship-first DPM core loop. Runtime storage,
source catalog profiling, HTTP execution, vault integration, and persisted reports are
follow-up work tracked by Goal 5. This PRD supersedes the initial column-first DPM
draft. The baseline decision is that DPM v1 is a relationship-first manifest: token
namespaces are derived from logical entities and approved logical relationships, not
from isolated physical columns.

OpenAPI describes the DPM gateway API. It does not own DPM policy authoring.

Implementation progress is tracked in
`docs/internal/goals/progress-index.md` and implemented package details are tracked in
`docs/internal/spec.md`. The user-story checklists below remain the requirement inventory; runtime
and storage-only criteria move forward under Goal 5.

## Overview

OA SDK already manages OpenAPI contracts, schema projections, generated artifacts,
and governance reports. The next privacy-oriented expansion connects API design
with database design so AI/analytics datasets can be created from DB sources
without leaking direct identifiers or breaking relational semantics.

The core risk is not only PII exposure. It is also broken relationship semantics:
if `customers.customer_no`, `orders.customer_no`, and `tickets.customer_no` are
tokenized independently, AI consumers see a valid-looking but semantically broken
database. DPM therefore needs Relationship Discovery, Relationship Registry,
Relationship Approval, and Namespace Resolution before column transforms run.

## Goals

- Define DPM v1 as a relationship-first source-of-truth manifest.
- Treat Relationship Registry as the source of truth for logical relationships.
- Allow DB catalog snapshots or OpenAPI projection envelopes as structural input,
  while keeping relationship approval in the registry.
- Preserve entity identity and relationships through namespace bindings.
- Support composite, polymorphic, temporal, self-reference, and code lookup
  relationship forms.
- Add relationship-aware transforms such as `relationship_token` and
  `polymorphic_relationship_token`.
- Generate compiled plans with `namespace_bindings` and `relationship_steps`.
- Publish AI-readable relationship metadata and `ai_schema_context`.
- Keep source DB, vault, and token resolve APIs inaccessible to AI consumers.

## Non Goals

- Do not build a full runtime execution engine in the boundary-definition phase.
- Do not mutate production source databases.
- Do not auto-approve relationship candidates by default.
- Do not claim legal anonymization guarantees from DPM validation alone.
- Do not inline DPM policy into OpenAPI `x-*` fields.
- Do not replace Data Persona or schema annotations with DPM.

## Quality Gates

For implementation stories, use the smallest applicable gate set:

- `pnpm typecheck`
- `pnpm --filter @oa-sdk/parser test`
- `pnpm --filter @oa-sdk/codegen test`
- `pnpm check:api-index` if public exports change
- `pnpm check:feature-tests` if feature/test mapping changes
- `pnpm schema:validate` if OpenAPI artifacts or schemas change

Documentation-only stories must at least run:

- `git diff --check`

## User Stories

### US-001: Redefine DPM V1 As Relationship-First

**Description:** As an OA SDK maintainer, I want the DPM baseline documented as
relationship-first so later schema and compiler work does not drift back to
column-first tokenization.

**Acceptance Criteria:**

- [ ] Document that tokenization unit is logical entity namespace, not physical
      column.
- [ ] Document that Relationship Discovery and Registry Approval happen before
      PII classification and column transform planning.
- [ ] Document that only `status: approved` relationships enter execution plans.
- [ ] Replace `relationships.from/to` examples with parent/child endpoint
      examples.
- [ ] Link the concept from docs README, concepts index, plan, and todo.

### US-002: Define DPM V1 JSON Schema Shape

**Description:** As a manifest author, I want a machine-readable schema for DPM
v1 so invalid files fail before DB access or execution planning.

**Acceptance Criteria:**

- [ ] Use `dpm_version` as the canonical version field.
- [ ] Treat legacy `manifest_version` as an import migration warning, not new
      authoring syntax.
- [ ] Require `metadata`, `source`, `target`, `vault`, `scope`,
      `relationship_discovery`, `relationship_registry`, `entities`,
      `relationships`, `columns`, `privacy_controls`, `quality_gates`,
      `validation`, and `publishing`.
- [ ] Define enums for relationship kind, status, transform strategy, orphan
      policy, column role, and transform type.
- [ ] Add valid and invalid fixtures.
- [ ] Add focused schema validation tests.

### US-003: Define Catalog Snapshot Input

**Description:** As a DPM compiler, I want catalog snapshot input so DB schema
facts are stable during relationship validation and execution planning.

**Acceptance Criteria:**

- [ ] Define catalog snapshot fields for schemas, tables, columns, primary keys,
      unique indexes, unique candidates, foreign keys, indexes, and source
      freshness hash.
- [ ] Accept source coordinates compatible with file and DB coordinates already
      used by OpenAPI projection results.
- [ ] Define how an OpenAPI projection envelope can be referenced by DPM
      `catalog`.
- [ ] Preserve `versionHash` or equivalent freshness marker.
- [ ] Treat projection as structural catalog input only; relationship approval
      remains in Relationship Registry.

### US-004: Define Relationship Discovery Candidate Report

**Description:** As a privacy engineer, I want relationship discovery output to
be reviewable before it affects tokenization.

**Acceptance Criteria:**

- [ ] Define candidate relationship report shape with parent endpoint, child
      endpoint, relationship kind, confidence score, evidence, and validation SQL
      or predicate metadata.
- [ ] Support evidence from column name similarity, type compatibility, unique
      candidate detection, inclusion dependency, query logs, ORM metadata, BI
      query metadata, and service code hints.
- [ ] Define threshold fields for parent uniqueness, inclusion ratio, review,
      auto-approve, reject, and max orphan ratio.
- [ ] Default `auto_approve_enabled` to `false`.
- [ ] Exclude obvious metric/status/time columns by default.

### US-005: Define Relationship Registry Snapshot

**Description:** As a DPM operator, I want approved logical relationships exported
from a registry so manifest execution uses a reviewed snapshot.

**Acceptance Criteria:**

- [ ] Define registry identity as dataset id, relationship name, and registry
      version.
- [ ] Model lifecycle status: `candidate`, `approved`, `rejected`,
      `deprecated`.
- [ ] Model parent/child endpoints with table and one or more columns.
- [ ] Model `context_columns`, `condition_sql`, `temporal_condition`,
      `namespace`, `transform_strategy`, `orphan_policy`, confidence, evidence,
      approval metadata, and drift metadata.
- [ ] Export manifests include only configured statuses, defaulting to
      `approved`.
- [ ] Non-approved relationships must not enter compiled plans.

### US-006: Define Entity Root And Key Strategy

**Description:** As a compiler, I want entities to define root keys and namespace
contracts while relationships own child column binding.

**Acceptance Criteria:**

- [ ] Replace `entities.identity_columns` with `root` and `key_strategy`.
- [ ] Support `single_column` and `composite` key strategies.
- [ ] Require entity transform contract for token namespace and reversibility.
- [ ] Validate that relationship namespaces map to an entity transform contract.
- [ ] Reject ambiguous composite keys.

### US-007: Define Logical Relationship Model

**Description:** As a manifest author, I want relationship types expressive enough
for operating databases without physical FK constraints.

**Acceptance Criteria:**

- [ ] Support `one_to_one`, `one_to_many`, `many_to_one`,
      `many_to_many_edge`, `self_reference`, `polymorphic`, `temporal`, and
      `code_lookup`.
- [ ] Require `condition_sql` for polymorphic or conditional lookup relationships.
- [ ] Define `condition_sql` as a read-only predicate expression, not arbitrary
      executable SQL.
- [ ] Require `temporal_condition` for temporal relationships.
- [ ] Require canonical key strategy for composite relationships.
- [ ] Require parent/child column count and type compatibility.
- [ ] Require parent key to be PK, unique index, or unique candidate.

### US-008: Define Relationship-Aware Column Policy

**Description:** As a privacy engineer, I want foreign identifiers to use
relationship-derived namespaces instead of column-local namespace guesses.

**Acceptance Criteria:**

- [ ] Add column roles such as `direct_identifier`, `foreign_identifier`,
      `business_identifier`, `business_metric`, and `unstructured_text`.
- [ ] Add `relationship_token` transform with required relationship reference.
- [ ] Add `polymorphic_relationship_token` transform with required relationship
      list.
- [ ] Reject `pii: true` plus `foreign_identifier` without relationship.
- [ ] Reject direct identifier `keep`.
- [ ] Keep non-sensitive code lookup values only with explicit relationship and
      PII policy.

### US-009: Define Orphan Policies

**Description:** As a DPM operator, I want explicit orphan handling so dirty or
archived data does not silently break AI-facing relationships.

**Acceptance Criteria:**

- [ ] Support `block`, `warn`, `tolerate`, `tolerate_null`,
      `create_placeholder_parent`, and `lookup_archive`.
- [ ] Require placeholder spec for `create_placeholder_parent`.
- [ ] Require archive parent source for `lookup_archive`.
- [ ] Include orphan policy in compiled relationship steps.
- [ ] Runtime validation reports orphan counts by relationship.

### US-010: Add Relationship Semantic Validation Rules

**Description:** As a maintainer, I want deterministic REL/SAF diagnostics so
manifest review can distinguish relationship errors from privacy errors.

**Acceptance Criteria:**

- [ ] Add REL rules for scope membership, endpoint existence, column count/type,
      parent uniqueness, approved-only execution, polymorphic predicates,
      temporal predicates, composite keys, namespace contract, code lookup,
      self-reference, placeholder, archive lookup, and evidence threshold drift.
- [ ] Add SAF rules for direct identifier keep, foreign identifier without
      relationship, overlapping polymorphic predicates, AI source DB access, AI
      vault access, AI token resolve access, missing relationship drift gate, and
      missing residual PII scan for unstructured text.
- [ ] Diagnostics include severity, code, message, source pointer, and optional
      catalog/registry coordinate.

### US-011: Define Relationship Quality Gates

**Description:** As a release maintainer, I want relationship integrity and drift
to block publishing when relational semantics are unsafe.

**Acceptance Criteria:**

- [ ] Add `source_relationship_integrity` gate.
- [ ] Add `target_relationship_integrity` gate.
- [ ] Add `relationship_drift` gate.
- [ ] Add `namespace_consistency` gate.
- [ ] Quality gates can block export with `action_if_failed: block_export`.
- [ ] Missing relationship drift gate produces at least a warning.

### US-012: Define Compiled Plan Relationship Steps

**Description:** As an execution engine implementer, I want compiled plans to
preserve namespace bindings and relationship validation steps.

**Acceptance Criteria:**

- [ ] Add `namespace_bindings` with namespace, entity, relationships, columns,
      and token strategy.
- [ ] Add `relationship_steps` for source validation, relationship tokenization,
      placeholder creation when needed, target validation, and drift checks.
- [ ] Compiled plan freshness depends on manifest, catalog, and registry
      snapshot.
- [ ] Dry-run reports summarize relationship impact without exposing raw
      sensitive values.

### US-013: Define Runtime Relationship Validation

**Description:** As a DPM operator, I want source and target relationship
validation so output data remains joinable for AI consumers.

**Acceptance Criteria:**

- [ ] Validate source logical relationships before transform.
- [ ] Validate target relationships after tokenization.
- [ ] Report orphan counts and orphan ratios by relationship.
- [ ] Detect relationship drift, such as inclusion ratio drops beyond threshold.
- [ ] Relationship validation failure follows each relationship's orphan policy
      and quality gate action.

### US-014: Publish AI Schema Context

**Description:** As an AI SQL consumer, I want logical relationships published as
metadata and context so I can join tables correctly even when physical FKs are
absent.

**Acceptance Criteria:**

- [ ] Add publishing output type `relationship_metadata`.
- [ ] Add publishing output type `ai_schema_context`.
- [ ] `ai_schema_context` includes table primary entity, entity key,
      relationship join expressions, cardinality, namespace, description, and
      examples where enabled.
- [ ] Optional physical FK creation is allowed only for relationships that pass
      validation.
- [ ] AI service accounts receive target and metadata read access only.

### US-015: Add Gateway OpenAPI Contract

**Description:** As an API consumer, I want an OpenAPI contract for DPM gateway
operations so clients, mocks, and governance checks can be generated.

**Acceptance Criteria:**

- [ ] Add or generate an OpenAPI 3.2 document for DPM gateway operations.
- [ ] Include operations for catalog profiling, relationship discovery,
      candidate import, approval, registry snapshot export, manifest register,
      validate, compile, dry-run, execute, job status, and validation report.
- [ ] Do not expose source DB credentials, vault keys, or token reverse lookup to
      AI consumer operations.
- [ ] Validate the OpenAPI artifact with OA SDK tooling.

### US-016: Connect Data Persona And Publishing Policy

**Description:** As an API governance user, I want DPM publishing policy to align
with Data Persona obligations so `pseudonymized` is both an API audience claim
and a verified dataset property.

**Acceptance Criteria:**

- [ ] Document the distinction between persona `access: [pseudonymized]` and DPM
      execution policy.
- [ ] Define how validation reports and `ai_schema_context` prove a
      pseudonymized publishing target.
- [ ] Add constraints or docs for AI service accounts: target-only read access,
      no source DB access, no vault access, no reverse token API access.
- [ ] Add tests or fixture docs showing a persona row that maps to a DPM-backed
      publishing target.

## Functional Requirements

- FR-1: DPM must be a standalone manifest format, not an OpenAPI extension block.
- FR-2: DPM syntax validation must be machine-readable and deterministic.
- FR-3: DPM semantic validation must use stable catalog and registry snapshots.
- FR-4: Relationship Registry must be the source of truth for logical
  relationships.
- FR-5: Only approved relationships may enter execution plans.
- FR-6: Token namespace binding must be based on logical entity and approved
  relationship context.
- FR-7: DPM must support composite, polymorphic, temporal, self-reference, and
  code lookup relationship forms.
- FR-8: Reversible transforms must require vault policy.
- FR-9: Runtime validation must report source relationship, target relationship,
  drift, namespace consistency, residual PII, distribution, and cardinality
  checks.
- FR-10: Gateway OpenAPI must not leak source DB or vault access to AI consumers.

## Technical Considerations

- Reuse `@oa-sdk/openapi-projection-contract` concepts for source coordinates,
  diagnostics, and version freshness where possible.
- Keep catalog snapshots and registry snapshots separate.
- Keep JSON Schema validation, relationship semantic validation, and runtime
  validation separate.
- Keep compiled plan generation deterministic so artifact freshness checks can
  compare manifest/catalog/registry changes.
- Treat `condition_sql` as a constrained predicate expression. A later schema may
  replace it with a structured predicate AST if free-form SQL proves too risky.
- Keep vault operations behind a separate execution boundary; generated OpenAPI
  clients for AI consumers should not include reverse lookup operations.

## Open Questions

- Should DPM v1 live in a new package such as `@oa-sdk/pseudonymization-manifest`
  or start inside `@oa-sdk/codegen` as a CLI-only feature?
- Should Relationship Registry be represented as a local SQLite/Postgres metadata
  DB, a checked-in YAML snapshot, or both?
- Which DB engines are in MVP: PostgreSQL only, or PostgreSQL plus SQLite for
  local fixtures?
- Should `condition_sql` stay as constrained SQL predicate text or become a
  structured predicate AST before implementation?
- Should reversible token lookup be an operator-only API in the same gateway or a
  separate vault service contract?
