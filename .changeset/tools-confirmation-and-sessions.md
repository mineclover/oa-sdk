---
"@oa-sdk/tools": patch
---

Require explicit confirmation for the two-phase-elicit-commit execution model, including hosts without elicitation support, and expose a CLI --confirm flag. Serialize commit, state capture and undo snapshot persistence under one project lock.

Preserve original parser refinements and transformed values in the Standard Schema bridge; apply optional guards to parsed output. Isolate project session paths using exact-ID hashes and check persisted identity, retaining reads of matching legacy sessions and migrating them on the next write.
