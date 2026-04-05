<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix B: Data Type Conversion

Serializing typed data to plain text, which can occur in `text/plain` message bodies or `multipart` parts, as well as in the `application/x-www-form-urlencoded` format in either URL query strings or message bodies, involves significant implementation- or application-defined behavior.

[Schema Objects](#schema-object) validate data based on the [JSON Schema data model](https://www.ietf.org/archive/id/draft-bhutton-json-schema-01.html#section-4.2.1), which only recognizes four primitive data types: strings (which are [only broadly interoperable as UTF-8](https://datatracker.ietf.org/doc/html/rfc7159#section-8.1)), numbers, booleans, and `null`.
Notably, integers are not a distinct type from other numbers, with `type: "integer"` being a convenience defined mathematically, rather than based on the presence or absence of a decimal point in any string representation.

The [Parameter Object](#parameter-object), [Header Object](#header-object), and [Encoding Object](#encoding-object) offer features to control how to arrange values from array or object types.
They can also be used to control how strings are further encoded to avoid reserved or illegal characters.
However, there is no general-purpose specification for converting schema-validated non-UTF-8 primitive data types (or entire arrays or objects) to strings.

Two cases do offer standards-based guidance:

* [RFC3987](https://datatracker.ietf.org/doc/html/rfc3987#section-3.1) provides guidance for converting non-Unicode strings to UTF-8, particularly in the context of URIs (and by extension, the form media types which use the same encoding rules)
* [RFC6570](https://www.rfc-editor.org/rfc/rfc6570#section-2.3) specifies which values, including but not limited to `null`, are considered _undefined_ and therefore treated specially in the expansion process when serializing based on that specification

Implementations of RFC6570 often have their own conventions for converting non-string values, but these are implementation-specific and not defined by the RFC itself.
This is one reason for the OpenAPI Specification to leave these conversions as implementation-defined: It allows using RFC6570 implementations regardless of how they choose to perform the conversions.

To control the serialization of numbers, booleans, and `null` (or other values RFC6570 deems to be undefined) more precisely, schemas can be defined as `type: "string"` and constrained using `pattern`, `enum`, `format`, and other keywords to communicate how applications must pre-convert their data prior to schema validation.
The resulting strings would not require any further type conversion.

The `format` keyword can assist in serialization.
Some formats (such as `date-time`) are unambiguous, while others (such as [`decimal`](https://spec.openapis.org/registry/format/decimal.html) in the [Format Registry](https://spec.openapis.org/registry/format/)) are less clear.
However, care must be taken with `format` to ensure that the specific formats are supported by all relevant tools as unrecognized formats are ignored.

Requiring input as pre-formatted, schema-validated strings also improves round-trip interoperability as not all programming languages and environments support the same data types.

---
← [index](./index.md)
