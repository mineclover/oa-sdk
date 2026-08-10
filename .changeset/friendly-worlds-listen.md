---
"@oa-sdk/client": patch
---

Fix generated SSE and NDJSON methods without query parameters so their operation ID is passed to the streaming helper in the correct argument position.
