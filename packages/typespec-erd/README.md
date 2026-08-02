# @oa-sdk/typespec-erd

TypeSpec authoring library and emitter for logical ERD declarations. It emits a
neutral `oa-sdk.logical-erd.v1` artifact with source provenance; it does not emit
OpenAPI, DDL, migrations, or physical foreign keys.

```typespec
import "@oa-sdk/typespec-erd";
using OaSdkErd;

@dataset("commerce")
namespace Commerce;

@entity("commerce.customer")
model Customer {
  @field("commerce.customer.id")
  @primaryKey
  id: string;
}
```

Use `@relationship` for explicit edges. A field-level `@foreignKey` is a logical
candidate only; physical database authority remains with a catalog or migration
owner outside this package.

The package-local CLI intentionally operates only on the neutral artifact:

```bash
oa-erd emit --project ./schema --output logical-erd.json
oa-erd check --artifact logical-erd.json
oa-erd diff --base main.logical-erd.json --next logical-erd.json --fail-on-breaking
oa-erd review --artifact logical-erd.json --format markdown --output logical-erd.review.md
```

`oa-gen` integration is deferred until this prototype has its own published
package boundary; the public OpenAPI codegen package must not acquire a
dependency on a private ERD prototype.

`review` produces a deterministic, review-only envelope containing stable ERD
subjects, TypeSpec provenance coverage, an optional logical diff, and optional
read-only catalog evidence. It cannot author TypeSpec, emit DPM data, or change
a database.

## Example

[`examples/commerce`](./examples/commerce/) is the canonical small scenario for
the emitter. It demonstrates a composite key, a logical foreign-key candidate,
an explicit relationship, and emitted source provenance without a database.
