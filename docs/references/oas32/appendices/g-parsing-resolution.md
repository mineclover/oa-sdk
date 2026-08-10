<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix G: Parsing and Resolution Guidance

Implementations MAY support complete-document parsing in any of the following ways:

* Detecting OpenAPI or JSON Schema documents using media types
* Detecting OpenAPI documents through the root `openapi` field
* Detecting JSON Schema documents through detecting keywords or otherwise successfully parsing the document in accordance with the JSON Schema specification

Additional mechanisms can be used to support documents with Objects other than an OpenAPI Object or a Schema Object at the root, but note that the resulting behavior is implementation-defined:

* Detecting a document containing a referenceable Object at its root based on the expected type of the reference
* Allowing users to configure the type of documents that might be loaded due to a reference to a non-root Object

### Warnings Regarding Fragmentary Parsing

Implementations that parse referenced fragments of OpenAPI content without regard for the content of the rest of the containing document will miss keywords that change the meaning and behavior of the reference target.
In particular, failing to take into account keywords that change the base URI introduces security risks by causing references to resolve to unintended URIs, with unpredictable results.
While some implementations support this sort of parsing due to the requirements of past versions of this specification, in version 3.1 and later, the result of parsing fragments in isolation is _undefined_ and likely to contradict the requirements of this specification.

While it is possible to structure certain OpenAPI Descriptions to ensure that they will behave correctly when references are parsed as isolated fragments, depending on this is NOT RECOMMENDED.
This specification does not explicitly enumerate the conditions under which such behavior is safe and provides no guarantee for continued safety in any future versions of the OAS.

### Conflicts Between Field Types and Reference Contexts

JSON or YAML objects within an OAD are interpreted as specific Objects (such as [Operation Objects](#operation-object), [Response Objects](#response-object), [Reference Objects](#reference-object), etc.) based on their context. Depending on how references are arranged, a given JSON or YAML object can be interpreted in multiple different contexts:

* As the root object of the [entry document](#openapi-description-structure), which is always interpreted as an OpenAPI Object
* As the Object type implied by its parent Object's field within the document
* As a reference target, with the Object type matching the reference source's context

If the same JSON/YAML object is parsed multiple times and the respective contexts require it to be parsed as _different_ Object types, the resulting behavior is _implementation defined_, and MAY be treated as an error if detected. An example would be referencing an empty Schema Object under `#/components/schemas` where a Path Item Object is expected, as an empty object is valid for both types. For maximum interoperability, it is RECOMMENDED that OpenAPI Description authors avoid such scenarios.

### Guidance Regarding Implicit Connections

The following Objects and Fields involve the use of implicit connections:

| Source | Target | Alternative |
| ---- | ---- | ---- |
| [Security Requirement Object](#security-requirement-object) `{name}` | [Security Scheme Object](#security-scheme-object) name under the [Components Object](#components-object) | _n/a_ |
| [Discriminator Object](#discriminator-object) `mapping` _(implicit, or explicit name syntax)_ | [Schema Object](#schema-object) name under the Components Object | `mapping` _(explicit URI syntax)_ |
| [Operation Object](#operation-object) `tags` | [Tag Object](#tag-object) `name` (in the [OpenAPI Object](#openapi-object)'s `tags` array) | _n/a_ |
| [Link Object](#link-object) `operationId` | [Operation Object](#operation-object) `operationId` | `operationRef` |

An additional implicit connection involves appending the templated URL paths of the [Paths Object](#paths-object) to the appropriate [Server Object](#server-object)'s `url` field.
This connection is unambiguous because only the entry document's Paths Object contributes URLs to the described API.

The implicit connections in the Security Requirement Object and Discriminator Object rely on the _component name_, which is the name of the property holding the component in the appropriately typed sub-object of the Components Object.
For example, the component name of the Schema Object at `#/components/schemas/Foo` is `Foo`.
The implicit connection of `tags` in the Operation Object uses the `name` field of Tag Objects, which (like the Components Object) are found under the root OpenAPI Object.
This means resolving component names and tag names both depend on starting from the correct OpenAPI Object.

For resolving component and tag name connections from a referenced (non-entry) document, it is RECOMMENDED that tools resolve from the entry document, rather than the current document.
Resolving component and tag name connections from a referenced (non-entry) document to the entry document as recommended under [Resolving Implicit Connections](#resolving-implicit-connections) allows components and Tag Objects to be defined next to the API's deployment information in the top-level array of Server Objects and treated as an interface for referenced documents to access.

For Security Requirement Objects and Discriminator Objects, it is also possible to keep the resolution within the referenced document by using the URI-reference form that these Objects offer.

There are no URI-based alternatives for the Operation Object's `tags` field.
OAD authors are advised to use external solutions such as the OpenAPI Initiative's Overlay Specification to simulate sharing [Tag Objects](#tag-object) across multiple documents.

#### Implicit Connection Resolution Examples

This section shows how to retrieve an HTTP-accessible multi-document OpenAPI Description (OAD) and resolve a [Security Requirement Object](#security-requirement-object) in the referenced (non-entry) document.
The behavior for Discriminator Object non-URI mappings and for the Operation Object's `tags` field operate on the same principles.

First, the [entry document](#openapi-description-structure) is where parsing begins. It defines the `MySecurity` security scheme to be JWT-based, and it defines a Path Item as a reference to a component in another document:

```http
GET /api/description/openapi HTTP/1.1
Host: www.example.com
Accept: application/openapi+json
```

```json
"components": {
  "securitySchemes": {
    "MySecurity": {
      "type": "http",
      "scheme": "bearer",
      "bearerFormat": "JWT"
    }
  }
},
"paths": {
  "/foo": {
    "$ref": "other#/components/pathItems/Foo"
  }
}
```

```http
GET /api/description/openapi HTTP/1.1
Host: www.example.com
Accept: application/openapi+yaml
```

```yaml
components:
  securitySchemes:
    MySecurity:
      type: http
      scheme: bearer
      bearerFormat: JWT
paths:
  /foo:
    $ref: 'other#/components/pathItems/Foo'
```

This entry document references another document, `other`, without using a file extension. This gives the client the flexibility to choose an acceptable format on a resource-by-resource basis, assuming both representations are available:

```http
GET /api/description/other HTTP/1.1
Host: www.example.com
Accept: application/openapi+json
```

```json
"components": {
  "securitySchemes": {
    "MySecurity": {
      "type": "http",
      "scheme": "basic"
    }
  },
  "pathItems": {
    "Foo": {
      "get": {
        "security": [
          "MySecurity": []
        ]
      }
    }
  }
}
```

```http
GET /api/description/other HTTP/1.1
Host: www.example.com
Accept: application/openapi+yaml
```

```yaml
components:
  securitySchemes:
    MySecurity:
      type: http
      scheme: basic
  pathItems:
    Foo:
      get:
        security:
          - MySecurity: []
```

In the `other` document, the referenced path item has a Security Requirement for a Security Scheme, `MySecurity`. The same Security Scheme exists in the original entry document. As outlined in [Resolving Implicit Connections](#resolving-implicit-connections), `MySecurity` is resolved with an [implementation-defined behavior](#undefined-and-implementation-defined-behavior), but the section formally recommends that tools resolve component names from the [entry document](#openapi-description-structure). As with all implementation-defined behavior, it is important to check tool documentation to determine which behavior is supported.

---
← [index](../index.md)
