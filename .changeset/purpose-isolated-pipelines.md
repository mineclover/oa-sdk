---
"@oa-sdk/codegen": minor
"@oa-sdk/ast-sync": minor
---

Isolate API, data-only and interface pipelines with an optional shared purpose contract.
Preserve previous output on plugin diagnostic failures and fail Vite startup builds correctly.
Use standalone schema validation for plugin guards, align generated declaration names, provide
self-contained guard types and reject conflicting schemas across targets. Add in-memory guard
rendering for composition without disk writes. Existing configurations without purpose retain
their mixed-pipeline behavior.
