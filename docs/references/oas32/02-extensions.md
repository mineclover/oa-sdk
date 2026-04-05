<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Specification Extensions

While the OpenAPI Specification tries to accommodate most use cases, additional data can be added to extend the specification at certain points.

The extensions properties are implemented as patterned fields that are always prefixed by `x-`.

| Field Pattern | Type | Description |
| ---- | :--: | ---- |
| <a name="extension-properties"></a>^x- | Any | Allows extensions to the OpenAPI Schema. The field name MUST begin with `x-`, for example, `x-internal-id`. Field names beginning `x-oai-` and `x-oas-` are reserved for uses defined by the [OpenAPI Initiative](https://www.openapis.org/). The value can be any valid JSON value (`null`, a primitive, an array, or an object.) |

The OpenAPI Initiative maintains several [[OpenAPI-Registry|extension registries]], including registries for [individual extension keywords](https://spec.openapis.org/registry/extension/) and [extension keyword namespaces](https://spec.openapis.org/registry/namespace/).

Extensions are one of the best ways to prove the viability of proposed additions to the specification.
It is therefore RECOMMENDED that implementations be designed for extensibility to support community experimentation.

Support for any one extension is OPTIONAL, and support for one extension does not imply support for others.

---
← [index](./index.md)
