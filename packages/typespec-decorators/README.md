# @oa-sdk/typespec-decorators

Trusted, narrow TypeSpec authoring helpers for OA SDK's versioned extension
contract. The package deliberately does not expose a generic decorator for
arbitrary `x-oa-sdk-*` JSON.

`@oaUseResponseComponent(statusCode, componentName)` emits only the existing
`oa-sdk.typespec-extensions.v5` operation-response component-reference shape.
It accepts a three-digit status code (or `default`) and a simple component name.

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
