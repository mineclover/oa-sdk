<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Request Body Object

Describes a single request body.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="request-body-description"></a>description | `string` | A brief description of the request body. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="request-body-content"></a>content | Map[`string`, [Media Type Object](#media-type-object) \| [Reference Object](#reference-object)] | **REQUIRED**. The content of the request body. The key is a media type or [media type range](https://www.rfc-editor.org/rfc/rfc9110.html#appendix-A) and the value describes it. The map SHOULD have at least one entry; if it does not, the behavior is implementation-defined. For requests that match multiple keys, only the most specific key is applicable. e.g. `"text/plain"` overrides `"text/*"` |
| <a name="request-body-required"></a>required | `boolean` | Determines if the request body is required in the request. Defaults to `false`. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Request Body Examples

A request body with a referenced schema definition.

```yaml
description: user to add to the system
content:
  application/json:
    schema:
      $ref: '#/components/schemas/User'
    examples:
      user:
        summary: User example
        externalValue: https://foo.bar/examples/user-example.json
  application/xml:
    schema:
      $ref: '#/components/schemas/User'
    examples:
      user:
        summary: User example in XML
        externalValue: https://foo.bar/examples/user-example.xml
  text/plain:
    examples:
      user:
        summary: User example in plain text
        externalValue: https://foo.bar/examples/user-example.txt
  '*/*':
    examples:
      user:
        summary: User example in other format
        externalValue: https://foo.bar/examples/user-example.whatever
```

### Media Type Object

Each Media Type Object describes content structured in accordance with the media type identified by its key.
Multiple Media Type Objects can be used to describe content that can appear in any of several different media types.

When `example` or `examples` are provided, the example SHOULD match the specified schema and be in the correct format as specified by the media type and its encoding.
The `example` and `examples` fields are mutually exclusive.
See [Working With Examples](#working-with-examples) for further guidance regarding the different ways of specifying examples, including non-JSON/YAML values.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="media-type-schema"></a>schema | [Schema Object](#schema-object) | A schema describing the complete content of the request, response, parameter, or header. |
| <a name="media-type-item-schema"></a>itemSchema | [Schema Object](#schema-object) | A schema describing each item within a [sequential media type](#sequential-media-types). |
| <a name="media-type-example"></a>example | Any | Example of the media type; see [Working With Examples](#working-with-examples). |
| <a name="media-type-examples"></a>examples | Map[ `string`, [Example Object](#example-object) \| [Reference Object](#reference-object)] | Examples of the media type; see [Working With Examples](#working-with-examples). |
| <a name="media-type-encoding"></a>encoding | Map[`string`, [Encoding Object](#encoding-object)] | A map between a property name and its encoding information, as defined under [Encoding By Name](#encoding-by-name).  The `encoding` field SHALL only apply when the media type is `multipart` or `application/x-www-form-urlencoded`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `prefixEncoding` or `itemEncoding` are present. |
| <a name="media-type-prefix-encoding"></a>prefixEncoding | [[Encoding Object](#encoding-object)] | An array of positional encoding information, as defined under [Encoding By Position](#encoding-by-position).  The `prefixEncoding` field SHALL only apply when the media type is `multipart`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `encoding` is present. |
| <a name="media-type-item-encoding"></a>itemEncoding | [Encoding Object](#encoding-object) | A single Encoding Object that provides encoding information for multiple array items, as defined under [Encoding By Position](#encoding-by-position). The `itemEncoding` field SHALL only apply when the media type is `multipart`. If no Encoding Object is provided for a property, the behavior is determined by the default values documented for the Encoding Object. This field MUST NOT be present if `encoding` is present. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Media Types

Media types are publicly registered with the [IANA media types registry](https://www.iana.org/assignments/media-types/media-types.xhtml), through process documented in [[?RFC6838]].

APIs also sometimes define private media types such as GitHub's `application/vnd.github.v3+json`, which are not registered, and other media types such as `application/schema+json` become widely used before an intended registration.

See [Parsing and Serializing](#parsing-and-serializing) under the [Schema Object](#schema-object) for guidance on using schemas with a variety of media types.

##### OpenAPI Media Type Registry

The OpenAPI Initiative maintains a [Media Type Registry](https://spec.openapis.org/registry/media-type/) summarizing media type support expected by this specification and providing an index to which sections address which media types.
It also links to IANA registrations (where they exist) and to the most notable specification document(s) related to each media type.
Any additional media types added to this registry as extensions or for later versions of this or other OpenAPI specifications MAY be supported by implementations of this version of the OAS.

#### Complete vs Streaming Content

The `schema` field MUST be applied to the complete content, as defined by the media type and the context ([Request Body Object](#request-body-object), [Response Object](#response-object), [Parameter Object](#parameter-object), or [Header Object](#header-object).
Because this requires loading the content into memory in its entirety, it poses a challenge for streamed content.
Use cases where clients are intended to choose when to stop reading are particularly challenging as there is no well-defined end to the stream.

##### Sequential Media Types

Within this specification, a _sequential media type_ is defined as any media type that consists of a repeating structure, without any sort of header, footer, envelope, or other metadata in addition to the sequence.

Some examples of sequential media types (including some that are not IANA-registered but are in common use) are:

```text
  application/jsonl
  application/x-ndjson
  application/json-seq
  application/geo+json-seq
  text/event-stream
  multipart/mixed
```

In the first three above, the repeating structure is any [JSON value](https://tools.ietf.org/html/rfc8259#section-3).
The fourth repeats `application/geo+json`-structured values, while `text/event-stream` repeats a custom text format related to Server-Sent Events.
The final media type listed above, `multipart/mixed`, provides an ordered list of documents of any media type, and is sometimes streamed.
Note that while `multipart` formats technically allow a preamble and an epilogue, the RFC directs that they are to be ignored, making them effectively comments, and this specification does not model them.

Implementations MUST support mapping sequential media types into the JSON Schema data model by treating them as if the values were in an array in the same order.

See [Complete vs Streaming Content](#complete-vs-streaming-content) for more information on handling sequential media types in a streaming context, including special considerations for `text/event-stream` content.
For `multipart` types, see also [Encoding By Position](#encoding-by-position).

###### Streaming Sequential Media Types

The `itemSchema` field is provided to support streaming use cases for sequential media types, with `itemEncoding` as a corresponding encoding mechanism for streaming [positional `multipart` media types](#encoding-by-position).

Unlike `schema`, which is applied to the complete content (treated as an array as described in the [sequential media types](#sequential-media-types) section), `itemSchema` MUST be applied to each item in the stream independently, which supports processing each item as it is read from the stream.

Both `schema` and `itemSchema` MAY be used in the same Media Type Object.
However, doing so is unlikely to have significant advantages over using the `items` keyword within the `schema` field.

##### Binary Streams

The `maxLength` keyword MAY be used to set an expected upper bound on the length of a streaming payload that consists of either string data, including encoded binary data, or unencoded binary data.
For unencoded binary data, the length is the number of octets.
For this use case, `maxLength` MAY be implemented outside of regular JSON Schema evaluation as JSON Schema does not directly apply to binary data, and an encoded binary stream may be impractical to store in memory in its entirety.

#### Special Considerations for Server-Sent Events

For `text/event-stream`, implementations MUST work with event data after it has been parsed according to the [`text/event-stream` specification](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream), including all guidance on ignoring certain fields (including comments) and/or values, and on combining values split across multiple lines.

Field value types MUST be handled as specified by the `text/event-stream` specification (e.g. the `retry` field value is modeled as a JSON number that is expected to be of JSON Schema `type: integer`), and fields not given an explicit value type MUST be handled as strings.

Some users of `text/event-stream` use a format such as JSON for field values, particularly the `data` field.
Use JSON Schema's keywords for working with the [contents of string-encoded data](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#name-a-vocabulary-for-the-conten), particularly `contentMediaType` and `contentSchema`, to describe and validate such fields with more detail than string-related validation keywords such as `pattern` can support.
Note that `contentSchema` is [not automatically validated by default](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#name-implementation-requirements-2) (see also the [Non-validating constraint keywords](#non-validating-constraint-keywords) section of this specification).

The following Schema Object is a generic schema for the `text/event-stream` media type as documented by the [[?HTML]] specification as of the time of this writing:

```yaml
type: object
required:
- data
properties:
  data:
    type: string
  event:
    type: string
  id:
    type: string
  retry:
    type: integer
    minimum: 0
```

#### Encoding Usage and Restrictions

These encoding fields define how to map each [Encoding Object](#encoding-object) to a specific value in the data.
Each field has its own set of media types with which it can be used; for all other media types all three fields SHALL be ignored.

##### Encoding By Name

The behavior of the `encoding` field is designed to support web forms, and is therefore only defined for media types structured as name-value pairs that allow repeat values, most notably `application/x-www-form-urlencoded` and `multipart/form-data`.

To use the `encoding` field, each key under the field MUST exist as a property; `encoding` entries with no corresponding property SHALL be ignored.
Array properties MUST be handled by applying the given Encoding Object to produce one encoded value per array item, each with the same `name`, as is recommended by [[!RFC7578]] [Section 4.3](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.3) for supplying multiple values per form field.
For all other value types for both top-level non-array properties and for values, including array values, within a top-level array, the Encoding Object MUST be applied to the entire value.
The order of these name-value pairs in the target media type is implementation-defined.

For `application/x-www-form-urlencoded`, the encoding keys MUST map to parameter names, with the values produced according to the rules of the [Encoding Object](#encoding-object).
See [Encoding the `x-www-form-urlencoded` Media Type](#encoding-the-x-www-form-urlencoded-media-type) for guidance and examples, both with and without the `encoding` field.

For `multipart`, the encoding keys MUST map to the [`name` parameter](https://www.rfc-editor.org/rfc/rfc7578#section-4.2) of the `Content-Disposition: form-data` header of each part, as is defined for `multipart/form-data` in [[!RFC7578]].
See [[!RFC7578]] [Section 5](https://www.rfc-editor.org/rfc/rfc7578.html#section-5) for guidance regarding non-ASCII part names.

See [Encoding `multipart` Media Types](#encoding-multipart-media-types) for further guidance and examples, both with and without the `encoding` field.

##### Encoding By Position

Most `multipart` media types, including `multipart/mixed` which defines the underlying rules for parsing all `multipart` types, do not have named parts.
Data for these media types are modeled as an array, with one item per part, in order.

To use the `prefixEncoding` and/or `itemEncoding` fields, either `itemSchema` or an array `schema` MUST be present.
These fields are analogous to the `prefixItems` and `items` JSON Schema keywords, with `prefixEncoding` (if present) providing an array of Encoding Objects that are each applied to the value at the same position in the data array, and `itemEncoding` applying its single Encoding Object to all remaining items in the array.
As with `prefixItems`, it is _not_ an error if the instance array is shorter than the `prefixEncoding` array; the additional Encoding Objects SHALL be ignored.

The `itemEncoding` field can also be used with `itemSchema` to support streaming `multipart` content.

##### Additional Encoding Approaches

The `prefixEncoding` field can be used with any `multipart` content to require a fixed part order.
This includes `multipart/form-data`, for which the Encoding Object's `headers` field MUST be used to provide the `Content-Disposition` and part name, as no property names exist to provide the names automatically.

Prior versions of this specification advised using the [`name` parameter](https://www.rfc-editor.org/rfc/rfc7578#section-4.2) of the `Content-Disposition: form-data` header of each part with `multipart` media types other than `multipart/form-data` in order to work around the limitations of the `encoding` field.
Implementations MAY choose to support this workaround, but as this usage is not common, implementations of non-`form-data` `multipart` media types are unlikely to support it.

#### Media Type Examples

For form-related and `multipart` media type examples, see the [Encoding Object](#encoding-object).

##### JSON

Note that since this example is written in YAML, the Example Object's `value` field can be formatted as YAML due to the trivial conversion to JSON.
This avoids needing to embed JSON as a string.

```yaml
application/json:
  schema:
    $ref: '#/components/schemas/Pet'
  examples:
    cat:
      summary: An example of a cat
      value:
        name: Fluffy
        petType: Cat
        color: White
        gender: male
        breed: Persian
    dog:
      summary: An example of a dog with a cat's name
      value:
        name: Puma
        petType: Dog
        color: Black
        gender: Female
        breed: Mixed
    frog:
      $ref: '#/components/examples/frog-example'
```

Alternatively, since all JSON is valid YAML, the example value can use JSON syntax within a YAML document:

```yaml
application/json:
  schema:
    $ref: '#/components/schemas/Pet'
  examples:
    cat:
      summary: An example of a cat
      value: {
        "name": "Fluffy",
        "petType": "Cat",
        "color": "White",
        "gender": "male",
        "breed": "Persian"
      }
    dog:
      summary: An example of a dog with a cat's name
      value: {
        "name": "Puma",
        "petType": "Dog",
        "color": "Black",
        "gender": "Female",
        "breed": "Mixed"
      }
    frog:
      $ref: '#/components/examples/frog-example'
```

##### Sequential JSON

For any [sequential media type](#sequential-media-types) where the items in the sequence are JSON values, no conversion of each value is required.
JSON Text Sequences ([[?RFC7464]] `application/json-seq` and [[?RFC8091]] the `+json-seq` structured suffix), [JSON Lines](https://jsonlines.org/) (`application/jsonl`), and [NDJSON](https://github.com/ndjson/ndjson-spec) (`application/x-ndjson`) are all in this category.
Note that the media types for JSON Lines and NDJSON are not registered with the IANA, but are in common use.

The following example shows Media Type Objects for both streaming log entries and returning a fixed-length set in response to a query.
This shows the relationship between `schema` and `itemSchema`, and when to use each even though the `examples` field is the same either way.

```yaml
components:
  schemas:
    LogEntry:
      type: object
      properties:
        timestamp:
          type: string
          format: date-time
        level:
          type: integer
          minimum: 0
        message:
          type: string
    Log:
      type: array
      items:
        $ref: "#/components/schemas/LogEntry"
      maxItems: 100
  examples:
    LogJSONSeq:
      summary: Log entries in application/json-seq
      # JSON Text Sequences require an unprintable character
      # that cannot be escaped in a YAML string, and therefore
      # must be placed in an external document shown below
      externalValue: examples/log.json-seq
    LogJSONPerLine:
      summary: Log entries in application/jsonl or application/x-ndjson
      description: JSONL and NDJSON are identical for this example
      # Note that the value must be written as a string with newlines,
      # as JSONL and NDJSON are not valid YAML
      value: |
        {"timestamp": "1985-04-12T23:20:50.52Z", "level": 1, "message": "Hi!"}
        {"timestamp": "1985-04-12T23:20:51.37Z", "level": 1, "message": "Bye!"}
  responses:
    LogStream:
      description: |
        A stream of JSON-format log messages that can be read
        for as long as the application is running, and is available
        in any of the sequential JSON media types.
      content:
        application/json-seq:
          itemSchema:
            $ref: "#/components/schemas/LogEntry"
          examples:
            JSON-SEQ:
              $ref: "#/components/examples/LogJSONSeq"
        application/jsonl:
          itemSchema:
            $ref: "#/components/schemas/LogEntry"
          examples:
            JSONL:
              $ref: "#/components/examples/LogJSONPerLine"
        application/x-ndjson:
          itemSchema:
            $ref: "#/components/schemas/LogEntry"
          examples:
            NDJSON:
              $ref: "#/components/examples/LogJSONPerLine"
    LogExcerpt:
      description: |
        A response consisting of no more than 100 log records,
        generally as a result of a query of the historical log,
        available in any of the sequential JSON media types.
      content:
        application/json-seq:
          schema:
            $ref: "#/components/schemas/Log"
          examples:
            JSON-SEQ:
              $ref: "#/components/examples/LogJSONSeq"
        application/jsonl:
          schema:
            $ref: "#/components/schemas/Log"
          examples:
            JSONL:
              $ref: "#/components/examples/LogJSONPerLine"
        application/x-ndjson:
          schema:
            $ref: "#/components/schemas/Log"
          examples:
            NDJSON:
              $ref: "#/components/examples/LogJSONPerLine"
```

Our `application/json-seq` example has to be an external document because of the use of both newlines and of the unprintable Record Separator (`0x1E`) character, which cannot be escaped in YAML block literals:

```jsonseq
0x1E{
  "timestamp": "1985-04-12T23:20:50.52Z",
  "level": 1,
  "message": "Hi!"
}
0x1E{
  "timestamp": "1985-04-12T23:20:51.37Z",
  "level": 1,
  "message": "Bye!"
}
```

##### Server-Sent Event Streams

For this example, assume that the generic event schema provided in the [Special Considerations for Server-Sent Events](#special-considerations-for-server-sent-events) section is available at `#/components/schemas/Event`:

```yaml
description: A request body to add a stream of typed data.
required: true
content:
  text/event-stream:
    itemSchema:
      $ref: "#/components/schemas/Event"
      required: [event]
      oneOf:
      - properties:
          event:
            const: addString
      - properties:
          event:
            const: addInt64
          data:
            $comment: |
              Since the `data` field is a string,
              we need a format to signal that it
              should be handled as a 64-bit integer.
            format: int64
      - properties:
          event:
            const: addJson
          data:
            $comment: |
              These content fields indicate
              that the string value should
              be parsed and validated as a
              JSON document (since JSON is not
              a binary format, `contentEncoding`
              is not needed)
            contentMediaType: application/json
            contentSchema:
              type: object
              required: [foo]
              properties:
                foo:
                  type: integer
```

The following `text/event-stream` document is an example of a valid request body for the above example:

```eventstream
event: addString
data: This data is formatted
data: across two lines
retry: 5

event: addInt64
data: 1234.5678
unknownField: this is ignored

: This is a comment
event: addJSON
data: {"foo": 42}
```

To more clearly see how this stream is handled, the following is the equivalent JSON Lines document, which shows how the numeric and JSON data are handled as strings, and how unknown fields and comments are ignored and not passed to schema validation:

```jsonl
{"event": "addString", "data": "This data is formatted\nacross two lines", "retry": 5}
{"event": "addInt64", "data": "1234.5678"}
{"event": "addJSON", "data": "{\"foo\": 42}"}
```

#### Considerations for File Uploads

In contrast to OpenAPI 2.0, `file` input/output content in OAS 3.x is described with the same semantics as any other schema type.

In contrast to OAS 3.0, the `format` keyword has no effect on the content-encoding of the schema in OAS 3.1. Instead, JSON Schema's `contentEncoding` and `contentMediaType` keywords are used. See [Working With Binary Data](#working-with-binary-data) for how to model various scenarios with these keywords, and how to migrate from the previous `format` usage.

Examples:

Content transferred in binary (octet-stream) MAY omit `schema`:

```yaml
# a PNG image as a binary file:
content:
  image/png: {}
```

```yaml
# an arbitrary binary file:
content:
  application/octet-stream: {}
```

```yaml
# arbitrary JSON without constraints beyond being syntactically valid:
content:
  application/json: {}
```

These examples apply to either input payloads of file uploads or response payloads.

A `requestBody` for submitting a file in a `POST` operation may look like the following example:

```yaml
requestBody:
  content:
    application/octet-stream: {}
```

In addition, specific media types MAY be specified:

```yaml
# multiple, specific media types may be specified:
requestBody:
  content:
    # a binary file of type png or jpeg
    image/jpeg: {}
    image/png: {}
```

To upload multiple files, a `multipart` media type MUST be used as shown under [Example: Multipart Form with Multiple Files](#example-multipart-form-with-multiple-files).

### Encoding Object

A single encoding definition applied to a single value, with the mapping of Encoding Objects to values determined by the [Media Type Object](#media-type-object) as described under [Encoding Usage and Restrictions](#encoding-usage-and-restrictions).

See [Appendix B](#appendix-b-data-type-conversion) for a discussion of converting values of various types to string representations.

See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns for form media types.

#### Fixed Fields

##### Common Fixed Fields

These fields MAY be used either with or without the RFC6570-style serialization fields defined in the next section below.

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="encoding-content-type"></a>contentType | `string` | The `Content-Type` for encoding a specific property. The value is a comma-separated list, each element of which is either a specific media type (e.g. `image/png`) or a wildcard media type (e.g. `image/*`). The default value depends on the type as shown in the table below. |
| <a name="encoding-headers"></a>headers | Map[`string`, [Header Object](#header-object) \| [Reference Object](#reference-object)] | A map allowing additional information to be provided as headers. `Content-Type` is described separately and SHALL be ignored in this section. This field SHALL be ignored if the media type is not a `multipart`. |
| <a name="encoding-encoding"></a>encoding | Map[`string`, [Encoding Object](#encoding-object)] | Applies nested Encoding Objects in the same manner as the [Media Type Object](#media-type-object)'s `encoding` field. |
| <a name="encoding-prefix-encoding"></a>prefixEncoding | [[Encoding Object](#encoding-object)] | Applies nested Encoding Objects in the same manner as the [Media Type Object](#media-type-object)'s `prefixEncoding` field. |
| <a name="encoding-item-encoding"></a>itemEncoding | [Encoding Object](#encoding-object) | Applies nested Encoding Objects in the same manner as the [Media Type Object](#media-type-object)'s `itemEncoding` field. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

The default values for `contentType` are as follows, where an _n/a_ in the `contentEncoding` column means that the presence or value of `contentEncoding` is irrelevant.
This table is based on the value to which the Encoding Object is being applied as defined under [Encoding Usage and Restrictions](#encoding-usage-and-restrictions).
Note that in the case of [Encoding By Name](#encoding-by-name), this value is the array item for properties of type `"array"`, and the entire value for all other types.
Therefore the `array` row in this table applies only to array values inside of a top-level array when encoding by name.

| `type` | `contentEncoding` | Default `contentType` |
| ---- | ---- | ---- |
| [_absent_](#working-with-binary-data) | _n/a_ | `application/octet-stream` |
| `string` | _present_ | `application/octet-stream` |
| `string` | _absent_ | `text/plain` |
| `number`, `integer`, or `boolean` | _n/a_ | `text/plain` |
| `object` | _n/a_ | `application/json` |
| `array` | _n/a_ | `application/json` |

Determining how to handle a `type` value of `null` depends on how `null` values are being serialized.
If `null` values are entirely omitted, then the `contentType` is irrelevant.
See [Appendix B](#appendix-b-data-type-conversion) for a discussion of data type conversion options.

##### Fixed Fields for RFC6570-style Serialization

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="encoding-style"></a>style | `string` | Describes how a specific property value will be serialized depending on its type. See [Parameter Object](#parameter-object) for details on the [`style`](#parameter-style) field. The behavior follows the same values as `query` parameters, including the default value of `"form"` which applies only when `contentType` is _not_ being used due to one or both of `explode` or `allowReserved` being explicitly specified. Note that the initial `?` used in query strings is not used in `application/x-www-form-urlencoded` message bodies, and MUST be removed (if using an RFC6570 implementation) or simply not added (if constructing the string manually). This field SHALL be ignored if the media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](#encoding-content-type) (implicit or explicit) SHALL be ignored. |
| <a name="encoding-explode"></a>explode | `boolean` | When this is true, property values of type `array` or `object` generate separate parameters for each value of the array, or key-value-pair of the map. For other types of properties, or when [`style`](#encoding-style) is `"deepObject"`, this field has no effect. When `style` is `"form"`, the default value is `true`. For all other styles, the default value is `false`. This field SHALL be ignored if the media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](#encoding-content-type) (implicit or explicit) SHALL be ignored. |
| <a name="encoding-allow-reserved"></a>allowReserved | `boolean` | When this is true, parameter values are serialized using reserved expansion, as defined by [RFC6570](https://datatracker.ietf.org/doc/html/rfc6570#section-3.2.3), which allows [RFC3986's reserved character set](https://datatracker.ietf.org/doc/html/rfc3986#section-2.2), as well as percent-encoded triples, to pass through unchanged, while still percent-encoding all other disallowed characters (including `%` outside of percent-encoded triples). Applications are still responsible for percent-encoding reserved characters that are not allowed in the target media type; see [URL Percent-Encoding](#url-percent-encoding) for details. The default value is `false`. This field SHALL be ignored if the media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](#encoding-content-type) (implicit or explicit) SHALL be ignored. |

When using RFC6570-style serialization for `multipart/form-data`, URI percent-encoding MUST NOT be applied, and the value of `allowReserved` has no effect.
See also [Appendix C: Using RFC6570 Implementations](#appendix-c-using-rfc6570-based-serialization) for additional guidance.

Note that the presence of at least one of `style`, `explode`, or `allowReserved` with an explicit value is equivalent to using `schema` with `in: "query"` Parameter Objects.
The absence of all three of those fields is the equivalent of using `content`, but with the media type specified in `contentType` rather than through a Media Type Object.

#### Nested Encoding

Nested formats requiring encoding, most notably nested `multipart/mixed`, can be supported with this Object's `encoding`, `prefixEncoding`, and / or `itemEncoding` fields.
Implementations MUST support one level of nesting, and MAY support additional levels.

#### Encoding the `x-www-form-urlencoded` Media Type

To work with content using form url encoding via [[WHATWG-URL]], use the `application/x-www-form-urlencoded` media type in the [Media Type Object](#media-type-object).
This configuration means that the content MUST be percent-encoded per [[WHATWG-URL]]'s rules for that media type, after any complex objects have been serialized to a string representation.

See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns for form media types.

##### Example: URL Encoded Form with JSON Values

When there is no [`encoding`](#media-type-encoding) field, the serialization strategy is based on the Encoding Object's default values:

```yaml
requestBody:
  content:
    application/x-www-form-urlencoded:
      schema:
        type: object
        properties:
          id:
            type: string
            format: uuid
          address:
            type: object
            properties: {}
```

With this example, consider an `id` of `f81d4fae-7dec-11d0-a765-00a0c91e6bf6` and a US-style address (with ZIP+4) as follows:

```json
{
  "streetAddress": "123 Example Dr.",
  "city": "Somewhere",
  "state": "CA",
  "zip": "99999+1234"
}
```

Assuming the most compact representation of the JSON value (with unnecessary whitespace removed), we would expect to see the following request body, where space characters have been replaced with `+` and `+`, `"`, `:`, `,`, `{`, and `}` have been percent-encoded to `%2B`, `%22`, `%3A`, `%2C`, `%7B`, and `%7D`, respectively:

```uri
id=f81d4fae-7dec-11d0-a765-00a0c91e6bf6&address=%7B%22streetAddress%22%3A%22123+Example+Dr.%22%2C%22city%22%3A%22Somewhere%22%2C%22state%22%3A%22CA%22%2C%22zip%22%3A%2299999%2B1234%22%7D
```

Note that the `id` keyword is treated as `text/plain` per the [Encoding Object](#encoding-object)'s default behavior, and is serialized as-is.
If it were treated as `application/json`, then the serialized value would be a JSON string including quotation marks, which would be percent-encoded as `%22`.

Here is the `id` parameter (without `address`) serialized as `application/json` instead of `text/plain`, and then encoded per [[WHATWG-URL]]'s `form-urlencoded` rules:

```uri
id=%22f81d4fae-7dec-11d0-a765-00a0c91e6bf6%22
```

##### Example: URL Encoded Form with Binary Values

Note that `application/x-www-form-urlencoded` is a text format, which requires base64-encoding any binary data:

```yaml
requestBody:
  content:
    application/x-www-form-urlencoded:
      schema:
        type: object
        properties:
          name:
            type: string
          icon:
            # The default content type with `contentEncoding` present
            # is `application/octet-stream`, so we need to set the correct
            # image media type(s) in the Encoding Object.
            type: string
            contentEncoding: base64url
  encoding:
    icon:
      contentType: image/png, image/jpeg
```

Given a name of `example` and a solid red 2x2-pixel PNG for `icon`, this
would produce a request body of:

```uri
name=example&icon=iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAABGdBTUEAALGPC_xhBQAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAADO0J6QAAAAEElEQVQIHWP8zwACTGCSAQANHQEDqtPptQAAAABJRU5ErkJggg%3D%3D
```

Note that the `=` padding characters at the end need to be percent-encoded, even with the "URL safe" `contentEncoding: base64url`.
Some base64-decoding implementations may be able to use the string without the padding per [RFC4648](https://datatracker.ietf.org/doc/html/rfc4648#section-3.2).
However, this is not guaranteed, so it may be more interoperable to keep the padding and rely on percent-decoding.

#### Encoding `multipart` Media Types

See [Encoding Usage and Restrictions](#encoding-usage-and-restrictions) for guidance on correlating schema properties with parts.

Note that there are significant restrictions on what headers can be used with `multipart` media types in general ([RFC2046](https://www.rfc-editor.org/rfc/rfc2046.html#section-5.1)) and `multi-part/form-data` in particular ([RFC7578](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.8)).

##### Handling Multiple `contentType` Values

When multiple values are provided for `contentType`, parsing remains straightforward as the part's actual `Content-Type` is included in the document.

For encoding and serialization, implementations MUST provide a mechanism for applications to indicate which media type is intended.
Implementations MAY choose to offer media type sniffing ([[SNIFF]]) as an alternative, but this MUST NOT be the default behavior due to the security risks inherent in the process.

##### `Content-Transfer-Encoding` and `contentEncoding`

Using `contentEncoding` for a multipart field is equivalent to specifying an [Encoding Object](#encoding-object) with a `headers` field containing `Content-Transfer-Encoding` with a schema that requires the value used in `contentEncoding`.
If `contentEncoding` is used for a multipart field that has an Encoding Object with a `headers` field containing `Content-Transfer-Encoding` with a schema that disallows the value from `contentEncoding`, the result is undefined for serialization and parsing.

Note that as stated in [Working with Binary Data](#working-with-binary-data), if the Encoding Object's `contentType`, whether set explicitly or implicitly through its default value rules, disagrees with the `contentMediaType` in a Schema Object, the `contentMediaType` SHALL be ignored.
Because of this, and because the Encoding Object's `contentType` defaulting rules do not take the Schema Object's`contentMediaType` into account, the use of `contentMediaType` with an Encoding Object is NOT RECOMMENDED.

Note also that `Content-Transfer-Encoding` is deprecated for `multipart/form-data` ([RFC7578](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.7)) where binary data is supported, as it is in HTTP.

See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns for form media types.

##### Example: Basic Multipart Form

When the `encoding` field is _not_ used, the encoding is determined by the Encoding Object's defaults:

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        properties:
          # default content type for a string without `contentEncoding`
          # is `text/plain`
          id:
            type: string
            format: uuid

          # default content type for a schema without `type`
          # is `application/octet-stream`
          profileImage: {}

          # for arrays, the `encoding` field applies the Encoding Object
          # to each item individually and determines the default content type
          # based on the type in the `items` subschema, which in this example
          # is an object, so the default content type for each item is
          # `application/json`
          addresses:
            type: array
            items:
              $ref: '#/components/schemas/Address'
```

##### Example: Multipart Form with Encoding Objects

Using `encoding`, we can set more specific types for binary data, or non-JSON formats for complex values.
We can also describe headers for each part:

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        type: object
        properties:
          # No Encoding Object, so use default `text/plain`
          id:
            type: string
            format: uuid

          # Encoding Object overrides the default `application/json` content type
          # for each item in the array with `application/xml; charset=utf-8`
          addresses:
            description: addresses in XML format
            type: array
            items:
              $ref: '#/components/schemas/Address'

          # Encoding Object accepts only PNG or JPEG, and also describes
          # a custom header for just this part in the multipart format
          profileImage: {}

      encoding:
        addresses:
          contentType: application/xml; charset=utf-8
        profileImage:
          contentType: image/png, image/jpeg
          headers:
            X-Rate-Limit-Limit:
              description: The number of allowed requests in the current period
              schema:
                type: integer
```

##### Example: Multipart Form with Multiple Files

In accordance with [RFC7578](https://www.rfc-editor.org/rfc/rfc7578.html#section-4.3), multiple files for a single form field are uploaded using the same name (`file` in this example) for each file's part:

```yaml
requestBody:
  content:
    multipart/form-data:
      schema:
        properties:
          # The property name `file` will be used for all files.
          file:
            type: array
            items: {}
```

As seen in the [Encoding Object's `contentType` field documentation](#encoding-content-type), the empty schema for `items` indicates a media type of `application/octet-stream`.

##### Example: Ordered, Unnamed Multipart

A `multipart/mixed` payload consisting of a JSON metadata document followed by an image which the metadata describes:

```yaml
multipart/mixed:
  schema:
    type: array
    prefixItems:
    - # default content type for objects
      # is `application/json`
      type: object
      properties:
        author:
          type: string
        created:
          type: string
          format: datetime
        copyright:
          type: string
        license:
          type: string
    - # default content type for a schema without `type`
      # is `application/octet-stream`, which we need
      # to override.
      {}
  prefixEncoding:
  - # Encoding Object defaults are correct for JSON
    {}
  - contentType: image/*
```

##### Example: Ordered Multipart With Required Header

As described in [[?RFC2557]], a set of resources making up a web page can be sent in a `multipart/related` payload, preserving links from the `text/html` document to subsidiary resources such as scripts, style sheets, and images by defining a `Content-Location` header for each page.
The first part is used as the root resource (unless using `Content-ID`, which RFC2557 advises against and is forbidden in this example), so we use `prefixItems` and `prefixEncoding` to define that it must be an HTML resource, and then allow any of several different types of resources in any order to follow.

The `Content-Location` header is defined using `content: {text/plain: {...}}` to avoid percent-encoding its URI value; see [Appendix D](./appendices/d-headers-cookies.md) for further details.

```yaml
components:
  headers:
    RFC2557NoContentId:
      description: Use Content-Location instead of Content-ID
      schema: false
    RFC2557ContentLocation:
      required: true
      content:
        text/plain:
          schema:
            $comment: Use a full URI (not a relative reference)
            type: string
            format: uri
  requestBodies:
    RFC2557:
      content:
        multipart/related; type=text/html:
          schema:
            prefixItems:
            - type: string
            items:
              anyOf:
              - type: string
              - $comment: To allow binary, this must always pass
          prefixEncoding:
          - contentType: text/html
            headers:
              Content-ID:
                $ref: '#/components/headers/RFC2557NoContentId'
              Content-Location:
                $ref: '#/components/headers/RFC2557ContentLocation'
          itemEncoding:
            contentType: text/css,text/javascript,image/*
            headers:
              Content-ID:
                $ref: '#/components/headers/RFC2557NoContentId'
              Content-Location:
                $ref: '#/components/headers/RFC2557ContentLocation'
```

##### Example: Streaming Multipart

This example assumes a device that takes large sets of pictures and streams them to the caller.
Unlike the previous example, we use `itemSchema` here because the expectation is that each image is processed as it arrives (or in small batches), since we know that buffering the entire stream will take too much memory.

```yaml
multipart/mixed:
  itemSchema:
    $comment: A single data image from the device
  itemEncoding:
    contentType: image/jpg
```

##### Example: Streaming Byte Ranges

For `multipart/byteranges` [[RFC9110]] [Section 14.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.6), a `Content-Range` header is required:

See [Appendix D](./appendices/d-headers-cookies.md) for an explanation of why `content: {text/plain: {...}}` is used to describe the header value.

```yaml
multipart/byteranges:
  itemSchema:
    $comment: A single range of bytes from a video
  itemEncoding:
    contentType: video/mp4
    headers:
      Content-Range:
        required: true
        content:
          text/plain:
            schema:
              # The `pattern` regular expression that would
              # be included in practice is omitted for simplicity
              type: string
```

##### Example: Nested `multipart/mixed`

This defines a two-part `multipart/mixed` where the first part is a JSON array and the second part is a nested `multipart/mixed` document.
The nested parts are XML, plain text, and a PNG image.

```yaml
multipart/mixed:
  schema:
    type: array
    prefixItems:
    - type: array
    - type: array
      prefixItems:
      - type: object
      - type: string
      - {}
  prefixEncoding:
    - {} # Accept the default application/json
    - contentType: multipart/mixed
      prefixEncoding:
      - contentType: application/xml
      - {} # Accept the default text/plain
      - contentType: image/png
```

---
← [index](./index.md)
