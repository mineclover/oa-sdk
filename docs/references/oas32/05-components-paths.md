<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Components Object

Holds a set of reusable objects for different aspects of the OAS.
All objects defined within the Components Object will have no effect on the API unless they are explicitly referenced from outside the Components Object.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :---- | ---- |
| <a name="components-schemas"></a> schemas | Map[`string`, [Schema Object](#schema-object)] | An object to hold reusable [Schema Objects](#schema-object). |
| <a name="components-responses"></a> responses | Map[`string`, [Response Object](#response-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Response Objects](#response-object). |
| <a name="components-parameters"></a> parameters | Map[`string`, [Parameter Object](#parameter-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Parameter Objects](#parameter-object). |
| <a name="components-examples"></a> examples | Map[`string`, [Example Object](#example-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Example Objects](#example-object). |
| <a name="components-request-bodies"></a> requestBodies | Map[`string`, [Request Body Object](#request-body-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Request Body Objects](#request-body-object). |
| <a name="components-headers"></a> headers | Map[`string`, [Header Object](#header-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Header Objects](#header-object). |
| <a name="components-security-schemes"></a> securitySchemes | Map[`string`, [Security Scheme Object](#security-scheme-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Security Scheme Objects](#security-scheme-object). |
| <a name="components-links"></a> links | Map[`string`, [Link Object](#link-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Link Objects](#link-object). |
| <a name="components-callbacks"></a> callbacks | Map[`string`, [Callback Object](#callback-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Callback Objects](#callback-object). |
| <a name="components-path-items"></a> pathItems | Map[`string`, [Path Item Object](#path-item-object)] | An object to hold reusable [Path Item Objects](#path-item-object). |
| <a name="components-media-types"></a> mediaTypes | Map[`string`, [Media Type Object](#media-type-object) \| [Reference Object](#reference-object)] | An object to hold reusable [Media Type Objects](#media-type-object). |

This object MAY be extended with [Specification Extensions](#specification-extensions).

All the fixed fields declared above are objects that MUST use keys that match the regular expression: `^[a-zA-Z0-9\.\-_]+$`.

Field Name Examples:

```text
User
User_1
User_Name
user-name
my.org.User
```

#### Components Object Example

```yaml
components:
  schemas:
    GeneralError:
      type: object
      properties:
        code:
          type: integer
          format: int32
        message:
          type: string
    Category:
      type: object
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
    Tag:
      type: object
      properties:
        id:
          type: integer
          format: int64
        name:
          type: string
  parameters:
    skipParam:
      name: skip
      in: query
      description: number of items to skip
      required: true
      schema:
        type: integer
        format: int32
    limitParam:
      name: limit
      in: query
      description: max records to return
      required: true
      schema:
        type: integer
        format: int32
  responses:
    NotFound:
      description: Entity not found.
    IllegalInput:
      description: Illegal input for operation.
    GeneralError:
      description: General Error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/GeneralError'
  securitySchemes:
    api_key:
      type: apiKey
      name: api-key
      in: header
    petstore_auth:
      type: oauth2
      flows:
        implicit:
          authorizationUrl: https://example.org/api/oauth/dialog
          scopes:
            write:pets: modify pets in your account
            read:pets: read your pets
```

### Paths Object

Holds the relative paths to the individual endpoints and their operations.
The path is appended to the URL from the [Server Object](#server-object) in order to construct the full URL. The Paths Object MAY be empty, due to [Access Control List (ACL) constraints](#security-filtering).

#### Patterned Fields

| Field Pattern | Type | Description |
| ---- | :----: | ---- |
| <a name="paths-path"></a>/{path} | [Path Item Object](#path-item-object) | A relative path to an individual endpoint. The field name MUST begin with a forward slash (`/`). The URL from the [Server Object](#server-object)'s `url` field, resolved and with template variables substituted, has the path **appended** (no relative URL resolution) to it in order to construct the full URL. [Path templating](#path-templating) is allowed. When matching URLs, concrete (non-templated) paths would be matched before their templated counterparts. Templated paths with the same hierarchy but different templated names MUST NOT exist as they are identical. In case of ambiguous matching, it's up to the tooling to decide which one to use. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Path Templating

Path templating refers to the usage of template expressions, delimited by curly braces (`{}`), to mark a section of a URL path as replaceable using path parameters.

Each template expression in the path MUST correspond to a path parameter that is included in the [Path Item](#path-item-object) itself and/or in each of the Path Item's [Operations](#operation-object). An exception is if the path item is empty, for example due to ACL constraints, matching path parameters are not required.

The value for these path parameters MUST NOT contain any unescaped "generic syntax" characters described by [RFC3986](https://tools.ietf.org/html/rfc3986#section-3): forward slashes (`/`), question marks (`?`), or hashes (`#`).
See [URL Percent-Encoding](#url-percent-encoding) for additional guidance on escaping characters.

The path templating is defined by the following [ABNF](https://tools.ietf.org/html/rfc5234) syntax

```abnf
path-template                  = "/" *( path-segment "/" ) [ path-segment ]
path-segment                   = 1*( path-literal / template-expression )
path-literal                   = 1*pchar
template-expression            = "{" template-expression-param-name "}"
template-expression-param-name = 1*( %x00-7A / %x7C / %x7E-10FFFF ) ; every Unicode character except { and }

pchar               = unreserved / pct-encoded / sub-delims / ":" / "@"
unreserved          = ALPHA / DIGIT / "-" / "." / "_" / "~"
pct-encoded         = "%" HEXDIG HEXDIG
sub-delims          = "!" / "$" / "&" / "'" / "(" / ")"
                    / "*" / "+" / "," / ";" / "="
```

Here, `pchar`, `unreserved`, `pct-encoded` and `sub-delims` definitions are taken from [RFC 3986](https://tools.ietf.org/html/rfc3986). The `path-template` is directly derived from [RFC 3986, section 3.3](https://datatracker.ietf.org/doc/html/rfc3986#section-3.3).

Each template expression MUST NOT appear more than once in a single path template.

See also [Appendix C: Using RFC6570-Based Serialization](#appendix-c-using-rfc6570-based-serialization) for additional guidance.

##### Path Templating Matching

Assuming the following paths, the concrete definition, `/pets/mine`, will be matched first if used:

```text
  /pets/{petId}
  /pets/mine
```

The following paths are considered identical and invalid:

```text
  /pets/{petId}
  /pets/{name}
```

The following may lead to ambiguous resolution:

```text
  /{entity}/me
  /books/{id}
```

#### Paths Object Example

```yaml
/pets:
  get:
    description: Returns all pets from the system that the user has access to
    responses:
      '200':
        description: A list of pets.
        content:
          application/json:
            schema:
              type: array
              items:
                $ref: '#/components/schemas/pet'
```

---
← [index](./index.md)
