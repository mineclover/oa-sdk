<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Parameter Object

Describes a single operation parameter.

A unique parameter is defined by a combination of a [name](#parameter-name) and [location](#parameter-in).

See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns, including interactions with the `application/x-www-form-urlencoded` query string format.

#### Parameter Locations

There are five possible parameter locations specified by the `in` field:

* path - Used together with [Path Templating](#path-templating), where the parameter value is actually part of the operation's URL. This does not include the host or base path of the API. For example, in `/items/{itemId}`, the path parameter is `itemId`.
* query - Parameters that are appended to the URL. For example, in `/items?id=###`, the query parameter is `id`; MUST NOT appear in the same operation (or in the operation's path-item) as an `in: "querystring"` parameter.
* querystring - A parameter that treats the entire URL query string as a value which MUST be specified using the `content` field, most often with media type `application/x-www-form-urlencoded` using [Encoding Objects](#encoding-object) in the same way as with request bodies of that media type; MUST NOT appear more than once, and MUST NOT appear in the same operation (or in the operation's path-item) as any `in: "query"` parameters.
* header - Custom headers that are expected as part of the request. Note that [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1) states header names are case-insensitive.
* cookie - Used to pass a specific cookie value to the API.

#### Fixed Fields

The rules for serialization of the parameter are specified in one of two ways.
Parameter Objects MUST include either a `content` field or a `schema` field, but not both.
See [Appendix B](#appendix-b-data-type-conversion) for a discussion of converting values of various types to string representations.

##### Common Fixed Fields

These fields MAY be used with either `content` or `schema`.

The `example` and `examples` fields are mutually exclusive; see [Working with Examples](#working-with-examples) for guidance on validation requirements.

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="parameter-name"></a>name | `string` | **REQUIRED**. The name of the parameter. Parameter names are _case-sensitive_. <ul><li>If [`in`](#parameter-in) is `"path"`, the `name` field MUST correspond to a single template expression occurring within the [path](#paths-path) field in the [Paths Object](#paths-object). See [Path Templating](#path-templating) for further information.<li>If [`in`](#parameter-in) is `"header"` and the `name` field is `"Accept"`, `"Content-Type"` or `"Authorization"`, the parameter definition SHALL be ignored.<li>If `in` is `"querystring"`, or for [certain combinations](#style-examples) of [`style`](#parameter-style) and [`explode`](#parameter-explode), the value of `name` is not used in the parameter serialization.<li>For all other cases, the `name` corresponds to the parameter name used by the [`in`](#parameter-in) field.</ul> |
| <a name="parameter-in"></a>in | `string` | **REQUIRED**. The location of the parameter. Possible values are `"query"`, `"querystring"`, `"header"`, `"path"` or `"cookie"`. |
| <a name="parameter-description"></a>description | `string` | A brief description of the parameter. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="parameter-required"></a>required | `boolean` | Determines whether this parameter is mandatory. If the [parameter location](#parameter-in) is `"path"`, this field is **REQUIRED** and its value MUST be `true`. Otherwise, the field MAY be included and its default value is `false`. |
| <a name="parameter-deprecated"></a> deprecated | `boolean` | Specifies that a parameter is deprecated and SHOULD be transitioned out of usage. Default value is `false`. |
| <a name="parameter-allow-empty-value"></a> allowEmptyValue | `boolean` | If `true`, clients MAY pass a zero-length string value in place of parameters that would otherwise be omitted entirely, which the server SHOULD interpret as the parameter being unused. Default value is `false`. If [`style`](#parameter-style) is used, and if [behavior is _n/a_ (cannot be serialized)](#style-examples), the value of `allowEmptyValue` SHALL be ignored. Interactions between this field and the parameter's [Schema Object](#schema-object) are implementation-defined. This field is valid only for `query` parameters. <br><br>**Deprecated:** Use of this field is NOT RECOMMENDED, and it is likely to be removed in a later revision. |
| <a name="parameter-example"></a>example | Any | Example of the parameter's potential value; see [Working With Examples](#working-with-examples). |
| <a name="parameter-examples"></a>examples | Map[ `string`, [Example Object](#example-object) \| [Reference Object](#reference-object)] | Examples of the parameter's potential value; see [Working With Examples](#working-with-examples). |

This object MAY be extended with [Specification Extensions](#specification-extensions).

Note that while `"Cookie"` as a `name` is not forbidden if `in` is `"header"`, the effect of defining a cookie parameter that way is undefined; use `in: "cookie"` instead.

##### Fixed Fields for use with `schema`

For simpler scenarios, a [`schema`](#parameter-schema) and [`style`](#parameter-style) can describe the structure and syntax of the parameter.

These fields MUST NOT be used with `in: "querystring"`.

Care is needed for parameters with `schema` that have `in: "header"` or `in: "cookie", style: "cookie"`:

* When serializing these values, URI percent-encoding MUST NOT be applied.
* When parsing these parameters, any apparent percent-encoding MUST NOT be decoded.
* If using an RFC6570 implementation that automatically performs encoding or decoding steps, the steps MUST be undone before use.

In these cases, implementations MUST pass values through unchanged rather than attempting to quote or escape them, as the quoting rules for headers and escaping conventions for cookies vary too widely to be performed automatically; see [Appendix D](#appendix-d-serializing-headers-and-cookies) for guidance on quoting and escaping.

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="parameter-style"></a>style | `string` | Describes how the parameter value will be serialized depending on the type of the parameter value. Default values (based on value of `in`): for `"query"` - `"form"`; for `"path"` - `"simple"`; for `"header"` - `"simple"`; for `"cookie"` - `"form"` (for compatibility reasons; note that `style: "cookie"` SHOULD be used with `in: "cookie"`; see [Appendix D](#appendix-d-serializing-headers-and-cookies) for details). |
| <a name="parameter-explode"></a>explode | `boolean` | When this is true, parameter values of type `array` or `object` generate separate parameters for each value of the array or key-value pair of the map. For other types of parameters, or when [`style`](#parameter-style) is `"deepObject"`, this field has no effect. When `style` is `"form"` or `"cookie"`, the default value is `true`. For all other styles, the default value is `false`. |
| <a name="parameter-allow-reserved"></a>allowReserved | `boolean` | When this is true, parameter values are serialized using reserved expansion, as defined by [RFC6570](https://datatracker.ietf.org/doc/html/rfc6570#section-3.2.3), which allows [RFC3986's reserved character set](https://datatracker.ietf.org/doc/html/rfc3986#section-2.2), as well as percent-encoded triples, to pass through unchanged, while still percent-encoding all other disallowed characters (including `%` outside of percent-encoded triples). Applications are still responsible for percent-encoding reserved characters that are not allowed by the rules of the `in` destination or media type, or are [not allowed in the path by this specification](#path-templating); see [URL Percent-Encoding](#url-percent-encoding) for details. The default value is `false`. This field only applies to `in` and `style` values that automatically percent-encode. |
| <a name="parameter-schema"></a>schema | [Schema Object](#schema-object) | The schema defining the type used for the parameter. |

See also [Appendix C: Using RFC6570-Based Serialization](#appendix-c-using-rfc6570-based-serialization) for additional guidance.

##### Fixed Fields for use with `content`

For more complex scenarios, the [`content`](#parameter-content) field can define the media type and schema of the parameter, as well as give examples of its use.

For use with `in: "querystring"` and `application/x-www-form-urlencoded`, see [Encoding the `x-www-form-urlencoded` Media Type](#encoding-the-x-www-form-urlencoded-media-type).

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="parameter-content"></a>content | Map[`string`, [Media Type Object](#media-type-object) \| [Reference Object](#reference-object)] | A map containing the representations for the parameter. The key is the media type and the value describes it. The map MUST only contain one entry. |

#### Style Values

In order to support common ways of serializing simple parameters, a set of `style` values are defined. Combinations not represented in this table are not permitted.

| `style` | [`type`](#data-types) | `in` | Comments |
| ---- | ---- | ---- | ---- |
| `matrix` | primitive, `array`, `object` | `path` | Path-style parameters defined by [RFC6570](https://tools.ietf.org/html/rfc6570#section-3.2.7) |
| `label` | primitive, `array`, `object` | `path` | Label style parameters defined by [RFC6570](https://tools.ietf.org/html/rfc6570#section-3.2.5) |
| `simple` | primitive, `array`, `object` | `path`, `header` | Simple style parameters defined by [RFC6570](https://tools.ietf.org/html/rfc6570#section-3.2.2). This option replaces `collectionFormat` with a `csv` value from OpenAPI 2.0. |
| `form` | primitive, `array`, `object` | `query`, `cookie` | Form style parameters defined by [RFC6570](https://tools.ietf.org/html/rfc6570#section-3.2.8). This option replaces `collectionFormat` with a `csv` (when `explode` is false) or `multi` (when `explode` is true) value from OpenAPI 2.0. |
| `spaceDelimited` | `array`, `object` | `query` | Space separated array values or object properties and values. This option replaces `collectionFormat` equal to `ssv` from OpenAPI 2.0. |
| `pipeDelimited` | `array`, `object` | `query` | Pipe separated array values or object properties and values. This option replaces `collectionFormat` equal to `pipes` from OpenAPI 2.0. |
| `deepObject` | `object` | `query` | Allows objects with scalar properties to be represented using form parameters. The representation of array or object properties is not defined (but see [Extending Support for Querystring Formats](#extending-support-for-querystring-formats) for alternatives). |
| `cookie` | primitive, `array`, `object` | `cookie` | Analogous to `form`, but following [[RFC6265]] `Cookie` syntax rules, meaning that name-value pairs are separated by a semicolon followed by a single space (e.g. `n1=v1; n2=v2`), and no percent-encoding or other escaping is applied; data values that require any sort of escaping MUST be provided in escaped form. |

#### URL Percent-Encoding

All API URLs MUST successfully parse and percent-decode using [[RFC3986]] rules.

Content in the `application/x-www-form-urlencoded` format, including query strings produced by [Parameter Objects](#parameter-object) with `in: "query"`, MUST also successfully parse and percent-decode using [[WHATWG-URL]] rules, including treating non-percent-encoded `+` as an escaped space character.

These requirements are specified in terms of percent-_decoding_ rules, which are consistently tolerant across different versions of the various standards that apply to URIs.

Percent-_encoding_ is performed in several places:

* By [[RFC6570]] implementations (or simulations thereof; see [Appendix C](#appendix-c-using-rfc6570-based-serialization))
* By the Parameter or [Encoding](#encoding-object) Objects when incorporating a value serialized with a [Media Type Object](#media-type-object) for a media type that does not already incorporate URI percent-encoding
* By the user, prior to passing data through RFC6570's reserved expansion process

When percent-encoding, the safest approach is to percent-encode all characters not in RFC3986's "unreserved" set, and for `form-urlencoded` to also percent-encode the tilde character (`~`) to align with historical requirements that are traced back to [[?RFC1738]], the URI RFC at the time `form-urlencoded` was created.
This approach is used in examples in this specification.

For `form-urlencoded`, while the encoding algorithm given by [[WHATWG-URL]] requires escaping the space character as `+`, percent-encoding it as `%20` also meets the above requirements.
Examples in this specification will prefer `%20` when using RFC6570's default (non-reserved) form-style expansion, and `+` otherwise.

Reserved characters MUST NOT be percent-encoded when being used for reserved purposes such as `&=+` for `form-urlencoded` or `,` for delimiting non-exploded array and object values in RFC6570 expansions.
The result of inserting non-percent-encoded delimiters into data using manual percent-encoding, including via RFC6570's reserved expansion rules, is undefined and will likely prevent implementations from parsing the results back into the correct data structures.
In some cases, such as inserting `/` into path parameter values, doing so is [explicitly forbidden](#path-templating) by this specification.

See also:

* [Appendix C](#appendix-c-using-rfc6570-based-serialization) for guidance on using or simulating/extending RFC6570 implementations.
* [Appendix D](#appendix-d-serializing-headers-and-cookies) for guidance on percent-encoding and cookies, as well as other escaping approaches for headers and cookies.
* [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a thorough discussion of percent-encoding options, compatibility, and handling OAS-defined delimiters that are not allowed by RFC3986.

#### Serialization and Examples

The rules in this section apply to both the Parameter and [Header](#header-object) Objects, both of which use the same mechanisms.

When showing serialized examples, such as with the [Example Object's](#example-object) `serializedValue` or `externalValue` fields, in most cases the value to show is just the value, with all relevant percent-encoding or other encoding/escaping applied, and also including any delimiters produced by the `style` and `explode` configuration.

In cases where the name is an inherent part of constructing the serialization, such as the `name=value` pairs produced by `style: "form"` or the combination of `style: "simple", explode: true`, the name and any delimiter between the name and value MUST be included.

The `matrix` and `label` styles produce a leading delimiter which is always a valid part of the serialization and MUST be included.
The RFC6570 operators corresponding to `style: "form"` produce a leading delimiter of either `?` or `&` depending on the exact syntax used.
As the suitability of either delimiter depends on where in the query string the parameter occurs, as well as whether it is in a URI or in `application/x-www-form-urlencoded` content, this leading delimiter MUST NOT be included in examples of individual parameters or media type documents.
For `in: "cookie", style: "form"`, neither the `&` nor `?` delimiters are ever correct; see [Appendix D: Serializing Headers and Cookies](#appendix-d-serializing-headers-and-cookies) for more details.

For headers, the header name MUST NOT be included as part of the serialization, as it is never part of the RFC6570-derived result.
However, names produced by `style: "simple", explode: "true"` are included as they appear within the header value, not as separate headers.
See the [Header Object](#header-object) for special rules for showing examples of the `Set-Cookie` response header, which violates the normal rules for multiple header values.

#### Style Examples

Assume a parameter named `color` has one of the following values, where the value to the right of the `->` is what would be shown in the `dataValue` field of an Example Object:

```js
   string -> "blue"
   array -> ["blue", "black", "brown"]
   object -> { "R": 100, "G": 200, "B": 150 }
```

The following table shows serialized examples, as would be shown with the `serializedValue` field of an Example Object, of the different serializations for each value.

* The value _empty_ denotes the empty string, and is unrelated to the `allowEmptyValue` field.
* The behavior of combinations marked _n/a_ is undefined.
* The `undefined` column replaces the `empty` column in previous versions of this specification in order to better align with [RFC6570](https://www.rfc-editor.org/rfc/rfc6570.html#section-2.3) terminology, which describes certain values including but not limited to `null` as "undefined" values with special handling; notably, the empty string is _not_ undefined.
* For `form` and the non-RFC6570 query string styles `spaceDelimited`, `pipeDelimited`, and `deepObject`, see [Appendix C](#appendix-c-using-rfc6570-based-serialization) for more information on constructing query strings from multiple parameters, and [Appendix D](#appendix-d-serializing-headers-and-cookies) for warnings regarding `form` and `cookie` parameters.
* The examples are percent-encoded as explained in the [URL Percent-Encoding](#url-percent-encoding) section above; see [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a thorough discussion of percent-encoding concerns, including why unencoded `|` (`%7C`), `[` (`%5B`), and `]` (`%5D`) seem to work in some environments despite not being compliant.

| [`style`](#style-values) | `explode` | `undefined` | `string` | `array` | `object` |
| ---- | ---- | ---- | ---- | ---- | ---- |
| matrix | false | ;color | ;color=blue | ;color=blue,black,brown | ;color=R,100,G,200,B,150 |
| matrix | true | ;color | ;color=blue | ;color=blue;color=black;color=brown | ;R=100;G=200;B=150 |
| label | false | . | .blue | .blue,black,brown | .R,100,G,200,B,150 |
| label | true | . | .blue | .blue.black.brown | .R=100.G=200.B=150 |
| simple | false | _empty_ | blue | blue,black,brown | R,100,G,200,B,150 |
| simple | true | _empty_ | blue | blue,black,brown | R=100,G=200,B=150 |
| form | false | <span style="white-space: nowrap;">color=</span> | <span style="white-space: nowrap;">color=blue</span> | <span style="white-space: nowrap;">color=blue,black,brown</span> | <span style="white-space: nowrap;">color=R,100,G,200,B,150</span> |
| form | true | <span style="white-space: nowrap;">color=</span> | <span style="white-space: nowrap;">color=blue</span> | <span style="white-space: nowrap;">color=blue&color=black&color=brown</span> | <span style="white-space: nowrap;">R=100&G=200&B=150</span> |
| spaceDelimited</span> | false | _n/a_ | _n/a_ | <span style="white-space: nowrap;">color=blue%20black%20brown</span> | <span style="white-space: nowrap;">color=R%20100%20G%20200%20B%20150</span> |
| spaceDelimited | true | _n/a_ | _n/a_ | _n/a_ | _n/a_ |
| pipeDelimited | false | _n/a_ | _n/a_ | <span style="white-space: nowrap;">color=blue%7Cblack%7Cbrown</span> | <span style="white-space: nowrap;">color=R%7C100%7CG%7C200%7CB%7C150</span> |
| pipeDelimited | true | _n/a_ | _n/a_ | _n/a_ | _n/a_ |
| deepObject | _n/a_ | _n/a_ | _n/a_ | _n/a_ | <span style="white-space: nowrap;">color%5BR%5D=100&color%5BG%5D=200&color%5BB%5D=150</span> |
| cookie | false | <span style="white-space: nowrap;">color=</span> | <span style="white-space: nowrap;">color=blue</span> | <span style="white-space: nowrap;">color=blue,black,brown</span> | <span style="white-space: nowrap;">color=R,100,G,200,B,150</span> |
| cookie | true | <span style="white-space: nowrap;">color=</span> | <span style="white-space: nowrap;">color=blue</span> | <span style="white-space: nowrap;">color=blue; color=black; color=brown</span> | <span style="white-space: nowrap;">R=100; G=200; B=150</span> |

#### Extending Support for Querystring Formats

Many frameworks define query string syntax for complex values, such as appending array indices to parameter names or indicating multiple levels of of nested objects, which go well beyond the capabilities of the `deepObject` style.

As these are not standards, and often contradict each other, the OAS does not attempt to support them directly.
Two avenues are available for supporting such formats with `in: "querystring"`:

* Use `content` and `text/plain` with a schema of `type: "string"` and define the format outside of OpenAPI.  While this requires more work to document and construct or parse the format, which is seen as a plain string from the OpenAPI perspective, it provides the easiest flexible option
* Define a media type (which need not necessarily be [IANA-registered](https://www.rfc-editor.org/rfc/rfc6838.html)) and a process for mapping in-memory data to the serialized  media type.  To increase the likelihood of support across multiple tools, submit a registration for the media type and process to the OpenAPI Initiative's [Media Type Registry](#openapi-media-type-registry).

#### Parameter Object Examples

A header parameter with an array of 64-bit integer numbers:

```yaml
name: X-Token
in: header
description: token to be passed as a header
required: true
schema:
  type: array
  items:
    type: integer
    format: int64
style: simple
examples:
  Tokens:
    dataValue:
      - 12345678
      - 90099
    serializedValue: "12345678,90099"
```


A cookie parameter with an exploded object (the default for `style: "cookie"`):

```yaml
name: cookie
in: cookie
style: cookie
schema:
  type: object
  properties:
    greeting:
      type: string
    code:
      type: integer
      minimum: 0
examples:
  Object:
    description: |
        Note that the comma (,) has been pre-percent-encoded
        to "%2C" in the data, as it is forbidden in
        cookie values.  However, the exclamation point (!)
        is legal in cookies, so it can be left unencoded.
    dataValue:
      greeting: Hello%2C world!
      code: 42
    serializedValue: "greeting=Hello%2C world!; code=42"
```

A cookie parameter relying on the percent-encoding behavior of the default `style: "form"`:

```yaml
name: greeting
in: cookie
schema:
  type: string
examples:
  Greeting:
    description: |
      Note that in this approach, RFC6570's percent-encoding
      process applies, so unsafe characters are not
      pre-percent-encoded.  This results in all non-URL-safe
      characters, rather than just the one non-cookie-safe
      character, getting percent-encoded.
    dataValue: Hello, world!
    serializedValue: "greeting=Hello%2C%20world%21"
```

A path parameter of a string value:

```yaml
name: username
in: path
description: username to fetch
required: true
schema:
  type: string
examples:
  "Edsger Dijkstra":
    dataValue: edijkstra
    serializedValue: edijkstra
  Diṅnāga:
    dataValue: diṅnāga
    serializedValue: di%E1%B9%85n%C4%81ga
  Al-Khwarizmi:
    dataValue: "الخوارزميّ"
    serializedValue: "%D8%A7%D9%84%D8%AE%D9%88%D8%A7%D8%B1%D8%B2%D9%85%D9%8A%D9%91"
```

An optional query parameter of a string value, allowing multiple values by repeating the query parameter
(Note that we use `"%20"` in place of `" "` (space) because that is how RFC6570 handles it; for guidance on using `+` to represent the space character, see [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for more guidance on these escaping options):

```yaml
name: thing
in: query
required: false
schema:
  type: array
  items:
    type: string
style: form
explode: true
examples:
  ObjectList:
    dataValue:
      - one thing
      - another thing
    serializedValue: "thing=one%20thing&thing=another%20thing"
```

A free-form query parameter, allowing arbitrary parameters of `type: "integer"`:

```yaml
in: query
name: freeForm
schema:
  type: object
  additionalProperties:
    type: integer
style: form
examples:
  Pagination:
    dataValue:
      page: 4
      pageSize: 50
    serializeValue: page=4&pageSize=50
```

A complex parameter using `content` to define serialization, with multiple levels and types of examples shown to make the example usage options clear — note that `dataValue` is the same at both levels and does not need to be shown in both places in normal usage, but `serializedValue` is different:

```yaml
in: query
name: coordinates
content:
  application/json:
    schema:
      type: object
      required:
        - lat
        - long
      properties:
        lat:
          type: number
        long:
          type: number
    examples:
      dataValue:
        lat: 10
        long: 60
      serializedValue: '{"lat":10,"long":60}'
examples:
  dataValue:
    lat: 10
    long: 60
  serializedValue: coordinates=%7B%22lat%22%3A10%2C%22long%22%3A60%7D
```

A querystring parameter using regular form encoding, but managed with a Media Type Object.
This shows spaces being handled per the `application/x-www-form-urlencoded` media type rules (encode as `+`) rather than the RFC6570 process (encode as `%20`); see [Appendix E](./appendices/e-percent-encoding.md) for further guidance on this distinction.
Examples are shown at both the media type and parameter level to emphasize that, since `application/x-www-form-urlencoded` is suitable for use in query strings by definition, no further encoding or escaping is applied to the serialized media type value:

```yaml
in: querystring
content:
  application/x-www-form-urlencoded:
    schema:
      type: object
      properties:
        foo:
          type: string
        bar:
          type: boolean
    examples:
      spacesAndPluses:
        description: Note handling of spaces and "+" per media type.
        dataValue:
          foo: a + b
          bar: true
        serializedValue: foo=a+%2B+b&bar=true
examples:
  spacesAndPluses:
    description: |
      Note that no additional percent encoding is done, as this
      media type is URI query string-ready by definition.
    dataValue:
      foo: a + b
      bar: true
    serializedValue: foo=a+%2B+b&bar=true
```

A querystring parameter that uses JSON for the entire string (not as a single query parameter value).
The `dataValue` field is shown at both levels to fully illustrate both ways of providing an example.
As seen below, this is redundant and need not be done in practice:

```yaml
in: querystring
name: json
content:
  application/json:
    schema:
      type: object
      properties:
        numbers:
          type: array
          items:
            type: integer
        flag:
          type: [boolean, "null"]
    examples:
      TwoNoFlag:
        description: Serialize with minimized whitespace
        dataValue:
          numbers:
            - 1
            - 2
          flag: null
        serializedValue: '{"numbers":[1,2],"flag":null}'
examples:
  TwoNoFlag:
    dataValue:
      numbers:
        - 1
        - 2
      flag: null
    serializedValue: "%7B%22numbers%22%3A%5B1%2C2%5D%2C%22flag%22%3Anull%7D"
```

Assuming a path of `/foo`, a server of `https://example.com`, the full URL incorporating the value from `serializedValue` would be:

```uri
https://example.com/foo?%7B%22numbers%22%3A%5B1%2C2%5D%2C%22flag%22%3Anull%7D
```

A querystring parameter that uses [[?RFC9535|JSONPath]].
Note that in this example we not only do not repeat `dataValue`, but we use the shorthand `example` because the `application/jsonpath` value is a string that, at the media type level, is serialized as-is:

```yaml
in: querystring
name: selector
content:
  application/jsonpath:
    schema:
      type: string
    example: $.a.b[1:1]
examples:
  Selector:
    serializedValue: "%24.a.b%5B1%3A1%5D"
```

As there is not, as of this writing, a [registered](#openapi-media-type-registry) mapping between the JSON Schema data model and JSONPath, the details of the string's allowed structure would need to be conveyed either in a human-readable `description` field, or through a mechanism outside of the OpenAPI Description, such as a JSON Schema for the data structure to be queried.

Assuming a path of `/foo` and a server of `https://example.com`, the full URL incorporating the value from `serializedValue` would be:

```uri
https://example.com/foo?%24.a.b%5B1%3A1%5D
```

---
← [index](./index.md)
