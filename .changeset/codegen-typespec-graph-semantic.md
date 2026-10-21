---
"@oa-sdk/codegen": minor
---

Let `oa-gen typegen` write a TypeSpec origin graph semantic index.

Pass `--typespec-provenance <json> --graph-semantic-index <json> --graph-file <project-relative>` together with `--output`. Each generated declaration becomes a host with the owning TypeSpec declaration's `.tsp` file and line as evidence, and the sidecar is hash-bound to the generated TypeScript, the restored OpenAPI document and the provenance. `typegen` fails without writing either output when the provenance describes another document or leaves a generated declaration without an owner. With `--incremental`, the index is its own generation target and is reused or regenerated together with the types.

The new surface is `buildTypeSpecGeneratedGraphSemanticIndex()`, `TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA`, `typeSpecGraphProvenanceSchema` and the `GeneratedTypeDeclaration`/`TypeSpecGraphProvenance` types.
