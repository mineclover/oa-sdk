---
"@oa-sdk/surface-ir": minor
---

**Behavior change:** `canonicalJsonStringify` and `computeCanonicalHash` throw a `TypeError` for input that has no RFC 8785 form: non-finite numbers, `bigint`, strings or keys with lone surrogates, `Map`, `Set` and class instances without `toJSON`, and a top-level `undefined`, function or symbol. They used to return colliding or invalid output for such values. `toJSON` and boxed primitives are handled as `JSON.stringify` handles them, and `undefined`, function and symbol array elements become `null`, so a value hashes the same before and after a JSON round trip.
