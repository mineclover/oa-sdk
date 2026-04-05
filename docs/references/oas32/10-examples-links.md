<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Example Object

An object grouping an internal or external example value with basic `summary` and `description` metadata.
The examples can show either data suitable for schema validation, or serialized data as required by the containing [Media Type Object](#media-type-object), [Parameter Object](#parameter-object), or [Header Object](#header-object).
This object is typically used in fields named `examples` (plural), and is a [referenceable](#reference-object) alternative to older `example` (singular) fields that do not support referencing or metadata.
The various fields and types of examples are explained in more detail under [Working With Examples](#working-with-examples).

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="example-summary"></a>summary | `string` | Short description for the example. |
| <a name="example-description"></a>description | `string` | Long description for the example. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="example-data-value"></a>dataValue | Any | An example of the data structure that MUST be valid according to the relevant [Schema Object](#schema-object).  If this field is present, `value` MUST be absent. |
| <a name="example-serialized-value"></a>serializedValue | `string` | An example of the serialized form of the value, including encoding and escaping as described under [Validating Examples](#validating-examples).  If `dataValue` is present, then this field SHOULD contain the serialization of the given data.  Otherwise, it SHOULD be the valid serialization of a data value that itself MUST be valid as described for `dataValue`.  This field SHOULD NOT be used if the serialization format is JSON, as the data form is easier to work with. If this field is present, `value`, and `externalValue` MUST be absent. |
| <a name="example-external-value"></a>externalValue | `string` | A URI that identifies the serialized example in a separate document, allowing for values not easily or readably expressed as a Unicode string.  If `dataValue` is present, then this field SHOULD identify a serialization of the given data.  Otherwise, the value SHOULD be the valid serialization of a data value that itself MUST be valid as described for `dataValue`. If this field is present, `serializedValue` and `value` MUST be absent. See also the rules for resolving [Relative References](#relative-references-in-api-description-uris). |
| <a name="example-value"></a>value | Any | Embedded literal example. The `value` field and `externalValue` field are mutually exclusive. To represent examples of media types that cannot naturally be represented in JSON or YAML, use a string value to contain the example, escaping where necessary.<br><br>**Deprecated for non-JSON serialization targets:** Use `dataValue` and/or `serializedValue`, which both have unambiguous syntax and semantics, instead. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

In all cases, the example value SHOULD be compatible with the schema of its associated value.
Tooling implementations MAY choose to validate compatibility automatically, and reject the example value(s) if incompatible.
See [Validating Examples](#validating-examples) for the exact meaning of "compatible" for each field in this Object.

#### Working with Examples

Example Objects can be used in [Parameter Objects](#parameter-object), [Header Objects](#header-object), and [Media Type Objects](#media-type-object).
In all three Objects, this is done through the `examples` (plural) field.
However, there are several other ways to provide examples: The `example` (singular) field that is mutually exclusive with `examples` in all three Objects, and two keywords (the deprecated singular `example` and the current plural `examples`, which takes an array of examples) in the [Schema Object](#schema-object) that appears in the `schema` field of all three Objects.
We will refer to the singular `example` field in the Parameter, Header, or Media Type Object, which has the same behavior as a single Example Object with only the `value` field, as the "shorthand `example`" field.
Each of these fields has slightly different considerations.

##### JSON-Compatible and `value`-Safe Examples

The `value` and the shorthand `example` field are intended to have the same _semantics_ as `serializedValue` (or `externalValue`), while allowing a more convenient _syntax_ when there is no difference between a JSON (or [JSON-compatible YAML](#format)) representation and the final serialized form.
When using this syntax for `application/json` or any `+json` media type, these fields effectively behave like `dataValue`, as the serialization is trivial, and they are safe to use.

For data that consists of a single string, and a serialization target such as `text/plain` where the string is guaranteed to be serialized without any further escaping, these fields are also safe to use.

For other serialization targets, the ambiguity of the phrase "naturally be represented in JSON or YAML," as well as past errors in the parameter style examples table, have resulted in inconsistencies in the support and usage of these fields.
In practice, this has resulted in the `value` and shorthand `example` fields having implementation-defined behavior for non-JSON targets; OAD authors SHOULD use other fields to ensure interoperability.

##### Choosing Which Field(s) to Use

Keeping in mind the caveats from the previous section, and that the shorthand `example` can be used in place of `value` if there is only one Example Object involved, use the following guidelines to determine which field to use.

To show an example as it would be validated by a Schema Object:

* Use the Schema Object's `examples` array (from JSON Schema draft 2020-12) if the intent is to keep the example with the validating schema.
  * Use the Schema Object's `example` (singular) only if compatibility with OAS v3.0 or earlier is required.
* Use the Example Object's `dataValue` field if the intent is to associate the example with an example of its serialization, or if it is desirable to maintain it separately from the schema.
  * Use the Example Object's `value` field only if compatibility with OAS v3.1 or earlier is needed and the value can be "naturally represented in JSON or YAML" without any changes (such as percent-encoding) between the validation-ready value and the serialized representation.

To show an example as it would be serialized in order to construct an HTTP/1.1 message:

* Use the Example Object's `serializedValue` if the serialization can be represented as a valid Unicode string, and there is no need to demonstrate the exact character encoding to be used.
  * Use the string form of `value` only if compatibility with OAS v3.1 or earlier is needed.
* Use the Example Object's `externalValue` for all other values, or if it is desirable to maintain the example separately from the OpenAPI document.

The `serializedValue` and `externalValue` fields both MUST show the serialized form of the data.
For Media Type Objects, this is a document of the appropriate media type, with any Encoding Object effects applied.
For Parameter and Header Objects using `schema` and `style` rather than a Media Type Object, see [Style Examples](#style-examples) for what constitutes a serialized value.

##### Criteria for `serializedExample`

A serialization can be represented as a valid Unicode string in `serializedValue` if any of the following are true of the serialization:

* It is for a media type that supports a `charset` parameter that indicates any Unicode encoding (UTF-8, UTF-16, etc.), or any valid subset of such an encoding, such as US-ASCII.
* It is for a format (such as URIs or HTTP fields) or character-based media type that requires or defaults to a Unicode encoding, or any valid subset of such an encoding, such as US-ASCII, and this is not overridden by `charset`.
* It is for a compound format where all parts meet at least one of the above criteria, e.g. a `multipart/mixed` media type with parts that are `application/json` (a media type that defaults to UTF-8) and `application/xml; charset=utf-8` (a media type with an explicit `charset` parameter).

In all of these cases, the conversion from the character set of the OAD (presumed to be UTF-8 as the only interoperable character set for JSON, and therefore also for JSON-compatible YAML as noted in [[RFC9512]] [Section 3.4](https://www.rfc-editor.org/rfc/rfc9512.html#section-3.4)) first to Unicode code points and then to the actual serialization character set is well-defined.

For `externalValue`, if the character set is neither explicitly stated nor determined by the format or media type specification, implementations SHOULD assume UTF-8.

##### Validating Examples

Tooling implementations MAY choose to validate compatibility automatically, and reject the example value(s) if incompatible.
For examples that are in schema-ready data form, this is straightforward.

With serialized examples, some formats allow multiple possible valid representations of the same data, including in scenarios noted in [Appendix B](#appendix-b-data-type-conversion).
In some cases, parsing the serialized example and validating the resulting data can eliminate the ambiguity, but in a few cases parsing is also ambiguous.
Therefore, OAD authors are cautioned that validation of certain serialized examples is by necessity a best-effort feature.

#### Example Object Examples

##### JSON Examples

When writing in YAML, JSON syntax can be used for `dataValue` (as shown in the `noRating` example) but is not required.
While this example shows the behavior of both `dataValue` and `serializedValue` for JSON (in the 'withRating` example), in most cases only the data form is needed.

```yaml
content:
  application/json:
    schema:
      type: object
      required:
      - author
      - title
      properties:
        author:
          type: string
        title:
          type: string
        rating:
          type: number
          minimum: 1
          maximum: 5
          multipleOf: 0.5
    examples:
      noRating:
        summary: A not-yet-rated work
        dataValue:
          author: A. Writer
          title: The Newest Book
      withRating:
        summary: A work with an average rating of 4.5 stars
        dataValue:
          author: A. Writer
          title: An Older Book
          rating: 4.5
        serializedValue: |
          {
            "author": "A. Writer",
            "title": "An Older Book",
            "rating": 4.5
          }
```

##### Binary Examples

Fully binary data is shown using `externalValue`:

```yaml
content:
  image/png:
    schema: {}
    examples:
      Red:
        externalValue: ./examples/2-by-2-red-pixels.png
```

##### Boolean Query Parameter Examples

Since there is no standard for serializing boolean values (as discussed in [Appendix B](#appendix-b-data-type-conversion)), this example uses `dataValue` and `serializedValue` to show how booleans are serialized for this particular parameter:

```yaml
name: flag
in: query
required: true
schema:
  type: boolean
examples:
  "true":
    dataValue: true
    serializedValue: flag=true
  "false":
    dataValue: false
    serializedValue: flag=false
```

### Link Object

The Link Object represents a possible design-time link for a response.
The presence of a link does not guarantee the caller's ability to successfully invoke it, rather it provides a known relationship and traversal mechanism between responses and other operations.

Unlike _dynamic_ links (i.e. links provided **in** the response payload), the OAS linking mechanism does not require link information in the runtime response.

For computing links and providing instructions to execute them, a [runtime expression](#runtime-expressions) is used for accessing values in an operation and using them as parameters while invoking the linked operation.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="link-operation-ref"></a>operationRef | `string` | A URI reference to an OAS operation. This field is mutually exclusive of the `operationId` field, and MUST point to an [Operation Object](#operation-object). Relative `operationRef` values MAY be used to locate an existing [Operation Object](#operation-object) in the OpenAPI Description. |
| <a name="link-operation-id"></a>operationId | `string` | The name of an _existing_, resolvable OAS operation, as defined with a unique `operationId`. This field is mutually exclusive of the `operationRef` field. |
| <a name="link-parameters"></a>parameters | Map[`string`, Any \| [{expression}](#runtime-expressions)] | A map representing parameters to pass to an operation as specified with `operationId` or identified via `operationRef`. The key is the parameter name to be used (optionally qualified with the parameter location, e.g. `path.id` for an `id` parameter in the path), whereas the value can be a constant or an expression to be evaluated and passed to the linked operation. |
| <a name="link-request-body"></a>requestBody | Any \| [{expression}](#runtime-expressions) | A literal value or [{expression}](#runtime-expressions) to use as a request body when calling the target operation. |
| <a name="link-description"></a>description | `string` | A description of the link. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="link-server"></a>server | [Server Object](#server-object) | A server object to be used by the target operation. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

A linked operation MUST be identified using either an `operationRef` or `operationId`.
The identified or referenced operation MUST be unique, and in the case of an `operationId`, it MUST be resolved within the scope of the OpenAPI Description (OAD).
Because of the potential for name clashes, the `operationRef` syntax is preferred for multi-document OADs.
However, because use of an operation depends on its URL path template in the [Paths Object](#paths-object), operations from any [Path Item Object](#path-item-object) that is referenced multiple times within the OAD cannot be resolved unambiguously.
In such ambiguous cases, the resulting behavior is implementation-defined and MAY result in an error.

Note that it is not possible to provide a constant value to `parameters` that matches the syntax of a runtime expression.
It is possible to have ambiguous parameter names, e.g. `name: "id", in: "path"` and `name: "path.id", in: "query"`; this is NOT RECOMMENDED and the behavior is implementation-defined, however implementations SHOULD prefer the qualified interpretation (`path.id` as a path parameter), as the names can always be qualified to disambiguate them (e.g. using `query.path.id` for the query parameter).

#### Examples

Computing a link from a request operation where the `$request.path.id` is used to pass a request parameter to the linked operation.

```yaml
paths:
  /users/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: the user identifier, as userId
        schema:
          type: string
    get:
      responses:
        '200':
          description: the user being returned
          content:
            application/json:
              schema:
                type: object
                properties:
                  uuid: # the unique user id
                    type: string
                    format: uuid
          links:
            address:
              # the target link operationId
              operationId: getUserAddress
              parameters:
                # get the `id` field from the request path parameter named "id"
                userid: $request.path.id
  # the path item of the linked operation
  /users/{userid}/address:
    parameters:
      - name: userid
        in: path
        required: true
        description: the user identifier, as userId
        schema:
          type: string
    # linked operation
    get:
      operationId: getUserAddress
      responses:
        '200':
          description: the user's address
```

When a runtime expression fails to evaluate, no parameter value is passed to the target operation.

Values from the response body can be used to drive a linked operation.

```yaml
links:
  address:
    operationId: getUserAddressByUUID
    parameters:
      # get the `uuid` field from the `uuid` field in the response body
      userUuid: $response.body#/uuid
```

Clients follow all links at their discretion.
Neither permissions nor the capability to make a successful call to that link is guaranteed
solely by the existence of a relationship.

##### `operationRef` Examples

As the `operationId` is an optional field in an [Operation Object](#operation-object), references MAY instead be made through a URI reference with `operationRef`.
Note that both of these examples reference operations that can be identified via the [Paths Object](#paths-object) to ensure that the operation's path template is unambiguous.

A relative URI reference `operationRef`:

```yaml
links:
  UserRepositories:
    # returns array of '#/components/schemas/repository'
    operationRef: '#/paths/~12.0~1repositories~1%7Busername%7D/get'
    parameters:
      username: $response.body#/username
```

A non-relative URI `operationRef`:

```yaml
links:
  UserRepositories:
    # returns array of '#/components/schemas/repository'
    operationRef: https://na2.gigantic-server.com/#/paths/~12.0~1repositories~1%7Busername%7D/get
    parameters:
      username: $response.body#/username
```

Note that in the use of `operationRef` the _escaped forward-slash_ (`~1`) is necessary when
using JSON Pointer in URI fragments, and it is necessary to URL-encode `{` and `}` as `%7B` and `%7D`, respectively.
The unescaped, percent-decoded path template in the above examples would be `/2.0/repositories/{username}`.

#### Runtime Expressions

Runtime expressions allow defining values based on information that will only be available within the HTTP message in an actual API call.
This mechanism is used by [Link Objects](#link-object) and [Callback Objects](#callback-object).

The runtime expression is defined by the following [ABNF](https://tools.ietf.org/html/rfc5234) syntax

```abnf
    expression = "$url" / "$method" / "$statusCode" / "$request." source / "$response." source
    source     = header-reference / query-reference / path-reference / body-reference
    header-reference = "header." token
    query-reference  = "query." name
    path-reference   = "path." name
    body-reference   = "body" ["#" json-pointer ]
    json-pointer    = *( "/" reference-token )
    reference-token = *( unescaped / escaped )
    unescaped       = %x00-2E / %x30-7D / %x7F-10FFFF
                    ; %x2F ('/') and %x7E ('~') are excluded from 'unescaped'
    escaped         = "~" ( "0" / "1" )
                    ; representing '~' and '/', respectively
    name = *char
    token = 1*tchar
    tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "."
          / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
```

Here, `json-pointer` is taken from [RFC6901](https://tools.ietf.org/html/rfc6901), `char` from [RFC8259](https://tools.ietf.org/html/rfc8259#section-7) and `token` from [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2).

The `name` identifier is case-sensitive, whereas `token` is not.

The table below provides examples of runtime expressions and examples of their use in a value:

##### Example Expressions

| Source Location | example expression | notes |
| ---- | :---- | :---- |
| HTTP Method | `$method` | The allowable values for the `$method` will be those for the HTTP operation. |
| Requested media type | `$request.header.accept` | |
| Request parameter | `$request.path.id` | Request parameters MUST be declared in the `parameters` section of the parent operation or they cannot be evaluated. This includes request headers. |
| Request body property | `$request.body#/user/uuid` | In operations which accept payloads, references may be made to portions of the `requestBody` or the entire body. |
| Request URL | `$url` | |
| Response value | `$response.body#/status` | In operations which return payloads, references may be made to portions of the response body or the entire body. |
| Response header | `$response.header.Server` | Single header values only are available |

Runtime expressions preserve the type of the referenced value.
Expressions can be embedded into string values by surrounding the expression with `{}` curly braces.

---
← [index](./index.md)
