---
"@oa-sdk/parser": minor
---

- Export `findNearestJsonPointerEntry` (and its `JsonPointerEntryMatch` result type), which finds the entry stored under a JSON Pointer or under its nearest ancestor, and `canonicalJsonPointerFragment`, which spells a percent-encoded `$ref` fragment canonically, from both `@oa-sdk/parser` and `@oa-sdk/parser/browser`.
- `projectRefGraph` no longer drops a resolved `$ref` silently when no node contains the occurrence or its target, for example a `$ref` under `info` or an `x-` extension. It reports each such end as a `ref-source-outside-nodes` or `ref-target-outside-nodes` diagnostic. `RefProjection.diagnostics` is now `RefProjectionDiagnostic[]`, exported with `RefProjectionDiagnosticCode` and `RefProjectionOutsideNodesDiagnostic`, so code that switches over a diagnostic `code` sees these two new values.
