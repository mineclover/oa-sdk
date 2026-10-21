---
"@oa-sdk/codegen": patch
---

Report a `typegen --incremental` run with `--graph-semantic-index` as regenerating both outputs when only the index needs a fresh generation. Because the index is derived from the declarations of a fresh generation, the types are regenerated too; the command no longer prints `typegen up to date, regeneration skipped` for the types and then rewrites them.
