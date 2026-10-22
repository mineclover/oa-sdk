# @oa-sdk/rpc

## 0.2.0

### Minor Changes

- 4538f7c: Project TypeSpec/OpenAPI operations onto typed RPC procedures.

  - `@oa-sdk/surface-ir`: `buildRpcContract(document, options?)` and `toRpcContract(ir, document, options?)` produce the JSON contract `oa-sdk.rpc-contract.v1`. Each operation becomes a dotted-name procedure (`@rpc` service/method names, else the camel-cased first tag and the operationId) with one object input that merges its parameters and request body, its success output, declared error responses, and the HTTP binding needed to rebuild the REST request. Streaming operations are skipped with a warning; collisions are reported as diagnostics.
  - `@oa-sdk/codegen`: `pluginRpc()` and `generateRpcModule(contract, options?)` emit a module with the `<Name>Procedures` type map and the `<name>Contract` data.
  - `@oa-sdk/rpc` (new, private): `createRpcClient` / `createRpcServer` with JSON-RPC 2.0 (`createJsonRpcTransport`, `createJsonRpcFetchHandler`, `handleJsonRpc`) and REST binding (`createHttpTransport`, `createRestFetchHandler`) transports, `createLocalTransport`, `RpcError`, and an Ajv validator at `@oa-sdk/rpc/ajv`.

### Patch Changes

- Updated dependencies [fadcf07]
- Updated dependencies [f0edbd0]
- Updated dependencies [4538f7c]
  - @oa-sdk/surface-ir@0.2.0
