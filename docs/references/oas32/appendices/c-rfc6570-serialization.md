<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix C: Using RFC6570-Based Serialization

Serialization is defined in terms of [RFC6570](https://www.rfc-editor.org/rfc/rfc6570) URI Templates in three scenarios:

| Object | Condition |
| ---- | ---- |
| [Parameter Object](#parameter-object) | When `schema` is present |
| [Header Object](#header-object) | When `schema` is present |
| [Encoding Object](#encoding-object) | When encoding for `application/x-www-form-urlencoded` and any of `style`, `explode`, or `allowReserved` are used |

Implementations of this specification MAY use an implementation of RFC6570 to perform variable expansion, however, some caveats apply.

Note that when using `style: "form"` RFC6570 expansion to produce an `application/x-www-form-urlencoded` HTTP message body, it is necessary to remove the `?` prefix that is produced to satisfy the URI query string syntax.

When using `style` and similar keywords to produce a `multipart/form-data` body, the query string names are placed in the `name` parameter of the `Content-Disposition` part header, and the values are placed in the corresponding part body; the `?`, `=`, and `&` characters are not used, and URI percent encoding is not applied, regardless of the value of `allowReserved`.
Note that while [RFC7578](https://datatracker.ietf.org/doc/html/rfc7578) allows using [[RFC3986]] percent-encoding in "file names", it does not otherwise address the use of percent-encoding within the format.
Users are expected to provide names and data with any escaping necessary for conformance with RFC7578 already applied.

Note also that not all RFC6570 implementations support all four levels of operators, all of which are needed to fully support the OpenAPI Specification's usage.
Using an implementation with a lower level of support will require additional manual construction of URI Templates to work around the limitations.

### Equivalences Between Fields and RFC6570 Operators

Certain field values translate to RFC6570 [operators](https://datatracker.ietf.org/doc/html/rfc6570#section-2.2) (or lack thereof):

| field | value | equivalent |
| ---- | ---- | ---- |
| style | `"simple"` | _n/a_ |
| style | `"matrix"` | `;` prefix operator |
| style | `"label"` | `.` prefix operator |
| style | `"form"` | `?` prefix operator |
| allowReserved | `false` | _n/a_ |
| allowReserved | `true` | `+` prefix operator |
| explode | `false` | _n/a_ |
| explode | `true` | `*` modifier suffix |

Multiple `style: "form"` parameters are equivalent to a single RFC6570 [variable list](https://www.rfc-editor.org/rfc/rfc6570#section-2.2) using the `?` prefix operator:

```yaml
parameters:
- name: foo
  in: query
  schema:
    type: object
  explode: true
- name: bar
  in: query
  schema:
    type: string
```

This example is equivalent to RFC6570's `{?foo*,bar}`, and **NOT** `{?foo*}{&bar}`. The latter is problematic because if `foo` is not defined, the result will be an invalid URI.
The `&` prefix operator has no equivalent in the Parameter Object.

Note that RFC6570 does not specify behavior for compound values beyond the single level addressed by `explode`. The result of using objects or arrays where no behavior is clearly specified for them is implementation-defined.

### Delimiters in Parameter Values

Delimiters used by RFC6570 expansion, such as the `,` used to join arrays or object values with `style: "simple"`, are all automatically percent-encoded as long as `allowReserved` is `false`.
Note that since RFC6570 does not define a way to parse variables based on a URI Template, users must take care to first split values by delimiter before percent-decoding values that might contain the delimiter character.

When `allowReserved` is `true`, both percent-encoding (prior to joining values with a delimiter) and percent-decoding (after splitting on the delimiter) must be done manually at the correct time.

See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for additional guidance on handling delimiters for `style` values with no RFC6570 equivalent that already need to be percent-encoded when used as delimiters.

### Non-RFC6570 Field Values and Combinations

Configurations with no direct [RFC6570](https://datatracker.ietf.org/doc/html/rfc6570) equivalent SHOULD also be handled according to RFC6570.
Implementations MAY create a properly delimited URI Template with variables for individual names and values using RFC6570 regular or reserved expansion (based on `allowReserved`).

This includes:

* the styles `pipeDelimited`, `spaceDelimited`, and `deepObject`, which have no equivalents at all
* the combination of the style `form` with `allowReserved: true`, which is not allowed because only one prefix operator can be used at a time
* any parameter name that is not a legal RFC6570 variable name

The Parameter Object's `name` field has a much more permissive syntax than RFC6570 [variable name syntax](https://www.rfc-editor.org/rfc/rfc6570#section-2.3).
A parameter name that includes characters outside of the allowed RFC6570 variable character set MUST be percent-encoded before it can be used in a URI Template.

### Examples

Let's say we want to use the following data in a form query string, where `formulas` is exploded, and `words` is not:

```yaml
formulas:
  a: x+y
  b: x/y
  c: x^y
words:
- math
- is
- fun
```

#### RFC6570-Equivalent Expansion

This array of Parameter Objects uses regular `style: "form"` expansion, fully supported by [RFC6570](https://datatracker.ietf.org/doc/html/rfc6570):

```yaml
parameters:
- name: formulas
  in: query
  schema:
    type: object
    additionalProperties:
      type: string
  explode: true
- name: words
  in: query
  schema:
    type: array
    items:
      type: string
```

This translates to the following URI Template:

```uritemplate
{?formulas*,words}
```

when expanded with the data given earlier, we get:

```uri
?a=x%2By&b=x%2Fy&c=x%5Ey&words=math,is,fun
```

#### Expansion with Non-RFC6570-Supported Options

But now let's say that (for some reason), we really want that `/` in the `b` formula to show up as-is in the query string, and we want our words to be space-separated like in a written phrase.
To do that, we'll add `allowReserved: true` to `formulas`, and change to `style: "spaceDelimited"` for `words`:

```yaml
parameters:
- name: formulas
  in: query
  schema:
    type: object
    additionalProperties:
      type: string
  explode: true
  allowReserved: true
- name: words
  in: query
  style: spaceDelimited
  explode: false
  schema:
    type: array
    items:
      type: string
```

We can't combine the `?` and `+` RFC6570 [prefixes](https://datatracker.ietf.org/doc/html/rfc6570#section-2.4.1), and there's no way with RFC6570 to replace the `,` separator with a space character.
So we need to restructure the data to fit a manually constructed URI Template that passes all of the pieces through the right sort of expansion.

Here is one such template, using a made-up convention of `words.0` for the first entry in the words value, `words.1` for the second, and `words.2` for the third:

```uritemplate
?a={+a}&b={+b}&c={+c}&words={words.0} {words.1} {words.2}
```

RFC6570 [mentions](https://www.rfc-editor.org/rfc/rfc6570.html#section-2.4.2) the use of `.` "to indicate name hierarchy in substructures," but does not define any specific naming convention or behavior for it.
Since the `.` usage is not automatic, we'll need to construct an appropriate input structure for this new template.

We'll also need to pre-process the values for `formulas` because while `/` and most other reserved characters are allowed in the query string by RFC3986, `[`, `]`, and `#` [are not](https://datatracker.ietf.org/doc/html/rfc3986#appendix-A), and `&`, `=`, and `+` all have [special behavior](https://url.spec.whatwg.org/#application/x-www-form-urlencoded) in the `application/x-www-form-urlencoded` format, which is what we are using in the query string.

Setting `allowReserved: true` does _not_ make reserved characters that are not allowed in URIs allowed, it just allows them to be _passed through expansion unchanged_, for example because some other specification has defined a particular meaning for them.

Therefore, users still need to percent-encode any reserved characters that are _not_ being passed through due to a special meaning because reserved expansion does not know which reserved characters are being used, and which should still be percent-encoded.
However, reserved expansion, unlike regular expansion,  _will_ leave the pre-percent-encoded triples unchanged.
See also [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for further guidance on percent-encoding and form media types, including guidance on handling the delimiter characters for `spaceDelimited`, `pipeDelimited`, and `deepObject` in parameter names and values.

So here is our data structure that arranges the names and values to suit the template above, where values for `formulas` have `[]#&=+` pre-percent encoded (although only `+` appears in this example):

```yaml
a: x%2By
b: x/y
c: x^y
words.0: math
words.1: is
words.2: fun
```

Expanding our manually assembled template with our restructured data yields the following query string:

```uri
?a=x%2By&b=x/y&c=x%5Ey&words=math%20is%20fun
```

The `/` and the pre-percent-encoded `%2B` have been left alone, but the disallowed `^` character (inside a value) and space characters (in the template but outside of the expanded variables) were percent-encoded.

#### Undefined Values and Manual URI Template Construction

Care must be taken when manually constructing templates to handle the values that RFC6570 [considers to be _undefined_](https://datatracker.ietf.org/doc/html/rfc6570#section-2.3) correctly:

```yaml
formulas: {}
words:
- hello
- world
```

Using this data with our original RFC6570-friendly URI Template, `{?formulas*,words}`, produces the following:

```uri
?words=hello,world
```

This means that the manually constructed URI Template and restructured data need to leave out the `formulas` object entirely so that the `words` parameter is the first and only parameter in the query string.

Restructured data:

```yaml
words.0: hello
words.1: world
```

Manually constructed URI Template:

```uritemplate
?words={words.0} {words.1}
```

Result:

```uri
?words=hello%20world
```

#### Illegal Variable Names as Parameter Names

In this example, the heart emoji is not legal in URI Template names (or URIs):

```yaml
parameters:
- name: ❤️
  in: query
  schema:
    type: string
```

We can't just pass `❤️: "love!"` to an RFC6570 implementation.
Instead, we have to pre-percent-encode the name (which is a six-octet UTF-8 sequence) in both the data and the URI Template:

```yaml
"%E2%9D%A4%EF%B8%8F": love!
```

```uritemplate
{?%E2%9D%A4%EF%B8%8F}
```

This will expand to the result:

```uri
?%E2%9D%A4%EF%B8%8F=love%21
```

---
← [index](../index.md)
