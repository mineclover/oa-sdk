# OA SDK logical ERD contract

`@oa-sdk/logical-erd-contract` defines the portable, logical-only
`oa-sdk.logical-erd.v1` artifact used by the TypeSpec ERD emitter, diff tools, and
future read-only evidence consumers.

It deliberately contains no DPM runtime, database client, DDL, migration, or
physical FK mutation capability. Logical source provenance remains in the artifact;
physical catalog evidence is a separately owned input.

## Wire contract

The versioned JSON Schemas are published with the package at
`schema/oa-sdk.logical-erd.v1.schema.json` and
`schema/oa-sdk.logical-erd-review.v1.schema.json`. Consumers can validate a parsed
artifact with `validateLogicalErdArtifactSchema`; then use
`validateLogicalErdArtifact` for cross-reference and stable-ID invariants. A review
envelope can be checked with `validateLogicalErdReviewSchema`.

```ts
import {
  validateLogicalErdArtifact,
  validateLogicalErdArtifactSchema,
} from '@oa-sdk/logical-erd-contract'

const wireIssues = validateLogicalErdArtifactSchema(parsedArtifact)
const semanticIssues = wireIssues.length === 0
  ? validateLogicalErdArtifact(parsedArtifact)
  : []
```

The artifact hash is a revision/evidence identity. It never replaces the stable
dataset, entity, field, or relationship IDs declared by the author.

## Cross-workspace compatibility example

`examples/crdt-base-control-plane/logical-erd.v1.json` is a schema-valid,
provenance-bearing control-plane example shared with the CRDT ERD bridge tests.
It fixes the wire-level expectations only: an import consumer must still create
reviewable commands against its own current revision and must not treat this
example as a DPM policy, physical catalog snapshot, or database migration.
