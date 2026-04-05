<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Responses Object

A container for the expected responses of an operation.
The container maps a HTTP response code to the expected response.

The documentation is not necessarily expected to cover all possible HTTP response codes because they may not be known in advance.
However, documentation is expected to cover a successful operation response and any known errors.

The `default` MAY be used as a default Response Object for all HTTP codes
that are not covered individually by the Responses Object.

The Responses Object MUST contain at least one response code, and if only one
response code is provided it SHOULD be the response for a successful operation
call.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="responses-default"></a>default | [Response Object](#response-object) \| [Reference Object](#reference-object) | The documentation of responses other than the ones declared for specific HTTP response codes. Use this field to cover undeclared responses. |

#### Patterned Fields

| Field Pattern | Type | Description |
| ---- | :----: | ---- |
| <a name="responses-code"></a>[HTTP Status Code](#http-status-codes) | [Response Object](#response-object) \| [Reference Object](#reference-object) | Any [HTTP status code](#http-status-codes) can be used as the property name, but only one property per code, to describe the expected response for that HTTP status code. This field MUST be enclosed in quotation marks (for example, "200") for compatibility between JSON and YAML. To define a range of response codes, this field MAY contain the uppercase wildcard character `X`. For example, `2XX` represents all response codes between `200` and `299`. Only the following range definitions are allowed: `1XX`, `2XX`, `3XX`, `4XX`, and `5XX`. If a response is defined using an explicit code, the explicit code definition takes precedence over the range definition for that code. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### HTTP Status Codes

The HTTP Status Codes are used to indicate the status of the executed operation.
Status codes SHOULD be selected from the available status codes registered in the [IANA Status Code Registry](https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml).

#### Responses Object Example

A 200 response for a successful operation and a default response for others (implying an error):

```yaml
'200':
  description: a pet to be returned
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/Pet'
default:
  description: Unexpected error
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/ErrorModel'
```

### Response Object

Describes a single response from an API operation, including design-time, static
`links` to operations based on the response.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="response-summary"></a>summary | `string` | A short summary of the meaning of the response. |
| <a name="response-description"></a>description | `string` | A description of the response. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="response-headers"></a>headers | Map[`string`, [Header Object](#header-object) \| [Reference Object](#reference-object)] | Maps a header name to its definition. [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1) states header names are case-insensitive. If a response header is defined with the name `"Content-Type"`, it SHALL be ignored. |
| <a name="response-content"></a>content | Map[`string`, [Media Type Object](#media-type-object) \| [Reference Object](#reference-object)] | A map containing descriptions of potential response payloads. The key is a media type or [media type range](https://www.rfc-editor.org/rfc/rfc9110.html#appendix-A) and the value describes it. For responses that match multiple keys, only the most specific key is applicable. e.g. `"text/plain"` overrides `"text/*"` |
| <a name="response-links"></a>links | Map[`string`, [Link Object](#link-object) \| [Reference Object](#reference-object)] | A map of operations links that can be followed from the response. The key of the map is a short name for the link, following the naming constraints of the names for [Component Objects](#components-object). |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Response Object Examples

Response of an array of a complex type:

```yaml
description: A complex object array response
content:
  application/json:
    schema:
      type: array
      items:
        $ref: '#/components/schemas/VeryComplexType'
```

Response with a string type:

```yaml
description: A simple string response
content:
  text/plain:
    schema:
      type: string
```

Plain text response with headers:

```yaml
description: A simple string response
content:
  text/plain:
    schema:
      type: string
    example: 'whoa!'
headers:
  X-Rate-Limit-Limit:
    description: The number of allowed requests in the current period
    schema:
      type: integer
  X-Rate-Limit-Remaining:
    description: The number of remaining requests in the current period
    schema:
      type: integer
  X-Rate-Limit-Reset:
    description: The number of seconds left in the current period
    schema:
      type: integer
```

Response with no return value:

```yaml
description: object created
```

### Callback Object

A map of possible out-of band callbacks related to the parent operation.
Each value in the map is a [Path Item Object](#path-item-object) that describes a set of requests that may be initiated by the API provider and the expected responses.
The key value used to identify the Path Item Object is an expression, evaluated at runtime, that identifies a URL to use for the callback operation.

To describe incoming requests from the API provider independent from another API call, use the [`webhooks`](#oas-webhooks) field.

#### Patterned Fields

| Field Pattern | Type | Description |
| ---- | :----: | ---- |
| <a name="callback-expression"></a>{expression} | [Path Item Object](#path-item-object) | A Path Item Object used to define a callback request and expected responses. A [complete example](https://learn.openapis.org/examples/v3.0/callback-example.html) is available. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Key Expression

The key that identifies the [Path Item Object](#path-item-object) is a [runtime expression](#runtime-expressions) that can be evaluated in the context of a runtime HTTP request/response to identify the URL to be used for the callback request.
A simple example might be `$request.body#/url`.
However, using a [runtime expression](#runtime-expressions) the complete HTTP message can be accessed.
This includes accessing any part of a body that a JSON Pointer [RFC6901](https://tools.ietf.org/html/rfc6901) can reference.

For example, given the following HTTP request:

```http
POST /subscribe/myevent?queryUrl=https://clientdomain.com/stillrunning HTTP/1.1
Host: example.org
Content-Type: application/json
Content-Length: 188

{
  "failedUrl": "https://clientdomain.com/failed",
  "successUrls": [
    "https://clientdomain.com/fast",
    "https://clientdomain.com/medium",
    "https://clientdomain.com/slow"
  ]
}
```

resulting in:

```http
201 Created
Location: https://example.org/subscription/1
```

The following examples show how the various expressions evaluate, assuming the callback operation has a path parameter named `eventType` and a query parameter named `queryUrl`.

| Expression | Value |
| ---- | :---- |
| $url | <https://example.org/subscribe/myevent?queryUrl=https://clientdomain.com/stillrunning> |
| $method | POST |
| $request.path.eventType | myevent |
| $request.query.queryUrl | <https://clientdomain.com/stillrunning> |
| $request.header.content-type | application/json |
| $request.body#/failedUrl | <https://clientdomain.com/failed> |
| $request.body#/successUrls/1 | <https://clientdomain.com/medium> |
| $response.header.Location | <https://example.org/subscription/1> |

#### Callback Object Examples

The following example uses the user provided `queryUrl` query string parameter to define the callback URL. This is similar to a [webhook](#oas-webhooks), but differs in that the callback only occurs because of the initial request that sent the `queryUrl`.

```yaml
myCallback:
  '{$request.query.queryUrl}':
    post:
      requestBody:
        description: Callback payload
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SomePayload'
      responses:
        '200':
          description: callback successfully processed
```

The following example shows a callback where the server is hard-coded, but the query string parameters are populated from the `id` and `email` property in the request body.

```yaml
transactionCallback:
  'http://notificationServer.com?transactionId={$request.body#/id}&email={$request.body#/email}':
    post:
      requestBody:
        description: Callback payload
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SomePayload'
      responses:
        '200':
          description: callback successfully processed
```

---
← [index](./index.md)
