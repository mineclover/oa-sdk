# @oa-sdk/typespec-decorators

Trusted, narrow TypeSpec authoring helpers and standard contracts for OA SDK's versioned extension
contract. The package deliberately does not expose a generic decorator for arbitrary `x-oa-sdk-*` JSON.

## 1. Platform Standard Contracts (`contracts.tsp` / `OaSdkContracts`)

`@oa-sdk/typespec-decorators` ships built-in standard HTTP envelope models and error contracts:

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkContracts;

// Generic response envelopes
op getUser(@path id: string): Ok<User>;
op createUser(@body body: CreateUserRequest): Created<User>;
op deleteUser(@path id: string): NoContent;
op listUsers(@query page?: integer, @query limit?: integer): Ok<PageResult<User>>;

// Predefined RFC 7807/9457 standard errors
op transfer(@body body: TransferRequest): Ok<TransferReceipt> | StandardHttpErrors.BadRequest;
```

- **`Ok<T>`**: Standard 200 OK single resource wrapper (`{ @statusCode statusCode: 200, @body body: T }`).
- **`Created<T>`**: Standard 201 Created single resource wrapper (`{ @statusCode statusCode: 201, @body body: T }`).
- **`NoContent<T = void>`**: Standard 204 No Content wrapper with generic default to avoid uninstantiated schema emission.
- **`PageResult<T>`**: Standard pagination container (`items: T[]`, `total`, `page`, `limit`).
- **`StandardError` & `StandardValidationError`**: Canonical error structures.
- **`StandardHttpErrors.*`**: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `InternalServerError`.

## 2. Authoring Decorators

### `@oaUseResponseComponent(statusCode, componentName)`
Emits only the existing `oa-sdk.typespec-extensions.v5` operation-response component-reference shape.
It accepts a three-digit status code (or `default`) and a simple component name.

### `@personaCapability(skills...)`
Declares formal API persona capabilities directly on TypeSpec operations (e.g. `@personaCapability("pagination", "audit-emission")`), validating declared skills against `packages/personas/src/traits/skill.yaml` and emitting `x-oa-sdk-persona-traits`.

### `@pseudonymize(targetField, transform, options?)`
Annotates model properties with DPM pseudonymization contracts (e.g. `@pseudonymize("hmac-sha256", "admin", true)`), emitting `x-oa-sdk-dpm-projection`.

### `@crdt` & `@crdtEntity`
Declares distributed CRDT replication and concurrency control policies on models and properties.

---

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
