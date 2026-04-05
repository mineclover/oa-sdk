<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

## Appendix D: Serializing Headers and Cookies

HTTP headers have inconsistent rules regarding what characters are allowed, and how some or all disallowed characters can be escaped and included.
While the `quoted-string` ABNF rule given in [[RFC9110]] [Section 5.4.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4) is the most common escaping solution, it is not sufficiently universal to apply automatically.
For example, a strong `ETag` looks like `"foo"` (with quotes, regardless of the contents), and a weak `ETag` looks like `W/"foo"` (note that only part of the value is quoted); the contents of the quotes for this header are also not escaped in the way `quoted-string` contents are.

For this reason, any data being passed to a header by way of a [Parameter](#parameter-object) or [Header](#header-object) Object needs to be quoted and escaped prior to passing it to the OAS implementation, and the parsed header values are expected to contain the quotes and escapes.

### Percent-Encoding and Cookies

[RFC6570](https://www.rfc-editor.org/rfc/rfc6570)'s percent-encoding behavior is not always appropriate for `in: "cookie"` parameters.
While percent-encoding seems more common as an escaping mechanism than the base64 encoding (`contentEncoding`: "base64") recommended by [[RFC6265]], [section 5.6 of draft-ietf-httpbis-rfc6265bis-20](https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-20.html#section-5.6), the proposed update to that RFC notes that cookies sent in the `Set-Cookie` response header that appear to be percent-encoded MUST NOT be decoded when stored by the client, which would mean that they are already encoded when retrieved from that storage for use in the `Cookie` request header.
The behavior of `style: "cookie"` assumes this usage, and _does not_ apply or remove percent-encoding.

If automatic percent-encoding is desired, `style: "form"` with a primitive value or with the non-default `explode` value of `false` provides this behavior.
However, note that the default value of `explode: true` for `style: "form"` with non-primitive values uses the wrong delimiter for cookies (`&` instead of `;` followed by a single space) to set multiple cookie values.
Using `style: "form"` with `in: "cookie"` via an RFC6570 implementation requires stripping the `?` prefix, as when producing `application/x-www-form-urlencoded` message bodies.
To allow the full use of `style: "form"` with `in: "cookie"`, use the `allowReserved` field.

---
← [index](./index.md)
