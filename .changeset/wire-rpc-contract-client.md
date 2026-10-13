---
"@oa-sdk/codegen": minor
---

Fix the clients that `RpcContractTargetAdapter` (the `rpc-contract` codec of `pluginWire`) generates.

- Path, query, header, and cookie parameters are now part of the generated methods (`method(request, params, options)`, or `method(params, options)` without a body) and fill the declared route. Path-level parameters and route variables without a declaration are included; `.` and `..` path values are rejected. Server handlers receive `params` as a third argument when a method has parameters.
- Request and response bodies follow their declared media types: JSON is serialized directly, and Protobuf / MessagePack messages are encoded and decoded with the `codecs` option, now a model-name → `BinaryCodecAdapter` map (or an array of maps), such as `getGeneratedProtobufCodecs()`. A binary message without a codec fails before the request is sent. Previously the body was passed to `fetch` unserialized and every response was parsed as JSON.
- Failed calls reject with the exported `WireRpcError` (`method`, `status`, decoded `body`).
- `extractWireSchemaFromOas` infers `wireFormat` from the declared media types (`json` when nothing binary is declared) instead of always `protobuf`, picks the lowest 2xx response, and adds `parameters`, `requestBody`, and `response` to each `WireMethod` (new `WireParameter`, `WireParameterLocation`, `WirePayload` types).
- Without `typesImport`, model references in the generated module are typed `unknown` instead of naming types that are not imported. Descriptions are emitted through the escaping JSDoc formatter.
