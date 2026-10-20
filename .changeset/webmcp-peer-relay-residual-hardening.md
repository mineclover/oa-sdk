---
"@oa-sdk/webmcp-peer": patch
---

The relay bounds the work a provider's `register` frames cost. A frame identical to the last one the relay evaluated for the room, apart from `registerSeq`, is not normalized or hashed again while the room catalog is still the one that frame left: it gets the same answer (the same rejection under its own `registerSeq`, or none). Frames that change nothing (rejected as `CATALOG_INVALID` or `CATALOG_TOO_LARGE`, or carrying the catalog the room already holds) are evaluated at most 8 at once per room and then one per second; a frame that arrives while none is allowed waits, and the provider's next `register` replaces it, so the latest catalog is always evaluated and never refused for the rate. The budget belongs to the room, so a new provider socket does not reset it.

The relay refuses an approved agent's `offer` whose `requestId` is over 1 KiB of JSON, the bound it already applies to JSON-RPC ids, with `{ type: "offer.refused", error: REQUEST_ID_TOO_LARGE }` (the id is not echoed) instead of forwarding an offer whose answer, which repeats the id, could never be sent.

`upgradeWebSocket` treats a socket that is already ended by its peer (`readableEnded`) or no longer writable when it is called like one already destroyed: it sends no 101, destroys the socket, returns a `PeerSocket` whose `send` reports `'closed'`, and runs `onClose` once after returning. Such a socket used to stay half-open with `onClose` never called.
