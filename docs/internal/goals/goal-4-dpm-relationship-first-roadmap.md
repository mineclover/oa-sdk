# Goal 4 — Relationship-First DPM Roadmap

**상태: 구현 완료**

> 실행 PRD: [Relationship-First Data Pseudonymization Manifest](../../../tasks/prd-data-pseudonymization-manifest.md)\
> 개념 기준선: [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
> 구현 전략: [Goal 4 - DPM Implementation Strategy](./goal-4-dpm-implementation-strategy.md)\
> 후속 목표: [Goal 5 - DPM Runtime/Storage Integration](./goal-5-dpm-runtime-storage-integration.md)

## 목표

DPM을 컬럼별 가명처리 설정이 아니라 **Relationship Registry 기반 AI 데이터 제품 계약**으로
구현한다. 실행 단위는 relationship lifecycle을 먼저 고정한 뒤, schema/validator/compiler/gateway로
확장한다.

## 원칙

1. Relationship Registry가 logical relationship lifecycle의 source of truth다.
2. DPM manifest는 실행 시점의 approved relationship snapshot을 고정한다.
3. Token namespace는 physical column이 아니라 logical entity와 approved relationship에서 결정한다.
4. PII classifier와 column transform은 relationship approval 이후에 실행된다.
5. OpenAPI는 DPM gateway API만 설명하고 DPM policy 본문을 소유하지 않는다.
6. AI consumer는 source DB, vault, token resolve API에 접근하지 않는다.

## Goal Map

| Goal | 이름 | 산출물 | Breakpoint |
|---|---|---|---|
| DPM-00 | Decision Baseline | ADR/decision note, package/storage/defaults 결정 | 필수 선행 |
| DPM-01 | Vocabulary + Schema Shape | DPM v1 JSON Schema 또는 TypeSpec source, fixtures | authoring source 결정 후 |
| DPM-02 | Catalog Snapshot Adapter | catalog snapshot model, projection adapter contract | DB engine 범위 결정 후 |
| DPM-03 | Relationship Discovery Report | candidate report schema, scoring/evidence vocabulary | query log/ORM evidence 범위 결정 후 |
| DPM-04 | Relationship Registry Snapshot | registry snapshot schema, approval lifecycle model | registry storage 결정 후 |
| DPM-05 | Entity + LogicalRelationship Model | entity root/key strategy, parent/child relationship model | condition predicate 결정 후 |
| DPM-06 | Column Policy + Transform Vocabulary | relationship-aware transforms, role/safety rules | namespace binding model 확정 후 |
| DPM-07 | Semantic Validator + Quality Gates | REL/SAF diagnostics, relationship gates | schema/model fixtures green 후 |
| DPM-08 | Compiled Plan + Dry Run | namespace_bindings, relationship_steps, dry-run report | validator green 후 |
| DPM-09 | Gateway OpenAPI Contract | OpenAPI 3.2 gateway artifact, typegen/mock checks | API mode 결정 후 |
| DPM-10 | Publishing Context | relationship_metadata, ai_schema_context contract | compiled plan shape 확정 후 |

## Recommended Execution Order

### DPM-00 — Decision Baseline

Purpose: implementation이 시작되기 전에 되돌리기 어려운 설계 결정을 문서화한다.

Acceptance:
- package ownership가 결정되어 있다.
- registry storage default가 결정되어 있다.
- DPM schema authoring source가 결정되어 있다.
- `condition_sql` v1 표현 방식이 결정되어 있다.
- MVP DB engine과 fixture strategy가 결정되어 있다.
- gateway를 CLI-first로 할지 HTTP-first로 할지 결정되어 있다.

Verification:
- `git diff --check`

### DPM-01 — Vocabulary + Schema Shape

Purpose: relationship-first DPM v1의 machine-readable syntax를 고정한다.

Scope:
- `dpm_version`
- top-level required sections
- relationship kind/status/orphan/transform enums
- entity key strategy
- column role/transform union
- valid/invalid fixtures

Acceptance:
- `manifest_version`은 legacy import warning으로만 취급한다.
- `relationships.from/to` fixture가 없다.
- invalid fixture가 non-approved relationship execution, missing relationship on foreign identifier, direct identifier keep을 잡는다.

Verification:
- focused schema tests
- `git diff --check`

### DPM-02 — Catalog Snapshot Adapter

Purpose: DPM compiler가 관계 검증에 사용할 DB 구조 snapshot을 정의한다.

Scope:
- schemas/tables/columns/PK/FK/index/unique candidate model
- OpenAPI projection envelope adapter
- source coordinate and freshness hash

Acceptance:
- projection은 structural catalog input으로만 쓰인다.
- relationship approval은 registry 책임으로 남는다.
- catalog freshness가 compiled plan freshness에 들어간다.

### DPM-03 — Relationship Discovery Report

Purpose: 후보 관계를 바로 실행하지 않고 review 가능한 report로 만든다.

Scope:
- candidate relationship shape
- evidence fields
- confidence score
- thresholds
- exclusion defaults

Acceptance:
- `auto_approve_enabled` default는 false다.
- candidate report는 registry import 전에도 독립 검토 가능하다.

### DPM-04 — Relationship Registry Snapshot

Purpose: approved relationship snapshot을 DPM 실행 입력으로 고정한다.

Scope:
- registry identity: dataset id + relationship name + version
- lifecycle status
- parent/child endpoint
- context, condition, temporal metadata
- namespace, transform strategy, orphan policy
- confidence/evidence/approval metadata

Acceptance:
- compiled plan에는 approved relationship만 들어간다.
- rejected/deprecated relationship fixture가 validator에서 차단된다.

### DPM-05 — Entity + LogicalRelationship Model

Purpose: namespace binding의 core model을 확정한다.

Scope:
- entity root/key strategy
- single/composite key
- logical relationship kinds
- polymorphic predicate
- temporal condition

Acceptance:
- entity는 child column binding을 직접 들지 않는다.
- composite relationship은 canonical key가 명확하다.
- polymorphic relationship은 predicate가 필수다.

### DPM-06 — Column Policy + Transform Vocabulary

Purpose: column policy를 relationship-derived namespace에 연결한다.

Scope:
- role taxonomy
- `relationship_token`
- `polymorphic_relationship_token`
- direct identifier and foreign identifier safety rules

Acceptance:
- foreign identifier with `pii: true` and no relationship is invalid.
- direct identifier `keep` is invalid.
- relationship token transform references an approved relationship.

### DPM-07 — Semantic Validator + Quality Gates

Purpose: manifest review와 CI gate가 이해할 수 있는 deterministic diagnostics를 만든다.

Scope:
- REL diagnostic family
- SAF diagnostic family
- source/target relationship integrity gates
- relationship drift gate
- namespace consistency gate

Acceptance:
- diagnostics include severity, code, message, source pointer, catalog/registry coordinate where available.
- missing relationship drift gate produces warning or stricter policy.

### DPM-08 — Compiled Plan + Dry Run

Purpose: execution engine이 사용할 relationship-first plan을 생성한다.

Scope:
- `namespace_bindings`
- `relationship_steps`
- dry-run impact summary
- freshness tuple: manifest/catalog/registry

Acceptance:
- plan is stale when any freshness source changes.
- dry-run does not expose raw sensitive values.

### DPM-09 — Gateway OpenAPI Contract

Purpose: DPM gateway를 OA SDK validation/typegen/mock workflow에 연결한다.

Scope:
- catalog profiling endpoint
- relationship discovery endpoint
- candidate import/approval/snapshot export
- manifest validate/compile/dry-run/execute/job/report

Acceptance:
- OpenAPI 3.2 artifact validates with OA SDK tooling.
- AI consumer operations do not expose source DB credentials, vault keys, or token reverse lookup.

### DPM-10 — Publishing Context

Purpose: AI가 FK 없는 DB도 올바르게 join할 수 있게 relationship context를 publish한다.

Scope:
- `relationship_metadata`
- `ai_schema_context`
- optional physical FK creation rule
- readonly AI grant boundary

Acceptance:
- `ai_schema_context` includes relationships, join predicates, cardinality, namespace, descriptions, and examples where enabled.
- only validated relationships can become physical constraints.

## Decisions Locked By ADR-010

`DPM-00` is closed by
[ADR-010 - Relationship-First DPM Implementation Baseline](../architecture/010-dpm-relationship-first.md).

### Accepted Baseline

| Decision | Accepted default | Why |
|---|---|---|
| Package ownership | new package `@oa-sdk/dpm` | DPM is not ordinary codegen; separate package prevents `@oa-sdk/codegen` from becoming a privacy platform dumping ground. |
| Schema authoring source | JSON Schema-first manifest; TypeSpec/OpenAPI gateway after CLI loop | Manifest validation needs deterministic fixtures immediately, while gateway operations still align with ADR-009. |
| Registry storage default | Postgres model + checked-in YAML snapshot fixture | Relationship lifecycle is DB-like, but tests and review need deterministic files. |
| MVP DB engine | PostgreSQL first, SQLite fixtures only for lightweight tests | Relationship discovery relies on catalogs, indexes, and SQL semantics that are easiest to specify for Postgres. |
| Gateway mode | CLI-first plus OpenAPI contract draft, HTTP runtime later | Keeps first implementation bounded while preserving API design. |

### Can Defer To Breakpoints

| Decision | Breakpoint |
|---|---|
| `condition_sql` text vs structured predicate AST | before DPM-05 |
| Query log and ORM metadata ingestion depth | before DPM-03 |
| Vault implementation and reversible token storage | before runtime engine phase |
| Physical FK creation in target DB | before DPM-10 |
| Multi-tenant canonical key separator and escaping rules | before DPM-05 |
| Whether discovery can ever auto-approve | after manual approval workflow proves safe |

## Completed Output

Goal 4 is complete for the relationship-first DPM core loop.

Implemented outputs:
- `packages/dpm` private workspace package.
- DPM v1 JSON Schema and syntax gate.
- Catalog snapshot and projection adapter model.
- Relationship discovery report and registry snapshot model.
- Entity and logical relationship model.
- Semantic validator with SYN/REL/SAF diagnostics.
- Compiler, dry-run report, CLI surface, gateway OpenAPI contract, and publishing context.
- `packages/dpm/examples/customer-orders` primary demo.

Post-Goal-4 runtime/storage work is tracked in
[Goal 5 - DPM Runtime/Storage Integration](./goal-5-dpm-runtime-storage-integration.md).

## Verification Matrix

| Layer | Minimum gate |
|---|---|
| docs-only decisions | `git diff --check` |
| schema/model work | focused schema tests + `pnpm typecheck` |
| parser/codegen integration | relevant package tests |
| OpenAPI gateway | `pnpm schema:validate` or focused `oa-gen validate --require-32` path |
| public exports | `pnpm build:scripts && pnpm check:api-index` |
