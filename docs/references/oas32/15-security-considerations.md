<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Security Considerations

### OpenAPI Description Formats

OpenAPI Descriptions use a combination of JSON, YAML, and JSON Schema, and therefore share their security considerations:

* [JSON](https://www.iana.org/assignments/media-types/application/json)
* [YAML](https://www.iana.org/assignments/media-types/application/yaml)
* [JSON Schema Core](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-13)
* [JSON Schema Validation](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-10)

### Tooling and Usage Scenarios

In addition, OpenAPI Descriptions are processed by a wide variety of tooling for numerous different purposes, such as client code generation, documentation generation, server side routing, and API testing. OpenAPI Description authors must consider the risks of the scenarios where the OpenAPI Description may be used.

### Security Schemes

An OpenAPI Description describes the security schemes used to protect the resources it defines. The security schemes available offer varying degrees of protection. Factors such as the sensitivity of the data and the potential impact of a security breach should guide the selection of security schemes for the API resources. Some security schemes, such as basic auth and OAuth Implicit flow, are supported for compatibility with existing APIs. However, their inclusion in OpenAPI does not constitute an endorsement of their use, particularly for highly sensitive data or operations.

The rules for connecting a [Security Requirement Object](#security-requirement-object) to a [Security Scheme Object](#security-scheme-object) under a [Components Object](#components-object) are ambiguous in a way that could be exploited. Specifically:

* It is implementation-defined whether a component name used by a Security Requirement Object in a referenced document is resolved from the entry document (RECOMMENDED) or the referenced document.
* A Security Requirement Object that uses a URI to identify a Security Scheme Object can have the URI resolution hijacked by providing a Security Scheme component name identical to the URI, as the name lookup behavior takes precedence over URI resolution for compatibility with previous versions of the OAS.

### Security Filtering

Some objects in the OpenAPI Specification MAY be declared and remain empty, or be completely removed, even though they are inherently the core of the API documentation.

The reasoning is to allow an additional layer of access control over the documentation.
While not part of the specification itself, certain libraries MAY choose to allow access to parts of the documentation based on some form of authentication/authorization.

Two examples of this:

1. The [Paths Object](#paths-object) MAY be present but empty. It may be counterintuitive, but this may tell the viewer that they got to the right place, but can't access any documentation. They would still have access to at least the [Info Object](#info-object) which may contain additional information regarding authentication.
2. The [Path Item Object](#path-item-object) MAY be empty. In this case, the viewer will be aware that the path exists, but will not be able to see any of its operations or parameters. This is different from hiding the path itself from the [Paths Object](#paths-object), because the user will be aware of its existence. This allows the documentation provider to finely control what the viewer can see.

### Handling External Resources

OpenAPI Descriptions may contain references to external resources that may be dereferenced automatically by consuming tools. External resources may be hosted on different domains that may be untrusted.

### Handling Reference Cycles

References in an OpenAPI Description may cause a cycle. Tooling must detect and handle cycles to prevent resource exhaustion.

### Markdown and HTML Sanitization

Certain fields allow the use of Markdown which can contain HTML including script. It is the responsibility of tooling to appropriately sanitize the Markdown.

---
← [index](./index.md)
