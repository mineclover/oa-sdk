# @oa-sdk/typespec-decorators

Trusted, narrow TypeSpec authoring helpers and standard contracts for OA SDK's versioned extension
contract. The package deliberately does not expose a generic decorator for arbitrary `x-oa-sdk-*` JSON.

`import "@oa-sdk/typespec-decorators";` loads the decorators and the standard contracts together.
Both live in the `OaSdkTypeSpec` namespace, so one `using OaSdkTypeSpec;` brings them into scope.
The contracts use `@typespec/http` decorators, which this package depends on.

## 1. Platform Standard Contracts (`contracts.tsp`)

`@oa-sdk/typespec-decorators` ships standard HTTP response envelopes and error contracts:

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Users" })
namespace UsersApi;

model User {
  id: string;
  name: string;
}

model CreateUserRequest {
  name: string;
}

@route("/users")
interface Users {
  @get list(@query page?: integer, @query limit?: integer): Ok<PageResult<User>> | StandardHttpErrors;
  @get @route("/{id}") read(@path id: string): Ok<User> | ErrorResponse<404>;
  @post create(@body body: CreateUserRequest): Created<User> | ErrorResponse<400> | ErrorResponse<409>;
  @delete @route("/{id}") remove(@path id: string): NoContent | ErrorResponse<404>;
}
```

- **`Ok<T>`**: 200 response whose body is `T` (`{ @statusCode statusCode: 200, @body body: T }`).
- **`Created<T>`**: 201 response whose body is `T` (`{ @statusCode statusCode: 201, @body body: T }`).
- **`NoContent<T = void>`**: 204 response without a body. The unused template parameter has a default, so `NoContent` needs no argument.
- **`PageResult<T>`**: pagination body (`items: T[]`, `total`, optional `page` (default 1) and `limit` (1-100, default 20)). It is a body model, not a response, so wrap it: `Ok<PageResult<T>>`.
- **`ErrorResponse<Status>`**: error response with the given status code and a `StandardError` body.
- **`StandardError`**: error body with `code`, `message`, optional `details: StandardValidationError[]`, and optional `_meta` (`operationId`, `requestId`).
- **`StandardValidationError`**: field-level validation error with `path`, `message`, and optional `received` and `expected`.
- **`StandardHttpErrors`**: an alias for `ErrorResponse<400> | ErrorResponse<401> | ErrorResponse<403> | ErrorResponse<404> | ErrorResponse<500>`. Add other statuses with `ErrorResponse<Status>`, for example `ErrorResponse<409>`.

The OpenAPI emitter names the shared error schemas after their namespace:
`#/components/schemas/OaSdkTypeSpec.StandardError` and `OaSdkTypeSpec.StandardValidationError`.

A model you declare in your own namespace takes precedence over these names. If you also `using`
another namespace that declares `Ok`, `Created`, `NoContent`, `PageResult`, `ErrorResponse`,
`StandardError`, `StandardValidationError` or `StandardHttpErrors`, TypeSpec reports an
`ambiguous-symbol` error; use the fully qualified name, such as `OaSdkTypeSpec.Ok`.

## 2. Authoring Decorators

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Members" })
namespace MembersApi;

@crdtEntity(#{ partitionKey: "teamId", compaction: "checkpoint-squash" })
model Member {
  id: string;
  teamId: string;

  @pseudonymize("mask", "direct_identifier", true)
  email: string;

  @crdt(#{ type: "lww-register", resolution: "last-write-wins", role: "value" })
  displayName: string;
}

@route("/members")
@personaCapability("pagination", "filter-by-role")
@oaUseResponseComponent("400", "BadRequest")
op listMembers(): Member[];
```

### `@oaUseResponseComponent(statusCode, componentName)`
Emits only the existing `oa-sdk.typespec-extensions.v5` operation-response component-reference shape.
It accepts a three-digit status code (or `default`) and a simple component name.

### `@personaCapability(traits...)`
Declares formal API persona capabilities on an operation (e.g. `@personaCapability("pagination", "audit-emission")`).
Each trait must be one of the standard capability traits from `packages/personas/src/traits/skill.yaml`
(exported as `VALID_PERSONA_TRAITS`); the decorator emits `x-oa-sdk-persona-traits`.

### `@pseudonymize(transform, role?, pii?, relationship?)`
Annotates a model property with a DPM pseudonymization contract and emits `x-oa-sdk-dpm-projection`.
`transform` is one of `VALID_DPM_TRANSFORMS` (`keep`, `redact`, `mask`, `null`, `hash`, `generalize`,
`relationship_token`, `polymorphic_relationship_token`) and `role` one of `VALID_DPM_ROLES`
(`direct_identifier`, `foreign_identifier`, `business_identifier`, `business_metric`,
`unstructured_text`, `code_lookup`). A `direct_identifier`, or any `pii: true` field, cannot use
`keep`, and a `pii: true` `foreign_identifier` needs `relationship`.

### `@crdt(options)` & `@crdtEntity(options)`
Declare CRDT replication and conflict-resolution policies on model properties (`@crdt`, emitting
`x-oa-sdk-crdt`) and models (`@crdtEntity`, emitting `x-oa-sdk-crdt-entity`). `@crdt` requires a
`type` (`VALID_CRDT_TYPES`) and accepts `resolution`, `engine` and `role`; `@crdtEntity` accepts
`partitionKey`, `timeRange`, `compaction` (`VALID_CRDT_COMPACTIONS`) and `strategy`.

---

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
