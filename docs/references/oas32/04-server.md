<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Server Object

An object representing a Server.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="server-url"></a>url | `string` | **REQUIRED**. A URL to the target host. This URL supports Server Variables and MAY be relative, to indicate that the host location is relative to the location where the document containing the Server Object is being served. Query and fragment MUST NOT be part of this URL. Variable substitutions will be made when a variable is named in `{`braces`}`. |
| <a name="server-description"></a>description | `string` | An optional string describing the host designated by the URL. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="server-name"></a>name | `string` | An optional unique string to refer to the host designated by the URL. |
| <a name="server-variables"></a>variables | Map[`string`, [Server Variable Object](#server-variable-object)] | A map between a variable name and its value. The value is used for substitution in the server's URL template. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Relative References in API URLs

API endpoints are by definition accessed as locations, and are described by this specification as **_URLs_**.

Unless specified otherwise, all fields that are URLs MAY be relative references as defined by [RFC3986](https://tools.ietf.org/html/rfc3986#section-4.2).

Because the API is a distinct entity from the OpenAPI document, RFC3986's base URI rules for the OpenAPI document do not apply.
Unless specified otherwise, relative references are resolved using the URLs defined in the [Server Object](#server-object) as a base URL. Note that these themselves MAY be relative to the referring document.

##### Examples of API Base URL Determination

Assume a retrieval URI of `https://device1.example.com` for the following OpenAPI document:

```yaml
openapi: 3.2.0
$self: https://apidescriptions.example.com/foo
info:
  title: Example API
  version: 1.0
servers:
- url: .
  description: The production API on this device
- url: ./test
  description: The test API on this device
```

For API URLs the `$self` field, which identifies the OpenAPI document, is ignored and the retrieval URI is used instead. This produces a normalized production URL of `https://device1.example.com`, and a normalized test URL of `https://device1.example.com/test`.

#### Server Object Example

A single server would be described as:

```yaml
url: https://development.gigantic-server.com/v1
description: Development server
name: dev
```

The following shows how multiple servers can be described, for example, at the OpenAPI Object's [`servers`](#oas-servers):

```yaml
servers:
  - url: https://development.gigantic-server.com/v1
    description: Development server
    name: dev
  - url: https://staging.gigantic-server.com/v1
    description: Staging server
    name: staging
  - url: https://api.gigantic-server.com/v1
    description: Production server
    name: prod
```

The following shows how variables can be used for a server configuration:

```yaml
servers:
  - url: https://{username}.gigantic-server.com:{port}/{basePath}
    description: The production API server
    name: prod
    variables:
      username:
        # note! no enum here means it is an open value
        default: demo
        description: A user-specific subdomain. Use `demo` for a free sandbox environment.
      port:
        enum:
          - '8443'
          - '443'
        default: '8443'
      basePath:
        # open meaning there is the opportunity to use special base paths as assigned by the provider, default is "v2"
        default: v2
```

### Server Variable Object

An object representing a Server Variable for server URL template substitution.

The server URL templating is defined by the following [ABNF](https://tools.ietf.org/html/rfc5234) syntax.

```abnf
server-url-template  = 1*( literals / server-variable )
server-variable      = "{" server-variable-name "}"
server-variable-name = 1*( %x00-7A / %x7C / %x7E-10FFFF ) ; every Unicode character except { and }

literals       = 1*( %x21 / %x23-24 / %x26-3B / %x3D / %x3F-5B
               / %x5D / %x5F / %x61-7A / %x7E / ucschar / iprivate
               / pct-encoded)
                    ; any Unicode character except: CTL, SP,
                    ;  DQUOTE, "%" (aside from pct-encoded),
                    ;  "<", ">", "\", "^", "`", "{", "|", "}"
pct-encoded    =  "%" HEXDIG HEXDIG
ucschar        =  %xA0-D7FF / %xF900-FDCF / %xFDF0-FFEF
               /  %x10000-1FFFD / %x20000-2FFFD / %x30000-3FFFD
               /  %x40000-4FFFD / %x50000-5FFFD / %x60000-6FFFD
               /  %x70000-7FFFD / %x80000-8FFFD / %x90000-9FFFD
               /  %xA0000-AFFFD / %xB0000-BFFFD / %xC0000-CFFFD
               /  %xD0000-DFFFD / %xE1000-EFFFD
iprivate       =  %xE000-F8FF / %xF0000-FFFFD / %x100000-10FFFD
```

Here, `literals`, `pct-encoded`, `ucschar` and `iprivate` definitions are taken from [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570), incorporating the corrections specified in [Errata 6937](https://www.rfc-editor.org/errata/eid6937) for `literals`.

Each server variable MUST NOT appear more than once in the URL template.

See the [Paths Object](#paths-object) for guidance on constructing full request URLs.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="server-variable-enum"></a>enum | [`string`] | An enumeration of string values to be used if the substitution options are from a limited set. The array MUST NOT be empty. |
| <a name="server-variable-default"></a>default | `string` | **REQUIRED**. The default value to use for substitution, which SHALL be sent if an alternate value is _not_ supplied. If the [`enum`](#server-variable-enum) is defined, the value MUST exist in the enum's values. Note that this behavior is different from the [Schema Object](#schema-object)'s `default` keyword, which documents the receiver's behavior rather than inserting the value into the data. |
| <a name="server-variable-description"></a>description | `string` | An optional description for the server variable. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

---
← [index](./index.md)
