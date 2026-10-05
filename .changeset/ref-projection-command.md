---
"@oa-sdk/codegen": minor
---

Add `oa-gen ref-projection`, which exports the ref-preserving `$ref` graph of an OpenAPI document as the versioned JSON artifact `oa-sdk.ref-projection.v1` (registered as `experimental` in the artifact compatibility policy).

- Nodes are the reusable declarations of the entry document and the external targets its `$ref`s reach. Each resolved `$ref` occurrence whose occurrence and target both lie inside a node is one edge, marked `none`, `guarded` or `unguarded` recursion; every other occurrence is named by a diagnostic.
- With `--provenance <map written by oa-gen build-spec --provenance>`, each node carries the `canonicalId` of its nearest enclosing provenance entry and its fragment `sourcePath` relative to the project root, or the reason it has none.
- The output has no timestamps, is sorted, and is validated against its JSON Schema before it is written. The same codegen version writes byte-identical output for inputs with the same bytes at the same project-root-relative paths.
- The library exports `createRefProjectionArtifact`, `serializeRefProjectionArtifact`, `validateRefProjectionArtifact`, `REF_PROJECTION_SCHEMA_VERSION`, `REF_PROJECTION_ARTIFACT_SCHEMA_V1` and their types; `docs/cli-spec/oa-sdk.ref-projection.v1.schema.json` mirrors the schema.

Provenance maps read by `oa-gen ref-projection`, and by `oa-gen review` and `oa-gen review-bundle` through `--base-provenance` and `--head-provenance`, now reject an entry whose `canonicalId` is empty.
