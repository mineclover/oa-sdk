---
"@oa-sdk/client": patch
---

Harden `encodeMessagePack`, `decodeMessagePack` and `messagePackAdapter`.

- Decoding stores map keys as own data properties, so a `__proto__` key can no longer replace the decoded object's prototype. Truncated str, bin, array or map payloads and trailing bytes throw `RangeError` instead of returning corrupted values. uint64/int64 values outside ±(2^53 − 1) decode to `bigint` instead of a rounded `number`.
- Encoding writes a `bigint` as an integer (uint64/int64 beyond the safe range, `RangeError` beyond 64 bits) instead of a string, honors `toJSON()` so a `Date` becomes its ISO string instead of `{}`, writes every `ArrayBuffer` view as bin, and throws `TypeError` for symbols, functions, `Map` and `Set`.
