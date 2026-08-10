<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### OpenAPI Object

This is the root object of the [OpenAPI Description](#openapi-description-structure).

#### Fixed Fields

In addition to the required fields, at least one of the `components`, `paths`, or `webhooks` fields MUST be present.

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="oas-version"></a>openapi | `string` | **REQUIRED**. This string MUST be the [version number](#versions-and-deprecation) of the OpenAPI Specification that the OpenAPI document uses. The `openapi` field SHOULD be used by tooling to interpret the OpenAPI document. This is _not_ related to the [`info.version`](#info-version) string, which describes the OpenAPI document's version. |
| <a name="oas-self"></a>$self | `string` | This string MUST be in the form of a URI reference as defined by [[RFC3986]] [Section 4.1](https://www.rfc-editor.org/rfc/rfc3986#section-4.1). The `$self` field provides the self-assigned URI of this document, which also serves as its base URI in accordance with [[RFC3986]] [Section 5.1.1](https://www.rfc-editor.org/rfc/rfc3986#section-5.1.1). Implementations MUST support identifying the targets of [API description URIs](#relative-references-in-api-description-uris) using the URI defined by this field when it is present. See [Establishing the Base URI](#establishing-the-base-uri) for the base URI behavior when `$self` is absent or relative, and see [Appendix F](#appendix-f-examples-of-base-uri-determination-and-reference-resolution) for examples of using `$self` to resolve references. |
| <a name="oas-info"></a>info | [Info Object](#info-object) | **REQUIRED**. Provides metadata about the API. The metadata MAY be used by tooling as required. |
| <a name="oas-json-schema-dialect"></a> jsonSchemaDialect | `string` | The default value for the `$schema` keyword within [Schema Objects](#schema-object) contained within this OAS document. This MUST be in the form of a URI. |
| <a name="oas-servers"></a>servers | [[Server Object](#server-object)] | An array of Server Objects, which provide connectivity information to a target server. If the `servers` field is not provided, or is an empty array, the default value would be an array consisting of a single [Server Object](#server-object) with a [url](#server-url) value of `/`. |
| <a name="oas-paths"></a>paths | [Paths Object](#paths-object) | The available paths and operations for the API. |
| <a name="oas-webhooks"></a>webhooks | Map[`string`, [Path Item Object](#path-item-object)] | The incoming webhooks that MAY be received as part of this API and that the API consumer MAY choose to implement. Closely related to the `callbacks` feature, this section describes requests initiated other than by an API call, for example by an out of band registration. The key name is a unique string to refer to each webhook, while the (optionally referenced) Path Item Object describes a request that may be initiated by the API provider and the expected responses. An [example](https://learn.openapis.org/examples/v3.1/webhook-example.html) is available. |
| <a name="oas-components"></a>components | [Components Object](#components-object) | An element to hold various Objects for the OpenAPI Description. |
| <a name="oas-security"></a>security | [[Security Requirement Object](#security-requirement-object)] | A declaration of which security mechanisms can be used across the API. The list of values includes alternative Security Requirement Objects that can be used. Only one of the Security Requirement Objects need to be satisfied to authorize a request. Individual operations can override this definition. The list can be incomplete, up to being empty or absent. To make security explicitly optional, an empty security requirement (`{}`) can be included in the array. |
| <a name="oas-tags"></a>tags | [[Tag Object](#tag-object)] | A list of tags used by the OpenAPI Description with additional metadata. The order of the tags can be used to reflect on their order by the parsing tools. Not all tags that are used by the [Operation Object](#operation-object) must be declared. The tags that are not declared MAY be organized randomly or based on the tools' logic. Each tag name in the list MUST be unique. |
| <a name="oas-external-docs"></a>externalDocs | [External Documentation Object](#external-documentation-object) | Additional external documentation. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

To ensure interoperability, references MUST use the target document's `$self` URI if the `$self` field is present.
Implementations MAY choose to support referencing by other URIs such as the retrieval URI even when `$self` is present, however this behavior is not interoperable and relying on it is NOT RECOMMENDED.

#### OpenAPI Description Structure

An **OpenAPI Description** (**OAD**) formally describes the surface of an API and its semantics.
An OAD MAY be made up of a single document, or be distributed across multiple documents that are connected by various fields using [URI references](#relative-references-in-api-description-uris) and [implicit connections](#resolving-implicit-connections).

In order for parsing behavior to be well-defined, all documents in an OAD MUST have either an OpenAPI Object or a Schema Object at the root, and MUST be parsed as complete documents, as described in the next section.

Documents with a different Object at the root, or that mix OAD content with other content, MAY be supported, but will have implementation-defined or, potentially, undefined behavior as described in [Appendix G: Parsing and Resolution Guidance](#appendix-g-parsing-and-resolution-guidance).
Throughout this specification, documents are assumed to have either an OpenAPI Object or Schema Object at the root unless otherwise specified.

In a multi-document OAD, the document containing the OpenAPI Object where parsing begins is known as that OAD's **entry document**.
It is RECOMMENDED that the entry document of an OAD be named `openapi.json` or `openapi.yaml`.

An OpenAPI Object MAY be embedded in another format, called the **embedding format**, just as JSON Schema is embedded in the OAS in the form of Schema Objects.
It is the responsibility of an embedding format to define how to parse embedded content, and OAS implementations that do not document support for an embedding format cannot be expected to parse embedded OAS content correctly.

##### Parsing Documents

Each document in an OAD MUST be fully parsed in order to locate possible reference targets.
This includes the parsing requirements of [JSON Schema Specification Draft 2020-12](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-9), with appropriate modifications regarding base URIs as specified in [Relative References In URIs](#relative-references-in-api-description-uris).
Reference targets are defined by fields including the OpenAPI Object's [`$self`](#oas-self) field and the [Schema Object's](#schema-object) `$id`, `$anchor`, and `$dynamicAnchor` keywords.

Implementations MUST NOT treat a reference as unresolvable before completely parsing all documents provided to the implementation as possible parts of the OAD.

If only the referenced part of the document is parsed when resolving a reference, the resulting behavior can be implementation-defined or undefined; see [Warnings Regarding Fragmentary Parsing](#warnings-regarding-fragmentary-parsing) in [Appendix G](#appendix-g-parsing-and-resolution-guidance) for details.

##### Relative References in API Description URIs

URIs used as references within an OpenAPI Description, or to external documentation or other supplementary information such as a license, are resolved as _identifiers_, and described by this specification as **_URIs_**, in contrast with [API URLs](#relative-references-in-api-urls).
Note that some URI fields are named `url` for historical reasons, but the descriptive text for those fields uses the correct "URI" terminology.

As noted under [Parsing Documents](#parsing-documents), several fields can be used to associate an OpenAPI document or a Schema Object with a URI, which might not match the document's or schema's location.
This allows the same references to be used in different deployment environments, including local filesystems or networks restricted by security policies or connectivity limitations.

Unless specified otherwise, all fields that are URIs MAY be relative references as defined by [[RFC3986]] [Section 4.2](https://tools.ietf.org/html/rfc3986#section-4.2).

###### Establishing the Base URI

Relative URI references are resolved using the appropriate base URI, which MUST be determined in accordance with [[RFC3986]] [Section 5.1.1 – 5.1.4](https://tools.ietf.org/html/rfc3986#section-5.1.1) and, for Schema objects, [JSON Schema draft 2020-12 Section 8.2](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-8.2), as illustrated by the examples in [Appendix F: Examples of Base URI Determination and Reference Resolution](#appendix-f-examples-of-base-uri-determination-and-reference-resolution).

If `$self` is a relative URI reference, it is resolved against the next possible base URI source ([[RFC3986]] [Section 5.1.2 – 5.1.4](https://tools.ietf.org/html/rfc3986#section-5.1.2)) before being used for the resolution of other relative URI references.

The most common base URI source that is used in the event of a missing or relative `$self` (in the [OpenAPI Object](#openapi-object)) and (for [Schema Object](#schema-object)) `$id` is the retrieval URI.
Implementations MAY support document retrieval, although see the [Security Considerations](#security-considerations) sections for additional guidance.
Even if retrieval is supported, it may be impossible due to network configuration or server unavailability (including the server hosting an older version while a new version is in development), or undesirable due to performance impacts.
Therefore, all implementations SHOULD allow users to provide documents with their intended retrieval URIs so that references can be resolved as if retrievals were performed.

###### Resolving URI fragments

If a URI contains a fragment identifier, then the fragment should be resolved per the fragment resolution mechanism of the referenced document. If the representation of the referenced document is JSON or YAML, then the fragment identifier SHOULD be interpreted as a JSON Pointer as per [RFC6901](https://tools.ietf.org/html/rfc6901).

###### Relative URI References in CommonMark Fields

Relative references in CommonMark hyperlinks are resolved in their rendered context, which might differ from the context of the API description.

##### Resolving Implicit Connections

Several features of this specification require resolution of non-URI-based connections to some other part of the OpenAPI Description (OAD).

These connections are unambiguously resolved in single-document OADs, but the resolution process in multi-document OADs is _implementation-defined_, within the constraints described in this section.
In some cases, an unambiguous URI-based alternative is available, and OAD authors are RECOMMENDED to use the alternative to maximize interoperability.

For resolving [Components Object](#components-object) and [Tag Object](#tag-object) names from a referenced (non-entry) document, it is RECOMMENDED that tools resolve from the entry document, rather than the current document.
For resolving an [Operation Object](#operation-object) based on an `operationId`, it is RECOMMENDED to consider all Operation Objects from all parsed documents.

Note that no aspect of implicit connection resolution changes how [URIs are resolved](#relative-references-in-api-description-uris), or restricts their possible targets.

See [Appendix G: Parsing and Resolution Guidance](#appendix-g-parsing-and-resolution-guidance) for more details, including a list of Objects and fields using implicit connections.

### Info Object

The object provides metadata about the API.
The metadata MAY be used by the clients if needed, and MAY be presented in editing or documentation generation tools for convenience.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="info-title"></a>title | `string` | **REQUIRED**. The title of the API. |
| <a name="info-summary"></a>summary | `string` | A short summary of the API. |
| <a name="info-description"></a>description | `string` | A description of the API. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="info-terms-of-service"></a>termsOfService | `string` | A URI for the Terms of Service for the API. This MUST be in the form of a URI. |
| <a name="info-contact"></a>contact | [Contact Object](#contact-object) | The contact information for the exposed API. |
| <a name="info-license"></a>license | [License Object](#license-object) | The license information for the exposed API. |
| <a name="info-version"></a>version | `string` | **REQUIRED**. The version of the OpenAPI document (which is distinct from the [OpenAPI Specification version](#oas-version) or the version of the API being described or the version of the OpenAPI Description). |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Info Object Example

```yaml
title: Example Pet Store App
summary: A pet store manager.
description: This is an example server for a pet store.
termsOfService: https://example.com/terms/
contact:
  name: API Support
  url: https://www.example.com/support
  email: support@example.com
license:
  name: Apache 2.0
  url: https://www.apache.org/licenses/LICENSE-2.0.html
version: 1.0.1
```

### Contact Object

Contact information for the exposed API.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="contact-name"></a>name | `string` | The identifying name of the contact person/organization. |
| <a name="contact-url"></a>url | `string` | The URI for the contact information. This MUST be in the form of a URI. |
| <a name="contact-email"></a>email | `string` | The email address of the contact person/organization. This MUST be in the form of an email address. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Contact Object Example

```yaml
name: API Support
url: https://www.example.com/support
email: support@example.com
```

### License Object

License information for the exposed API.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="license-name"></a>name | `string` | **REQUIRED**. The license name used for the API. |
| <a name="license-identifier"></a>identifier | `string` | An [SPDX](https://spdx.org/licenses/) license expression for the API. The `identifier` field is mutually exclusive of the `url` field. |
| <a name="license-url"></a>url | `string` | A URI for the license used for the API. This MUST be in the form of a URI. The `url` field is mutually exclusive of the `identifier` field. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### License Object Example

```yaml
name: Apache 2.0
identifier: Apache-2.0
```

---
← [index](./index.md)
