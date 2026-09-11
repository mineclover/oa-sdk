# @oa-sdk/typespec-decorators

Trusted, narrow TypeSpec authoring helpers for OA SDK's versioned extension
contract. The package deliberately does not expose a generic decorator for
arbitrary `x-oa-sdk-*` JSON.

`@oaUseResponseComponent(statusCode, componentName)` emits only the existing
`oa-sdk.typespec-extensions.v5` operation-response component-reference shape.
It accepts a three-digit status code (or `default`) and a simple component name.

`@personaCapability(skills...)` declares formal API persona capabilities directly on TypeSpec
operations (e.g. `@personaCapability("pagination", "audit-emission")`), validating declared skills
against `packages/personas/src/traits/skill.yaml` and emitting `x-oa-sdk-persona-traits`.

`@pseudonymize(targetField, transform, options?)` annotates model properties with DPM pseudonymization
contracts (e.g. `@pseudonymize(User.email, "hmac-sha256")`), emitting `x-oa-sdk-dpm-projection`.

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
