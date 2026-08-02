# TypeSpec Logical ERD Authoring (Prototype)

`@oa-sdk/typespec-erd`는 DB를 생성하는 도구가 아니라, 논리 entity·field·key·relationship을
TypeSpec으로 선언하고 검토 가능한 `oa-sdk.logical-erd.v1` artifact로 내보내는 prototype이다.

## Authority boundary

| Fact | Authority | This prototype does |
| --- | --- | --- |
| Logical entity, field, key, relationship | TypeSpec ERD source | stable ID, semantics, and source provenance emission |
| Physical table, column, FK, index, migration | DB catalog and migration owner | nothing; future read-only evidence adapter may compare it |
| API DTO/operation | Production TypeSpec/OpenAPI bundle | nothing; future opt-in binding only |
| Pseudonymization policy/lifecycle | DPM external owner | selected ERD fields may later be projected explicitly; DPM is not a runtime dependency or ERD authority |

Do not put ERD facts in the production OpenAPI TypeSpec extension package. Do not use a generic
metadata decorator, and do not treat a logical `@foreignKey` as a command to mutate a database.

## Minimal declaration

Use a block namespace. TypeSpec does not allow a second blockless declaration of the same namespace.

```typespec
import "@oa-sdk/typespec-erd";

using OaSdkErd;

@dataset("commerce")
namespace Commerce {
  @entity("commerce.customer")
  model Customer {
    @field("commerce.customer.id")
    @primaryKey
    id: string;
  }

  @entity("commerce.order")
  model Order {
    @field("commerce.order.customer-id")
    @foreignKey(Customer.id)
    customerId: string;
  }

  @relationship("commerce.order-customer", Order.customerId, Customer.id, "many-to-one")
  namespace Relationships {}
}
```

`@dataset`, `@entity`, and `@field` IDs are mandatory and must be stable across a human-name
rename. Every property of an `@entity` must have `@field`; the compiler rejects omitted IDs.

## Artifact workflow

The package-local CLI has no OpenAPI, DPM, database, or migration command:

```bash
pnpm --filter @oa-sdk/typespec-erd exec oa-erd emit --project ./logical-schema --output logical-erd.json
pnpm --filter @oa-sdk/typespec-erd exec oa-erd check --artifact logical-erd.json
pnpm --filter @oa-sdk/typespec-erd exec oa-erd diff \
  --base main.logical-erd.json --next logical-erd.json --fail-on-breaking
pnpm --filter @oa-sdk/typespec-erd exec oa-erd review \
  --artifact logical-erd.json --catalog-evidence dpm-catalog-evidence.json \
  --format markdown --output logical-erd.review.md
```

`emit` invokes the TypeSpec compiler with the ERD emitter. The artifact preserves declaration and
decorator spans so a relationship diff can point to the originating `.tsp` location. `diff` treats
stable-ID locator/name changes as non-breaking, while deletions and relation/key/requiredness changes
are review signals.

`review` is a separate evidence artifact: it shows every logical subject and its TypeSpec source
span, optional semantic diff, and optional catalog status (`confirmed`, `mismatch`, `unbound`, or
`unknown`). The catalog JSON is structural so the DPM owner can supply its read-only evidence
without creating a package dependency; its `artifactId` must exactly match the ERD artifact.

For a complete small scenario, see the
[`TypeSpec logical ERD commerce example`](../../packages/typespec-erd/examples/commerce/README.md).

## Current prototype limits

- No DB connection, catalog comparison, DDL, migration, or FK mutation.
- No DPM registry persistence or DPM schema change.
- No OpenAPI emission or automatic API DTO equivalence.
- No published npm contract or `oa-gen` dependency until the artifact compatibility and distribution
  decision is approved.
- Ordered composite primary keys use `@primaryKey("stable-group-id", order)` on every component.
  A group must contain two or more fields and must not repeat an order.
- Many-to-many is not a direct v1 cardinality. Model an explicit join entity with two directed
  relationships; hidden join-table inference is unsupported.
- Physical hints and API bindings are planned follow-ups; do not encode them in comments or
  untyped metadata.

For the implementation sequence and non-goals, see the
[logical ERD profile plan](../internal/typespec-roundtrip/logical-erd-typespec-profile.plan.md).
