<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Schema Object

The Schema Object allows the definition of input and output data types.
These types can be objects, but also primitives and arrays. This object is a superset of the [JSON Schema Specification Draft 2020-12](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html). The empty schema (which allows any instance to validate) MAY be represented by the boolean value `true` and a schema which allows no instance to validate MAY be represented by the boolean value `false`.

For more information about the keywords, see [JSON Schema Core](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html) and [JSON Schema Validation](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html).

Unless stated otherwise, the keyword definitions follow those of JSON Schema and do not add any additional semantics; this includes keywords such as `$schema`, `$id`, `$ref`, and `$dynamicRef` being URIs rather than URLs.
Where JSON Schema indicates that behavior is defined by the application (e.g. for annotations), OAS also defers the definition of semantics to the application consuming the OpenAPI document.

#### JSON Schema Keywords

The OpenAPI Schema Object [dialect](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.3.3) is defined as requiring the [OAS base vocabulary](#base-vocabulary), in addition to the vocabularies as specified in the JSON Schema Specification Draft 2020-12 [general purpose meta-schema](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-8).

The OpenAPI Schema Object dialect for this version of the specification is identified by the URI `https://spec.openapis.org/oas/3.1/dialect/base` (the <a name="dialect-schema-id"></a>"OAS dialect schema id").

The following keywords are taken from the JSON Schema specification but their definitions have been extended by the OAS:

* description - [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation.
* format - See [Data Type Formats](#data-type-format) for further details. While relying on JSON Schema's defined formats, the OAS offers a few additional predefined formats.

In addition to the JSON Schema keywords comprising the OAS dialect, the Schema Object supports keywords from any other vocabularies, or entirely arbitrary properties.

JSON Schema implementations MAY choose to treat keywords defined by the OpenAPI Specification's base vocabulary as [unknown keywords](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.3.1), due to its inclusion in the OAS dialect with a [`$vocabulary`](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-8.1.2) value of `false`.
<a name="base-vocabulary"></a>The OAS base vocabulary is comprised of the following keywords:

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="schema-discriminator"></a>discriminator | [Discriminator Object](#discriminator-object) | The discriminator provides a "hint" for which of a set of schemas a payload is expected to satisfy. See [Composition and Inheritance](#composition-and-inheritance-polymorphism) for more details. |
| <a name="schema-xml"></a>xml | [XML Object](#xml-object) | Adds additional metadata to describe the XML representation of this schema. |
| <a name="schema-external-docs"></a>externalDocs | [External Documentation Object](#external-documentation-object) | Additional external documentation for this schema. |
| <a name="schema-example"></a>example | Any | A free-form field to include an example of an instance for this schema. To represent examples that cannot be naturally represented in JSON or YAML, a string value can be used to contain the example with escaping where necessary.<br><br>**Deprecated:** The `example` field has been deprecated in favor of the JSON Schema `examples` keyword. Use of `example` is discouraged, and later versions of this specification may remove it. |

This object MAY be extended with [Specification Extensions](#specification-extensions), though as noted, additional properties MAY omit the `x-` prefix within this object.

#### Data Types

Data types in the OAS are based on the types defined by the [JSON Schema Validation Specification Draft 2020-12](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-6.1.1):
"null", "boolean", "object", "array", "number", "string", or "integer".
Models are defined using the [Schema Object](#schema-object), which is a superset of the JSON Schema Specification Draft 2020-12.

JSON Schema keywords and `format` values operate on JSON "instances" which may be one of the six JSON data types, "null", "boolean", "object", "array", "number", or "string", with certain keywords and formats only applying to a specific type. For example, the `pattern` keyword and the `date-time` format only apply to strings, and treat any instance of the other five types as _automatically valid._ This means JSON Schema keywords and formats do **NOT** implicitly require the expected type. Use the `type` keyword to explicitly constrain the type.

Note that the `type` keyword allows `"integer"` as a value for convenience, but keyword and format applicability does not recognize integers as being of a distinct JSON type from other numbers because [[RFC8259|JSON]] itself does not make that distinction. Since there is no distinct JSON integer type, JSON Schema defines integers mathematically. This means that both `1` and `1.0` are [equivalent](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.2.2), and are both considered to be integers.

##### Data Type Format

As defined by the [JSON Schema Validation specification](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-7.3), data types can have an optional modifier keyword: `format`. As described in that specification, `format` is treated as a non-validating annotation by default; the ability to validate `format` varies across implementations.

The OpenAPI Initiative also hosts a [Format Registry](https://spec.openapis.org/registry/format/) for formats defined by OAS users and other specifications. Support for any registered format is strictly OPTIONAL, and support for one registered format does not imply support for any others.

Types that are not accompanied by a `format` keyword follow the type definition in the JSON Schema. Tools that do not recognize a specific `format` MAY default back to the `type` alone, as if the `format` is not specified.
For the purpose of [JSON Schema validation](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-7.1), each format should specify the set of JSON data types for which it applies. In this registry, these types are shown in the "JSON Data Type" column.

The formats defined by the OAS are:

| `format` | JSON Data Type | Comments |
| ---- | ---- | ---- |
| `int32` | number | signed 32 bits |
| `int64` | number | signed 64 bits (a.k.a long) |
| `float` | number | |
| `double` | number | |
| `password` | string | A hint to obscure the value. |

As noted under [Data Type](#data-types), both `type: number` and `type: integer` are considered to be numbers in the data model.

#### Parsing and Serializing

API data has several forms:

1. The serialized form, which is either a document of a particular media type, an HTTP header value, or part of a URI.
2. The data form, intended for use with a [Schema Object](#schema-object).
3. The application form, which incorporates any additional information conveyed by JSON Schema keywords such as `format` and `contentType`, and possibly additional information such as class hierarchies that are beyond the scope of this specification, although they MAY be based on specification elements such as the [Discriminator Object](#discriminator-object) or guidance regarding [Data Modeling Techniques](#data-modeling-techniques).

##### JSON Data

JSON-serialized data is nearly equivalent to the data form because the [JSON Schema data model](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.2.1) is nearly equivalent to the JSON representation.
The serialized UTF-8 JSON string `{"when": "1985-04-12T23:20:50.52"}` represents an object with one data field, named `when`, with a string value, `1985-04-12T23:20:50.52`.

The exact application form is beyond the scope of this specification, as can be shown with the following schema for our JSON instance:

```yaml
type: object
properties:
  when:
    type: string
    format: date-time
```

Some applications might leave the string as a string regardless of programming language, while others might notice the `format` and use it as a `datetime.datetime` instance in Python, or a `java.time.ZonedDateTime` in Java.
This specification only requires that the data is valid according to the schema, and that [annotations](#extended-validation-with-annotations) such as `format` are available in accordance with the JSON Schema specification.

##### Non-JSON Data

Non-JSON serializations can be substantially different from their corresponding data form, and might require several steps to parse.

To continue our "when" example, if we serialized the object as `application/x-www-form-urlencoded`, it would appear as the ASCII string `when=1985-04-12T23%3A20%3A50.52`.
This example is still straightforward to use as it is all string data, and the only differences from JSON are the URI percent-encoding and the delimiter syntax (`=` instead of JSON punctuation and quoting).

However, many non-JSON text-based formats can be complex, requiring examination of the appropriate schema(s) in order to correctly parse the text into a schema-ready data structure.
Serializing data into such formats requires either examining the schema-validated data or performing the same schema inspections.

When inspecting schemas, given a starting point schema, implementations MUST examine that schema and all schemas that can be reached from it by following only `$ref` and `allOf` keywords.
These schemas are guaranteed to apply to any instance.
When searching schemas for `type`, if the `type` keyword's value is a list of types and the serialized value can be successfully parsed as more than one of the types in the list, and no other findable `type` keyword disambiguates the actual required type, the behavior is implementation-defined.
Schema Objects that do not contain `type` MUST be considered to allow all types, regardless of which other keywords are present (e.g. `maximum` applies to numbers, but _does not_ require the instance to be a number).

Implementations MAY inspect subschemas or possible reference targets of other keywords such as `oneOf` or `$dynamicRef`, but MUST NOT attempt to resolve ambiguities.
For example, if an implementation opts to inspect `anyOf`, the schema:

```yaml
anyOf:
- type: number
  minimum: 0
- type: number
  maximum: 100
```

unambiguously indicates a numeric type, but the schema:

```yaml
anyOf:
- type: number
- maximum: 100
```

does not, because the second subschema allows all types.

Due to these limited requirements for searching schemas, serializers that have access to validated data MUST inspect the data if possible; implementations that either do not work with runtime data (such as code generators) or cannot access validated data for some reason MUST fall back to schema inspection.

Recall also that in JSON Schema, keywords that apply to a specific type (e.g. `pattern` applies to strings, `minimum` applies to numbers) _do not_ require or imply that the data will actually be of that type.

As an example of these processes, given these OpenAPI components:

```yaml
components:
  requestBodies:
    Form:
      content:
        application/x-www-form-urlencoded:
          schema:
            $ref: "#/components/schemas/FormData"
          encoding:
            extra:
              contentType: application/xml
  schemas:
    FormData:
      type: object
      properties:
        code:
          allOf:
          - type: [string, number]
            pattern: "1"
            minimum: 0
          - type: string
            pattern: "2"
        count:
          type: integer
        extra:
          type: object
```

And this request body to parse into its data form:

```uri
code=1234&count=42&extra=%3Cinfo%3Eabc%3C/info%3E
```

We must first search the schema for `properties` or other property-defining keywords, and then use each property schema as a starting point for a search for that property's `type` keyword, as follows (the exact order is implementation-defined):

* `#/components/requestBodies/Form/content/application~1x-www-form-urlencoded/schema` (initial starting point schema, only `$ref`)
* `#/components/schemas/FormData` (follow `$ref`, found `properties`)
* `#/components/schemas/FormData/properties/code` (starting point schema for `code` property)
* `#/components/schemas/FormData/properties/code/allOf/0` (follow `allOf`, found `type: [string, number]`)
* `#/components/schemas/FormData/properties/code/allOf/1` (follow `allOf`, found `type: string`)
* `#/components/schemas/FormData/properties/count` (starting point schema for `count` property, found `type: integer`)
* `#/components/schemas/FormData/properties/extra` (starting point schema for `extra` property, found `type: object`)

Note that for `code` we first found an ambiguous `type`, but then found another `type` keyword that ensures only one of the two possibilities is valid.

From this inspection, we determine that `code` is a string that happens to look like a number, while `count` needs to be parsed into a number _prior_ to schema validation.
Furthermore, the `extra` string is in fact an XML serialization of an object containing an `info` property.
This means that the data form of this serialization is equivalent to the following JSON object:

```json
{
  "code": "1234",
  "count": 42
  "extra": {
    "info": "abc"
  }
}
```

Serializing this object also requires correlating properties with [Encoding Objects](#encoding-object), and may require inspection to determine a default value of the `contentType` field.
If validated data is not available, the schema inspection process is identical to that shown for parsing.

In this example, both `code` and `count` are of primitive type and do not appear in the `encoding` field, and are therefore serialized as plain text.
However, the `extra` field is an object, which would by default be serialized as JSON, but the `extra` entry in the `encoding` field tells use to serialize it as XML instead.

##### Working with Binary Data

The OAS can describe either _raw_ or _encoded_ binary data.

* **raw binary** is used where unencoded binary data is allowed, such as when sending a binary payload as the entire HTTP message body, or as part of a `multipart/*` payload that allows binary parts
* **encoded binary** is used where binary data is embedded in a text-only format such as `application/json` or `application/x-www-form-urlencoded` (either as a message body or in the URL query string).

In the following table showing how to use Schema Object keywords for binary data, we use `image/png` as an example binary media type. Any binary media type, including `application/octet-stream`, is sufficient to indicate binary content.

| Keyword | Raw | Encoded | Comments |
| ---- | ---- | ---- | ---- |
| `type` | _omit_ | `string` | raw binary is [outside of `type`](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.2.3) |
| `contentMediaType` | `image/png` | `image/png` | can sometimes be omitted if redundant (see below) |
| `contentEncoding` | _omit_ | `base64`&nbsp;or&nbsp;`base64url` | other encodings are [allowed](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-8.3) |

Note that the encoding indicated by `contentEncoding`, which inflates the size of data in order to represent it as 7-bit ASCII text, is unrelated to HTTP's `Content-Encoding` header, which indicates whether and how a message body has been compressed and is applied after all content serialization described in this section has occurred. Since HTTP allows unencoded binary message bodies, there is no standardized HTTP header for indicating base64 or similar encoding of an entire message body.

Using a `contentEncoding` of `base64url` ensures that URL encoding (as required in the query string and in message bodies of type `application/x-www-form-urlencoded`) does not need to further encode any part of the already-encoded binary data.

The `contentMediaType` keyword is redundant if the media type is already set:

* as the key for a [Media Type Object](#media-type-object)
* in the `contentType` field of an [Encoding Object](#encoding-object)

If the [Schema Object](#schema-object) will be processed by a non-OAS-aware JSON Schema implementation, it may be useful to include `contentMediaType` even if it is redundant. However, if `contentMediaType` contradicts a relevant Media Type Object or Encoding Object, then `contentMediaType` SHALL be ignored.

See [Complete vs Streaming Content](#complete-vs-streaming-content) for guidance on streaming binary payloads.

###### Schema Evaluation and Binary Data

Few JSON Schema implementations directly support working with binary data, as doing so is not a mandatory part of that specification.

OAS Implementations that do not have access to a binary-instance-supporting JSON Schema implementation MUST examine schemas and apply them in accordance with [Working with Binary Data](#working-with-binary-data).
When the entire instance is binary, this is straightforward as few keywords are relevant.

However, `multipart` media types can mix binary and text-based data, leaving implementations with two options for schema evaluations:

1. Use a placeholder value, on the assumption that no assertions will apply to the binary data and no conditional schema keywords will cause the schema to treat the placeholder value differently (e.g. a part that could be either plain text or binary might behave unexpectedly if a string is used as a binary placeholder, as it would likely be treated as plain text and subject to different subschemas and keywords).
2. Inspect the schema(s) to find the appropriate keywords (`properties`, `prefixItems`, etc.) in order to break up the subschemas and apply them separately to binary and JSON-compatible data.

###### Migrating Binary Descriptions from OAS 3.0

The following table shows how to migrate from OAS 3.0 binary data descriptions, continuing to use `image/png` as the example binary media type:

| OAS < 3.1 | OAS >= 3.1 | Comments |
| ---- | ---- | ---- |
| <code style="white-space:nowrap">type: string</code><br /><code style="white-space:nowrap">format: binary</code> | <code style="white-space:nowrap">contentMediaType: image/png</code> | if redundant, can be omitted, often resulting in an empty [Schema Object](#schema-object) |
| <code style="white-space:nowrap">type: string</code><br /><code style="white-space:nowrap">format: byte</code> | <code style="white-space:nowrap">type: string</code><br /><code style="white-space:nowrap">contentMediaType: image/png</code><br /><code style="white-space:nowrap">contentEncoding: base64</code> | note that `base64url` can be used to avoid re-encoding the base64 string to be URL-safe |

#### Extended Validation with Annotations

JSON Schema Draft 2020-12 supports [collecting annotations](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-7.7.1), including [treating unrecognized keywords as annotations](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-6.5).
OAS implementations MAY use such annotations, including [extensions](https://spec.openapis.org/registry/extension/) not recognized as part of a declared JSON Schema vocabulary, as the basis for further validation.
Note that JSON Schema Draft 2020-12 does not require an `x-` prefix for extensions.

##### Non-Validating Constraint Keywords

The [`format` keyword (when using default format-annotation vocabulary)](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-7.2.1) and the [`contentMediaType`, `contentEncoding`, and `contentSchema` keywords](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-8.2) define constraints on the data, but are treated as annotations instead of being validated directly.
Extended validation is one way that these constraints MAY be enforced.

##### Validating `readOnly` and `writeOnly`

The `readOnly` and `writeOnly` keywords are annotations, as JSON Schema is not aware of how the data it is validating is being used.
Validation of these keywords MAY be done by checking the annotation, the read or write direction, and (if relevant) the current value of the field.
[JSON Schema Validation Draft 2020-12 Section 9.4](https://www.ietf.org/archive/id/draft-bhutton-json-schema-validation-01.html#section-9.4) defines the expectations of these keywords, including that a resource (described as the "owning authority") MAY either ignore a `readOnly` field or treat it as an error.

Fields that are both required and read-only are an example of when it is beneficial to ignore a `readOnly: true` constraint in a PUT, particularly if the value has not been changed.
This allows correctly requiring the field on a GET and still using the same representation and schema with PUT.
Even when read-only fields are not required, stripping them is burdensome for clients, particularly when the JSON data is complex or deeply nested.

Note that the behavior of `readOnly` in particular differs from that specified by version 3.0 of this specification.

#### Data Modeling Techniques

##### Composition and Inheritance (Polymorphism)

The OpenAPI Specification allows combining and extending model definitions using the `allOf` keyword of JSON Schema, in effect offering model composition.
`allOf` takes an array of object definitions that are validated _independently_ but together compose a single object.

While composition offers model extensibility, it does not imply a hierarchy between the models.

JSON Schema also provides the `anyOf` and `oneOf` keywords, which allow defining multiple schemas where at least one or exactly one of them must be valid, respectively.
As is the case with `allOf`, the schemas are validated _independently_.
These keywords can be used to describe polymorphism, where a single field can accept multiple types of values.

The OpenAPI specification extends the JSON Schema support for polymorphism by adding the [`discriminator`](#schema-discriminator) field whose value is a [Discriminator Object](#discriminator-object).
When used, the Discriminator Object indicates the name of the property that hints which schema of an `anyOf` or `oneOf` is expected to validate the structure of the model.
The discriminating property MAY be defined as required or optional, but when defined as an optional property the Discriminator Object MUST include a `defaultMapping` field that specifies which schema of the `anyOf` or `oneOf`, or which schema that references the current schema in an `allOf`, is expected to validate the structure of the model when the discriminating property is not present.

There are two ways to define the value of a discriminating property for an inheriting instance.

* Use the schema name.
* [Override the schema name](#discriminator-mapping) by overriding the property with a new value. If a new value exists, this takes precedence over the schema name.

##### Generic (Template) Data Structures

Implementations SHOULD support defining generic or template data structures using JSON Schema's dynamic referencing feature:

* `$dynamicAnchor` identifies a set of possible schemas (including a default placeholder schema) to which a `$dynamicRef` can resolve
* `$dynamicRef` resolves to the first matching `$dynamicAnchor` encountered on its path from the schema entry point to the reference, as described in the JSON Schema specification

An example is included in the [Schema Object Examples](#schema-object-examples) section below, and further information can be found on the Learn OpenAPI site's ["Dynamic References"](https://learn.openapis.org/referencing/dynamic.html) page.

##### Annotated Enumerations

The Schema Object's `enum` keyword does not allow associating descriptions or other information with individual values.

Implementations MAY support recognizing a `oneOf` or `anyOf` where each subschema in the keyword's array consists of a `const` keyword and annotations such as `title` or `description` as an enumerated type with additional information. The exact behavior of this pattern beyond what is required by JSON Schema is implementation-defined.

##### XML Modeling

The [xml](#schema-xml) field allows extra definitions when translating the JSON definition to XML.
The [XML Object](#xml-object) contains additional information about the available options.

#### Specifying Schema Dialects

It is important for tooling to be able to determine which dialect or meta-schema any given resource wishes to be processed with: JSON Schema Core, JSON Schema Validation, OpenAPI Schema dialect, or some custom meta-schema.

The `$schema` keyword MAY be present in any Schema Object that is a [schema resource root](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.3.5), and if present MUST be used to determine which dialect should be used when processing the schema. This allows use of Schema Objects which comply with other drafts of JSON Schema than the default Draft 2020-12 support. Tooling MUST support the <a href="#dialect-schema-id">OAS dialect schema id</a>, and MAY support additional values of `$schema`.

To allow use of a different default `$schema` value for all Schema Objects contained within an OAS document, a `jsonSchemaDialect` value may be set within the <a href="#openapi-object">OpenAPI Object</a>. If this default is not set, then the OAS dialect schema id MUST be used for these Schema Objects. The value of `$schema` within a resource root Schema Object always overrides any default.

For standalone JSON Schema documents that do not set `$schema`, or for Schema Objects in OpenAPI description documents that are _not_ [complete documents](#openapi-description-structure), the dialect SHOULD be assumed to be the OAS dialect.
However, for maximum interoperability, it is RECOMMENDED that OpenAPI description authors explicitly set the dialect through `$schema` in such documents.

#### Schema Object Examples

##### Primitive Example

```yaml
type: string
format: email
```

##### Simple Model

```yaml
type: object
required:
  - name
properties:
  name:
    type: string
  address:
    $ref: '#/components/schemas/Address'
  age:
    type: integer
    format: int32
    minimum: 0
```

##### Model with Map/Dictionary Properties

For a simple string to string mapping:

```yaml
type: object
additionalProperties:
  type: string
```

For a string to model mapping:

```yaml
type: object
additionalProperties:
  $ref: '#/components/schemas/ComplexModel'
```

##### Model with Annotated Enumeration

```yaml
oneOf:
  - const: RGB
    title: Red, Green, Blue
    description: Specify colors with the red, green, and blue additive color model
  - const: CMYK
    title: Cyan, Magenta, Yellow, Black
    description: Specify colors with the cyan, magenta, yellow, and black subtractive color model
```

##### Model with Example

```yaml
type: object
properties:
  id:
    type: integer
    format: int64
  name:
    type: string
required:
  - name
examples:
  - name: Puma
    id: 1
```

##### Models with Composition

```yaml
components:
  schemas:
    ErrorModel:
      type: object
      required:
        - message
        - code
      properties:
        message:
          type: string
        code:
          type: integer
          minimum: 100
          maximum: 600
    ExtendedErrorModel:
      allOf:
        - $ref: '#/components/schemas/ErrorModel'
        - type: object
          required:
            - rootCause
          properties:
            rootCause:
              type: string
```

##### Models with Polymorphism Support

The following example describes a `Pet` model that can represent either a cat or a dog, as distinguished by the `petType` property. Each type of pet has other properties beyond those of the base `Pet` model. An instance without a `petType` property, or with a `petType` property that does not match either `cat` or `dog`, is invalid.

```yaml
components:
  schemas:
    Pet:
      type: object
      properties:
        name:
          type: string
      required:
        - name
        - petType
      oneOf:
        - $ref: '#/components/schemas/Cat'
        - $ref: '#/components/schemas/Dog'
    Cat:
      description: A pet cat
      type: object
      properties:
        petType:
          const: 'cat'
        huntingSkill:
          type: string
          description: The measured skill for hunting
          enum:
            - clueless
            - lazy
            - adventurous
            - aggressive
      required:
        - huntingSkill
    Dog:
      description: A pet dog
      type: object
      properties:
        petType:
          const: 'dog'
        packSize:
          type: integer
          format: int32
          description: the size of the pack the dog is from
          default: 0
          minimum: 0
      required:
        - packSize
```

##### Models with Polymorphism Support and a Discriminator Object

The following example extends the example of the previous section by adding a [Discriminator Object](#discriminator-object) to the `Pet` schema. Note that the Discriminator Object is only a hint to the consumer of the API and does not change the validation outcome of the schema.

```yaml
components:
  schemas:
    Pet:
      type: object
      discriminator:
        propertyName: petType
        mapping:
          cat: '#/components/schemas/Cat'
          dog: '#/components/schemas/Dog'
      properties:
        name:
          type: string
      required:
        - name
        - petType
      oneOf:
        - $ref: '#/components/schemas/Cat'
        - $ref: '#/components/schemas/Dog'
    Cat:
      description: A pet cat
      type: object
      properties:
        petType:
          const: 'cat'
        huntingSkill:
          type: string
          description: The measured skill for hunting
          enum:
            - clueless
            - lazy
            - adventurous
            - aggressive
      required:
        - huntingSkill
    Dog:
      description: A pet dog
      type: object
      properties:
        petType:
          const: 'dog'
        packSize:
          type: integer
          format: int32
          description: the size of the pack the dog is from
          default: 0
          minimum: 0
      required:
        - petType
        - packSize
```

##### Models with Polymorphism Support using `allOf` and a Discriminator Object

It is also possible to describe polymorphic models using `allOf`. The following example uses `allOf` with a [Discriminator Object](#discriminator-object) to describe a polymorphic `Pet` model.

```yaml
components:
  schemas:
    Pet:
      type: object
      discriminator:
        propertyName: petType
      properties:
        name:
          type: string
        petType:
          type: string
      required:
        - name
        - petType
    Cat: # "Cat" will be used as the discriminating value
      description: A representation of a cat
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          properties:
            huntingSkill:
              type: string
              description: The measured skill for hunting
              enum:
                - clueless
                - lazy
                - adventurous
                - aggressive
          required:
            - huntingSkill
    Dog: # "Dog" will be used as the discriminating value
      description: A representation of a dog
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          properties:
            packSize:
              type: integer
              format: int32
              description: the size of the pack the dog is from
              default: 0
              minimum: 0
          required:
            - packSize
```

##### Generic Data Structure Model

```yaml
components:
  schemas:
    genericArrayComponent:
      $id: fully_generic_array
      type: array
      items:
        $dynamicRef: '#generic-array'
      $defs:
        allowAll:
          $dynamicAnchor: generic-array
    numberArray:
      $id: array_of_numbers
      $ref: fully_generic_array
      $defs:
        numbersOnly:
          $dynamicAnchor: generic-array
          type: number
    stringArray:
      $id: array_of_strings
      $ref: fully_generic_array
      $defs:
        stringsOnly:
          $dynamicAnchor: generic-array
          type: string
    objWithTypedArray:
      $id: obj_with_typed_array
      type: object
      required:
      - dataType
      - data
      properties:
        dataType:
          enum:
          - string
          - number
      oneOf:
      - properties:
          dataType:
            const: string
          data:
            $ref: array_of_strings
      - properties:
          dataType:
            const: number
          data:
            $ref: array_of_numbers
```

### Discriminator Object

When request bodies or response payloads may be one of a number of different schemas, these should use the JSON Schema `anyOf` or `oneOf` keywords to describe the possible schemas (see [Composition and Inheritance](#composition-and-inheritance-polymorphism)).

A polymorphic schema MAY include a Discriminator Object, which defines the name of the property that may be used as a hint for which schema of the `anyOf` or `oneOf`, or which schema that references the current schema in an `allOf`, is expected to validate the structure of the model.
This hint can be used to aid in serialization, deserialization, and validation.
The Discriminator Object does this by implicitly or explicitly associating the possible values of a named property with alternative schemas.

Note that `discriminator` MUST NOT change the validation outcome of the schema.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="property-name"></a>propertyName | `string` | **REQUIRED**. The name of the discriminating property in the payload that will hold the discriminating value. The discriminating property MAY be defined as required or optional, but when defined as optional the Discriminator Object MUST include a `defaultMapping` field that specifies which schema is expected to validate the structure of the model when the discriminating property is not present. |
| <a name="discriminator-mapping"></a> mapping | Map[`string`, `string`] | An object to hold mappings between payload values and schema names or URI references. |
| <a name="discriminator-default-mapping"></a> defaultMapping | `string` | The schema name or URI reference to a schema that is expected to validate the structure of the model when the discriminating property is not present in the payload or contains a value for which there is no explicit or implicit mapping. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Conditions for Using the Discriminator Object

The Discriminator Object is legal only when using one of the composite keywords `oneOf`, `anyOf`, `allOf`.

In both the `oneOf` and `anyOf` use cases, where those keywords are adjacent to `discriminator`, all possible schemas MUST be listed explicitly.

To avoid redundancy, the discriminator MAY be added to a parent schema definition, and all schemas building on the parent schema via an `allOf` construct may be used as an alternate schema.

The `allOf` form of `discriminator` is _only_ useful for non-validation use cases; validation with the parent schema with this form of `discriminator` _does not_ perform a search for child schemas or use them in validation in any way.
This is because `discriminator` cannot change the validation outcome, and no standard JSON Schema keyword connects the parent schema to the child schemas.

The behavior of any configuration of `oneOf`, `anyOf`, `allOf` and `discriminator` that is not described above is undefined.

#### Options for Mapping Values to Schemas

The value of the property named in `propertyName` is used as the name of the associated schema under the [Components Object](#components-object), _unless_ a `mapping` is present for that value.
The `mapping` entry maps a specific property value to either a different schema component name, or to a schema identified by a URI.
When using implicit or explicit schema component names, inline `oneOf` or `anyOf` subschemas are not considered.
The behavior of a `mapping` value or `defaultMapping` value that is both a valid schema name and a valid relative URI reference is implementation-defined, but it is RECOMMENDED that it be treated as a schema name.
To ensure that an ambiguous value (e.g. `"foo"`) is treated as a relative URI reference by all implementations, authors MUST prefix it with the `"."` path segment (e.g. `"./foo"`).

Mapping keys MUST be string values, but tooling MAY convert response values to strings for comparison.
However, the exact nature of such conversions are implementation-defined.

#### Optional Discriminating Property

When the discriminating property is defined as optional, the [Discriminator Object](#discriminator-object) MUST include a `defaultMapping` field that specifies a schema that is expected to validate the structure of the model when the discriminating property is not present in the payload or contains a value for which there is no explicit or implicit mapping. This allows the schema to still be validated correctly even if the discriminating property is missing.

The primary use case for an optional discriminating property is to allow a schema to be extended with a discriminator without breaking existing clients that do not provide the discriminating property.

When the discriminating property is defined as optional, it is important that each subschema that defines a value for the discriminating property also define the property as required, since this is no longer enforced by the parent schema.

The `defaultMapping` schema is also expected to validate the structure of the model when the discriminating property is present but contains a value for which there is no explicit or implicit mapping. This is typically expressed in the `defaultMapping` schema by excluding any instances with mapped values of the discriminating property, e.g.

```yaml
OtherPet:
  type: object
  properties:
    petType:
      not:
        enum: ['cat', 'dog']
```

This prevents the `defaultMapping` schema from validating a payload that includes the discriminating property with a mapped discriminating value, which would cause a validation to fail when polymorphism is described using the `oneOf` JSON schema keyword.

#### Examples

For these examples, assume all schemas are in the [entry document](#openapi-description-structure) of the OAD; for handling of `discriminator` in referenced documents see [Resolving Implicit Connections](#resolving-implicit-connections).

In OAS 3.x, a response payload MAY be described to be exactly one of any number of types:

```yaml
MyResponseType:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
    - $ref: '#/components/schemas/Lizard'
```

which means a valid payload has to match exactly one of the schemas described by `Cat`, `Dog`, or `Lizard`. Deserialization of a `oneOf` can be a costly operation, as it requires determining which schema matches the payload and thus should be used in deserialization. This problem also exists for `anyOf` schemas. A `discriminator` can be used as a "hint" to improve the efficiency of selection of the matching schema. The [Discriminator Object](#discriminator-object) cannot change the validation result of the `oneOf`, it can only help make the deserialization more efficient and provide better error messaging. We can specify the exact field that tells us which schema is expected to match the instance:

```yaml
MyResponseType:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
    - $ref: '#/components/schemas/Lizard'
  discriminator:
    propertyName: petType
```

The expectation now is that a property with name `petType` _MUST_ be present in the response payload, and the value will correspond to the name of a schema defined in the OpenAPI Description. Thus the response payload:

```json
{
  "id": 12345,
  "petType": "Cat"
}
```

will indicate that the `Cat` schema is expected to match this payload.

In scenarios where the value of the discriminating property does not match the schema name or implicit mapping is not possible, an optional `mapping` definition can be used:

```yaml
MyResponseType:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
    - $ref: '#/components/schemas/Lizard'
    - $ref: https://gigantic-server.com/schemas/Monster/schema.json
  discriminator:
    propertyName: petType
    mapping:
      dog: '#/components/schemas/Dog'
      monster: https://gigantic-server.com/schemas/Monster/schema.json
```

Here the discriminating value of `dog` will map to the schema `#/components/schemas/Dog`, rather than the default (implicit) value of `#/components/schemas/dog`. If the discriminating value does not match an implicit or explicit mapping, no schema can be determined and validation SHOULD fail.

When used in conjunction with the `anyOf` construct, the use of the discriminator can avoid ambiguity for serializers/deserializers where multiple schemas may satisfy a single payload.

When the discriminating property is defined as optional, the Discriminator Object has to include a `defaultMapping` field that specifies a schema of the `anyOf` or `oneOf` is expected to validate the structure of the model when the discriminating property is not present in the payload. This allows the schema to still be validated correctly even if the discriminator property is missing.

For example:

```yaml
MyResponseType:
  oneOf:
    - $ref: '#/components/schemas/Cat'
    - $ref: '#/components/schemas/Dog'
    - $ref: '#/components/schemas/Lizard'
    - $ref: '#/components/schemas/OtherPet'
  discriminator:
    propertyName: petType
    defaultMapping: OtherPet
OtherPet:
  type: object
  properties:
    petType:
      not:
        enum: ['Cat', 'Dog', 'Lizard']
```

In this example, if the `petType` property is not present in the payload, or if the value of `petType` is not "Cat", "Dog", or "Lizard", then the payload should validate against the `OtherPet` schema.

This example shows the `allOf` usage, which avoids needing to reference all child schemas in the parent:

```yaml
components:
  schemas:
    Pet:
      type: object
      required:
        - petType
      properties:
        petType:
          type: string
      discriminator:
        propertyName: petType
        mapping:
          dog: Dog
    Cat:
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          # all other properties specific to a `Cat`
          properties:
            name:
              type: string
    Dog:
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          # all other properties specific to a `Dog`
          properties:
            bark:
              type: string
    Lizard:
      allOf:
        - $ref: '#/components/schemas/Pet'
        - type: object
          # all other properties specific to a `Lizard`
          properties:
            lovesRocks:
              type: boolean
```

Validated against the `Pet` schema, a payload like this:

```json
{
  "petType": "Cat",
  "name": "Misty"
}
```

will indicate that the `#/components/schemas/Cat` schema is expected to match. Likewise this payload:

```json
{
  "petType": "dog",
  "bark": "soft"
}
```

will map to `#/components/schemas/Dog` because the `dog` entry in the `mapping` element maps to `Dog` which is the schema name for `#/components/schemas/Dog`.

---
← [index](./index.md)
