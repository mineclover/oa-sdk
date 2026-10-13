---
"@oa-sdk/codegen": minor
---

Make the Protobuf codecs of `ProtobufCodecTargetAdapter` (`pluginWire` codec `protobuf`) lossless and wire-compatible with the `.proto` schema that `Proto3TargetAdapter` emits, verified against protobufjs in both directions.

- Nested messages and repeated messages are length-delimited submessages. They were written as `Number(value)`, which threw for every model with a nested object (7 of the 16 schema examples of the production contract).
- Component enums travel as member numbers and decode back to their JSON values. Objects with only `additionalProperties` of a scalar, enum, or message type become `map<string, V>`. Unions, anonymous objects, and nested arrays are sent as JSON text in a `string` field instead of `String(value)` (`"[object Object]"`).
- Scalars use their real wire types: 64-bit varints for negative and large values, zigzag for `sint32`/`sint64`, 4-byte `float` / `fixed32` / `sfixed32`, 8-byte `fixed64` / `sfixed64`. 64-bit values decode to `number` when safe and to `bigint` otherwise. Integers outside their type's range, non-integers, and unknown enum values throw instead of being truncated. `format: byte` strings travel as raw bytes and decode back to base64.
- Repeated numeric and enum fields are written packed, and both packed and unpacked forms are read. Unknown fields are skipped; truncated input throws `RangeError`; decoded map keys cannot change object prototypes; required lists and maps decode as empty when absent.
- `extractWireSchemaFromOas` classifies each field (`kind`: `scalar`, `enum`, `message`, `map`, `json`, with the new `WireFieldKind` and `WireMapValue` types), records enum JSON values in `WireEnum.literals`, maps integer formats (`int8`–`int32` → `int32`, `uint8`–`uint32` → `uint32`, `uint64`), and maps unformatted integers to `int64` instead of `int32`. Automatic field numbers skip numbers declared explicitly and the reserved 19000–19999 range.
- The `.proto` output references nested types by their message name (including service method input and output), emits `map<>` fields, keeps comments on one line, sanitizes identifiers (with `json_name` when a field name changes), and prefixes enum member names that would clash across enums in the package scope.
