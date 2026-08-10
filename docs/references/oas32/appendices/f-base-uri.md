<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix F: Examples of Base URI Determination and Reference Resolution

This section shows each of the four possible sources of base URIs, followed by an example with a relative `$self` and `$id`.

### Base URI Within Content

A base URI within the resource's content ([RFC3986](https://tools.ietf.org/html/rfc3986#section-5.1.1)) is the highest-precedence source of a base URI.
For OpenAPI documents, this source is the OpenAPI Object's `$self` field, while for Schema Objects that contain a `$id`, or are a subschema of a Schema Object containing a `$id`, the source is the `$id` field:

Assume the retrieval URI of the following document is `file://home/someone/src/api/openapi.yaml`:

```yaml
openapi: 3.2.0
$self: https://example.com/api/openapi
info:
  title: Example API
  version: 1.0
paths:
  /foo:
    get:
      requestBody:
        $ref: "shared/foo#/components/requestBodies/Foo"
```

Assume the retrieval URI for the following document is `https://git.example.com/shared/blob/main/shared/foo.yaml`:

```yaml
openapi: 3.2.0
$self: https://example.com/api/shared/foo
info:
  title: Shared components for all APIs
  version: 1.0
components:
  requestBodies:
    Foo:
      content:
        application/json:
          schema:
            $ref: ../schemas/foo
  schemas:
    Foo:
      $id: https://example.com/api/schemas/foo
      properties:
        bar:
          $ref: bar
    Bar:
      $id: https://example.com/api/schemas/bar
      type: string
```

In this example, the retrieval URIs are irrelevant because both documents define `$self`.

The relative `$ref` in the first document is resolved against `$self` to produce `https://example.com/api/shared/foo#/components/requestBodies/Foo`.
The portion of that URI before the `#` matches the `$self` of the second document, so the reference target is resolved to `#/components/requestBodies/Foo` in that second document.

In that document, the `$ref` in the Request Body Object is resolved using that document's `$self` as the base URI, producing `https://example.com/api/schemas/foo`.
This matches the `$id` at `#/components/schemas/Foo/$id` so it points to that Schema Object.
That Schema Object has a subschema with `$ref: bar`, which is resolved against the `$id` to produce `https://example.com/api/schemas/bar`, which matches the `$id` at `#/components/schemas/Bar/$id`.

To guarantee interoperability, Schema Objects containing an `$id`, or that are under a schema containing an `$id`, MUST be referenced by the nearest such `$id` for the non-fragment part of the reference.
As the JSON Schema specification notes, using a base URI other than the nearest `$id` and crossing that `$id` with a JSON Pointer fragment [is not interoperable](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#name-json-pointer-fragments-and-).

Note also that it is impossible for the reference at `#/components/schemas/Foo/properties/bar/$ref` to reference the schema at `#/components/schemas/Bar` using _only_ a JSON Pointer fragment, as the JSON Pointer would be resolved relative to `https://example.com/api/schemas/foo`, not to the OpenAPI document's base URI from `$self`.

### Base URI From Encapsulating Entity

If no base URI can be determined within the content, the next location to search is any encapsulating entity ([RFC3986](https://tools.ietf.org/html/rfc3986#section-5.1.2)).

This is common for Schema Objects encapsulated within an OpenAPI document.
An example of an OpenAPI Object itself being encapsulated in another entity would be a `multipart/related` archive ([[?RFC2557]]), such as the following `multipart/related; boundary="boundary-example"; type="application/openapi+yaml"` document.
Note that this is purely an example, and support for such multipart documents or any other format that could encapsulate an OpenAPI Object is not a requirement of this specification.

RFC2557 was written to allow sending hyperlinked sets of documents as email attachments, in which case there would not be a retrieval URI for the multipart attachment (although the format could also be used in HTTP as well).

```multipart
--boundary-example
Content-Type: application/openapi+yaml
Content-Location: https://example.com/api/openapi.yaml

openapi: 3.2.0
info:
  title: Example API
  version: 1.0
  externalDocs:
    url: docs.html
components:
  requestBodies:
    Foo:
      content:
        application/json:
          schema:
            $ref: "#/components/api/schemas/Foo"
  schemas:
    Foo:
      properties:
        bar:
          $ref: schemas/bar
--boundary-example
Content-Type: application/schema+json
Content-Location: https://example.com/api/schemas/bar

{
  "type": "string"
}
--boundary-example
Content-Type: text/html
Content-Location: https://example.com/api/docs.html

<html>
  <head>
    <title>API Documentation</title>
  </head>
  <body>
    <p>Awesome documentation goes here</p>
  </body>
</html>
--boundary-example
```

In this example, the URI for each part, which also serves as its base URI, comes from the part's `Content-Location` header as specified by RFC2557.
Since the Schema Object at `#/components/schemas/Foo` does not contain an `$id`, the reference in its subschema uses the OpenAPI document's base URI, which is taken from the `Content-Location` header of its part within the `multipart/related` format.
The resulting reference to `https://example.com/schemas/bar` matches the `Content-Location` header of the second part, which according to RFC2557 allows the reference target to be located within the multipart archive.

Similarly, the `url` field of the [External Documentation Object](#external-documentation-object) is resolved against the base URI from `Content-Location`, producing `https://example.com/api/docs.html` which matches the `Content-Location` of the third part.

### Base URI From the Retrieval URI

If no base URI is provided from either of the previous sources, the next source is the retrieval URI ([RFC3986](https://tools.ietf.org/html/rfc3986#section-5.1.3)).

Assume this document was retrieved from `https://example.com/api/openapis.yaml`:

```yaml
openapi: 3.2.0
info:
  title: Example API
  version: 1.0
components:
  requestBodies:
    Foo:
      content:
        application/json:
          schema:
            $ref: schemas/foo
```

Assume this document was retrieved from `https://example.com/api/schemas/foo`:

```json
{
  "type": "object",
  "properties": {
    "bar": {
      "type": "string"
    }
  }
}
```

Resolving the `$ref: schemas/foo` against the retrieval URI of the OpenAPI document produces `https://example.com/api/schemas/foo`, the retrieval URI of the JSON Schema document.

### Application-Specific Default Base URI

When constructing an OpenAPI document in memory that does not have a `$self`, or an encapsulating entity, or a retrieval URI, applications can resolve internal (fragment-only) references by assuming a default base URI ([RFC3986](https://tools.ietf.org/html/rfc3986#section-5.1.4)).
While this sort of internal resolution can be performed in practice without choosing a base URI, choosing one, such as a URN with a randomly generated UUID (e.g. `urn:uuid:f26cdaad-3193-4398-a838-4ecb7326c4c5`) avoids the need to implement it as a special case.

### Resolving Relative `$self` and `$id`

Let's re-consider the first example in this appendix, but with relative URI references for `$self` and `$id`, and retrieval URIs that support that relative usage:


Assume that the following is retrieved from `https://staging.example.com/api/openapi`:

```yaml
openapi: 3.2.0
$self: /api/openapi
info:
  title: Example API
  version: 1.0
paths:
  /foo:
    get:
      requestBody:
        $ref: "shared/foo#/components/requestBodies/Foo"
```

Assume the retrieval URI for the following document is `https://staging.example.com/api/shared/foo`:

```yaml
openapi: 3.2.0
$self: /api/shared/foo
info:
  title: Shared components for all APIs
  version: 1.0
components:
  requestBodies:
    Foo:
      content:
        application/json:
          schema:
            $ref: ../schemas/foo
  schemas:
    Foo:
      $id: /api/schemas/foo
      properties:
        bar:
          $ref: bar
    Bar:
      $id: /api/schemas/bar
      type: string
```

In this example, all of the `$self` and `$id` values are relative URI references consisting of an absolute path.
This allows the retrieval URI to set the host (and scheme), in this case `https://staging.example.com`, resulting in the first document's `$self` being `https://staging.example.com/openapi`, and the second document's `$self` being `https://staging.example.com/api/shared/foo`, with `$id` values of `https://staging.example.com/api/schemas/foo` and `https://staging.example.com/api/schemas/bar`.
Relative `$self` and `$id` values of this sort  allow the same set of documents to work when deployed to other hosts, e.g. `https://example.com` (production) or `https://localhost:8080` (local development).

---
← [index](../index.md)
