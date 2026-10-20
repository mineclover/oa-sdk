---
"@oa-sdk/router": patch
---

Follow Accept q-values in response negotiation and answer null-body statuses without a body.

- `negotiateResponseMediaType` follows Accept q-values and wildcards (RFC 9110 §12.5.1). It ranks the server's types (the declared ones, `application/json` when none are declared, then the codec types) by the weight of the most specific Accept range that matches each. A `q=0` range, `type/*;q=0` and `*/*;q=0` included, refuses the types it governs. Ties go to the more specific range, then header order, then server order, and the fallback skips refused types. A declared type is returned exactly as it was passed, with its case and parameters, instead of the lowercased Accept entry. It used to ignore q-values and wildcards.
- Generated Hono contract routers answer 204, 205 and 304 envelopes with `c.body(null, status)`, so a chunk-stream 304 Not Modified no longer becomes a 500, and error envelopes without a body are sent empty.
- The Hono and Express stubs generated outside contract mode no longer reference an undeclared `options` binding for binary request bodies. They read the raw bytes (Express needs the `express.raw()` middleware) and leave decoding to the implementation.
