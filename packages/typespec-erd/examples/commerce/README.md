# TypeSpec logical ERD commerce example

This is the smallest end-to-end logical ERD scenario used by the TypeSpec emitter
tests. It demonstrates stable dataset, entity, field, composite-key, foreign-key
candidate, relationship, and source-provenance declarations.

From the package directory, build the prototype and run the example harness:

```bash
pnpm build
node examples/commerce/run-demo.mjs
```

The example emits a temporary `oa-sdk.logical-erd.v1` artifact and validates its
entity and relationship identities. It does not connect to a database or emit DDL.
