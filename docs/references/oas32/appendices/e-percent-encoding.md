<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix E: Percent-Encoding and Form Media Types

_**NOTE:** In this section, the `application/x-www-form-urlencoded` and `multipart/form-data` media types are abbreviated as `form-urlencoded` and `form-data`, respectively, for readability._

Percent-encoding is used in URIs and media types that derive their syntax from URIs.
The fundamental rules of percent-encoding are:

* The set of characters that MUST be encoded varies depending on which version of which specification you use, and (for URIs) in which part of the URI the character appears.
* The way an unencoded `+` character is decoded depends on whether you are using `application/x-www-form-urlencoded` rules or more general URI rules; this is the only time where choice of decoding algorithm can change the outcome.
* Encoding more characters than necessary is always safe in terms of the decoding process, but may produce non-normalized URIs.
* In practice, some systems tolerate or even expect unencoded characters that some or all percent-encoding specifications require to be encoded; this can cause interoperability issues with more strictly compliant implementations.

The rest of this appendix provides more detailed guidance based on the above rules.

### Percent-Encoding Character Classes

This process is concerned with three classes of characters, the names of which vary among specifications but are defined as follows for the purposes of this section:

* _unreserved_ characters do not need to be percent-encoded; while it is safe to percent-encode them, doing so produces a URI that is [not normalized](https://datatracker.ietf.org/doc/html/rfc3986#section-6.2.2.2)
* _reserved_ characters either have special behavior in the URI syntax (such as delimiting components) or are reserved for other specifications that need to define special behavior (e.g. `form-urlencoded` defines special behavior for `=`, `&`, and `+`)
* _unsafe_ characters are known to cause problems when parsing URIs in certain environments

Unless otherwise specified, this section uses RFC3986's definition of [reserved](https://datatracker.ietf.org/doc/html/rfc3986#section-2.2) and [unreserved](https://datatracker.ietf.org/doc/html/rfc3986#section-2.3), and defines the unsafe set as all characters not included in either of those sets.

### Percent-Encoding and `form-urlencoded`

Each URI component (such as the query string) considers some of the reserved characters to be unsafe, either because they serve as delimiters between the components (e.g. `#`), or (in the case of `[` and `]`) were historically considered globally unsafe but were later given reserved status for limited purposes.

Reserved characters with no special meaning defined within a component can be left un-percent encoded.
However, other specifications can define special meanings, requiring percent-encoding for those characters outside of the additional special meanings.

The `form-urlencoded` media type defines special meanings for `=` and `&` as delimiters, and `+` as the replacement for the space character (instead of its percent-encoded form of `%20`).
This means that while these three characters are reserved-but-allowed in query strings by RFC3986, they must be percent-encoded in `form-urlencoded` query strings except when used for their `form-urlencoded` purposes; see [Appendix C](#appendix-c-using-rfc6570-based-serialization) for an example of handling `+` in form values.

### Percent-Encoding and `form-data`

[RFC7578](https://datatracker.ietf.org/doc/html/rfc7578#section-2) suggests RFC3986-based percent-encoding as a mechanism to keep text-based per-part header data such as file names within the ASCII character set.
This suggestion was not part of older (pre-2015) specifications for `form-data`, so care must be taken to ensure interoperability.
Users wishing to use percent-encoding in this way MUST provide the data in percent-encoded form, as percent-encoding is not automatically applied for this media type regardless of which Encoding Object fields are used.

The `form-data` media type allows arbitrary text or binary data in its parts, so percent-encoding or similar escaping is not needed in general.

### Generating and Validating URIs and `form-urlencoded` Strings

URI percent encoding and the `form-urlencoded` media type have complex specification histories spanning multiple revisions and, in some cases, conflicting claims of ownership by different standards bodies.
Unfortunately, these specifications each define slightly different percent-encoding rules, which need to be taken into account if the URIs or `form-urlencoded` message bodies will be subject to strict validation.
(Note that many URI parsers do not perform validation by default, if at all.)

This specification normatively cites the following relevant standards:

| Specification | Date | OAS Usage | Percent-Encoding | Notes |
| ---- | ---- | ---- | ---- | ---- |
| [RFC3986](https://www.rfc-editor.org/rfc/rfc3986) | 01/2005 | URI/URL syntax, including non-`form-urlencoded` content-based serialization | [[RFC3986]] | obsoletes [[?RFC1738]], [[?RFC2396]] |
| [RFC6570](https://www.rfc-editor.org/rfc/rfc6570) | 03/2012 | style-based serialization | [[RFC3986]] | does not use `+` for query strings |
| [WHATWG-URL Section 5](https://url.spec.whatwg.org/#application/x-www-form-urlencoded) | "living" standard | content-based `form/url-encoded` serialization, including HTTP message contents | [WHATWG-URL Section 1.3](https://url.spec.whatwg.org/#application-x-www-form-urlencoded-percent-encode-set) | obsoletes [[?RFC1866]], [[?HTML401]] |

Style-based serialization with percent-encoding is used in the [Parameter Object](#parameter-object) when `schema` is present, and in the [Encoding Object](#encoding-object) when at least one of `style`, `explode`, or `allowReserved` is present.
See [Appendix C](#appendix-c-using-rfc6570-based-serialization) for more details of RFC6570's two different approaches to percent-encoding, including an example involving `+`.

Content-based serialization is defined by the [Media Type Object](#media-type-object), and used with the [Parameter Object](#parameter-object) and [Header Object](#header-object) when the `content` field is present, and with the [Encoding Object](#encoding-object) based on the `contentType` field when the fields `style`, `explode`, and `allowReserved` are absent.
For use in URIs, each part is encoded based on the media type (e.g. `text/plain` or `application/json`), and must then be percent-encoded for use in a `form-urlencoded` string (in form-style query strings), or for general URI use in other URL components, unless the media type already incorporates URI percent-encoding.

#### Interoperability with Historical Specifications

Prior versions of this specification required [[?RFC1866]] and its use of [[?RFC1738]] percent-encoding rules in place of [[WHATWG-URL]].
The [[WHATWG-URL]] `form-urlencoded` rules represent the current browser consensus on that media type, and avoid the ambiguity introduced by unclear paraphrasing of RFC1738 in RFC1866.

Users needing conformance with RFC1866/RFC1738 are advised to check their tooling and library behavior carefully.

#### Interoperability with Web Browser Environments

WHATWG is a [web browser-oriented](https://whatwg.org/faq#what-is-the-whatwg-working-on) standards group that has defined a "URL Living Standard" for parsing and serializing URLs in a browser context, including parsing and serializing `form-urlencoded` data.
WHATWG's percent-encoding rules for query strings are different depending on whether the query string is [being treated as `form-urlencoded`](https://url.spec.whatwg.org/#application-x-www-form-urlencoded-percent-encode-set) (where it requires more percent-encoding than [[?RFC1738]]) or [as part of the generic syntax](https://url.spec.whatwg.org/#query-percent-encode-set), where its requirements differ from [[RFC3986]].

This specification only depends on WHATWG for its `form-urlencoded` specification.
Implementations using the query string in other ways are advised that, the distinctions between WHATWG's non-`form-urlencoded` query string rules and RFC3986 require careful consideration, incorporating both WHATWG's percent-encoding sets and their set of valid Unicode code points for URLs; see [Percent-Encoding and Illegal or Reserved Delimiters](#percent-encoding-and-illegal-or-reserved-delimiters) for more information.

### Decoding URIs and `form-urlencoded` Strings

The percent-decoding algorithm does not care which characters were or were not percent-decoded, which means that URIs percent-encoded according to any specification will be decoded correctly.

Similarly, all `form-urlencoded` decoding algorithms simply add `+`-for-space handling to the percent-decoding algorithm, and will work regardless of the encoding specification used.

However, care must be taken to use `form-urlencoded` decoding if `+` represents a space, and to use regular percent-decoding if `+` represents itself as a literal value.

### Percent-Encoding and Illegal or Reserved Delimiters

The `[`, `]`, `|`, and space characters, which are used as delimiters for the `deepObject`, `pipeDelimited`, and `spaceDelimited` styles, respectively, all MUST be percent-encoded to comply with [[RFC3986]].
This requires users to pre-encode the character(s) in some other way in parameter names and values to distinguish them from the delimiter usage when using one of these styles.

The space character is always illegal and encoded in some way by all implementations of all versions of the relevant standards.
While one could use the `form-urlencoded` convention of `+` to distinguish spaces in parameter names and values from `spaceDelimited` delimiters encoded as `%20`, the specifications define the decoding as a single pass, making it impossible to distinguish the different usages in the decoded result unless a non-standard parsing algorithm is used that separates based on one delimiter before decoding the other.
Any such non-standard parsing approach will not be interoperable across all tools.

Some environments use `[`, `]`, and possibly `|` unencoded in query strings without apparent difficulties.
WHATWG's generic query string rules do not require percent-encoding them in non-`form-urlencoded` query strings, although it also excludes them from the set of valid URL Unicode code points.
Code that relies on leaving these delimiters unencoded, while using regular percent-encoding for them within names and values, is not guaranteed to be interoperable across all implementations.

For maximum interoperability, it is RECOMMENDED to either define and document an additional escape convention while percent-encoding the delimiters for these styles, or to avoid these styles entirely.
The exact method of additional encoding/escaping is left to the API designer, and is expected to be performed before serialization and encoding described in this specification, and reversed after this specification's encoding and serialization steps are reversed.
This keeps it outside of the processes governed by this specification.

---
← [index](./index.md)
