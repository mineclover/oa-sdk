---
"@oa-sdk/webmcp-peer": minor
---

`PeerMcpSession` keeps to the relay's limit of requests in flight per agent WebSocket, now exported as `PEER_RELAY_MAX_PENDING_REQUESTS` (64) from `./config` and the package root and used by the relay too. Over a relay socket (any transport that is not `raw`; the Streamable HTTP one is), a request past 64 unanswered ones waits, in order, and is sent once an earlier one has been answered, instead of failing with the relay's `TOO_MANY_PENDING_REQUESTS` (-32087). A request holds its place until the relay answers it, even after its caller stopped waiting at a shorter timeout, since the relay counts it until then. The wait counts toward the request's timeout (`REQUEST_TIMEOUT`, never sent), and `disconnect()` or a closed transport ends waiting requests like pending ones. An id over 1 KiB of JSON, which the relay answers without the id, is refused before it is sent with `PeerMcpError` `REQUEST_ID_TOO_LARGE` (`details: { bytes, limitBytes }`) instead of waiting for its timeout.

The live demo's provider (`examples/live-demo/host-provider.js`) numbers its `register` frames with `registerSeq` as the SDK provider does, and matches the relay's `CATALOG_INVALID` / `CATALOG_TOO_LARGE` refusals to the latest frame by that number.
