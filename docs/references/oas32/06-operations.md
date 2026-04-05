<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### Path Item Object

Describes the operations available on a single path.
A Path Item MAY be empty, due to [ACL constraints](#security-filtering).
The path itself is still exposed to the documentation viewer but they will not know which operations and parameters are available.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="path-item-ref"></a>$ref | `string` | Allows for a referenced definition of this path item. The value MUST be in the form of a URI, and the referenced structure MUST be in the form of a [Path Item Object](#path-item-object). In case a Path Item Object field appears both in the defined object and the referenced object, the behavior is undefined. See the rules for resolving [Relative References](#relative-references-in-api-description-uris). <br><br>_**Note:** The behavior of `$ref` with adjacent properties is likely to change in future versions of this specification to bring it into closer alignment with the behavior of the [Reference Object](#reference-object)._ |
| <a name="path-item-summary"></a>summary | `string` | An optional string summary, intended to apply to all operations in this path. |
| <a name="path-item-description"></a>description | `string` | An optional string description, intended to apply to all operations in this path. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="path-item-get"></a>get | [Operation Object](#operation-object) | A definition of a GET operation on this path. |
| <a name="path-item-put"></a>put | [Operation Object](#operation-object) | A definition of a PUT operation on this path. |
| <a name="path-item-post"></a>post | [Operation Object](#operation-object) | A definition of a POST operation on this path. |
| <a name="path-item-delete"></a>delete | [Operation Object](#operation-object) | A definition of a DELETE operation on this path. |
| <a name="path-item-options"></a>options | [Operation Object](#operation-object) | A definition of a OPTIONS operation on this path. |
| <a name="path-item-head"></a>head | [Operation Object](#operation-object) | A definition of a HEAD operation on this path. |
| <a name="path-item-patch"></a>patch | [Operation Object](#operation-object) | A definition of a PATCH operation on this path. |
| <a name="path-item-trace"></a>trace | [Operation Object](#operation-object) | A definition of a TRACE operation on this path. |
| <a name="path-item-query"></a>query | [Operation Object](#operation-object) | A definition of a QUERY operation, as defined in the most recent IETF draft ([draft-ietf-httpbis-safe-method-w-body-08](https://www.ietf.org/archive/id/draft-ietf-httpbis-safe-method-w-body-11.html) as of this writing) or its RFC successor, on this path. |
| <a name="path-item-additional-operations"></a>additionalOperations | Map[`string`, [Operation Object](#operation-object)] | A map of additional operations on this path. The map key is the HTTP method with the same capitalization that is to be sent in the request. This map MUST NOT contain any entry for the methods that can be defined by other fixed fields with Operation Object values (e.g. no `POST` entry, as the `post` field is used for this method). |
| <a name="path-item-servers"></a>servers | [[Server Object](#server-object)] | An alternative `servers` array to service all operations in this path. If a `servers` array is specified at the [OpenAPI Object](#oas-servers) level, it will be overridden by this value. |
| <a name="path-item-parameters"></a>parameters | [[Parameter Object](#parameter-object) \| [Reference Object](#reference-object)] | A list of parameters that are applicable for all the operations described under this path. These parameters can be overridden at the operation level, but cannot be removed there. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](#parameter-name) and [location](#parameter-in). The list can use the [Reference Object](#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](#components-parameters). |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Path Item Object Example

```yaml
get:
  description: Returns pets based on ID
  summary: Find pets by ID
  operationId: getPetsById
  responses:
    '200':
      description: pet response
      content:
        '*/*':
          schema:
            type: array
            items:
              $ref: '#/components/schemas/Pet'
    default:
      description: error payload
      content:
        text/html:
          schema:
            $ref: '#/components/schemas/ErrorModel'
parameters:
  - name: id
    in: path
    description: ID of pet to use
    required: true
    schema:
      type: array
      items:
        type: string
    style: simple
additionalOperations:
  COPY:
    description: Copies pet information based on ID
    summary: Copies pets by ID
    operationId: copyPetsById
    responses:
      '200':
        description: pet response
        content:
          '*/*':
            schema:
              type: array
              items:
                $ref: '#/components/schemas/Pet'
      default:
        description: error payload
        content:
          text/html:
            schema:
              $ref: '#/components/schemas/ErrorModel'
```

### Operation Object

Describes a single API operation on a path.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="operation-tags"></a>tags | [`string`] | A list of tags for API documentation control. Tags can be used for logical grouping of operations by resources or any other qualifier. |
| <a name="operation-summary"></a>summary | `string` | A short summary of what the operation does. |
| <a name="operation-description"></a>description | `string` | A verbose explanation of the operation behavior. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="operation-external-docs"></a>externalDocs | [External Documentation Object](#external-documentation-object) | Additional external documentation for this operation. |
| <a name="operation-id"></a>operationId | `string` | Unique string used to identify the operation. The id MUST be unique among all operations described in the API. The operationId value is **case-sensitive**. Tools and libraries MAY use the operationId to uniquely identify an operation, therefore, it is RECOMMENDED to follow common programming naming conventions. |
| <a name="operation-parameters"></a>parameters | [[Parameter Object](#parameter-object) \| [Reference Object](#reference-object)] | A list of parameters that are applicable for this operation. If a parameter is already defined at the [Path Item](#path-item-parameters), the new definition will override it but can never remove it. The list MUST NOT include duplicated parameters. A unique parameter is defined by a combination of a [name](#parameter-name) and [location](#parameter-in). The list can use the [Reference Object](#reference-object) to link to parameters that are defined in the [OpenAPI Object's `components.parameters`](#components-parameters). |
| <a name="operation-request-body"></a>requestBody | [Request Body Object](#request-body-object) \| [Reference Object](#reference-object) | The request body applicable for this operation. The `requestBody` is fully supported in HTTP methods where the HTTP specification [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3) has explicitly defined semantics for request bodies. In other cases where the HTTP spec discourages message content (such as [GET](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1) and [DELETE](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.5)), `requestBody` is permitted but does not have well-defined semantics and SHOULD be avoided if possible. |
| <a name="operation-responses"></a>responses | [Responses Object](#responses-object) | The list of possible responses as they are returned from executing this operation. |
| <a name="operation-callbacks"></a>callbacks | Map[`string`, [Callback Object](#callback-object) \| [Reference Object](#reference-object)] | A map of possible out-of band callbacks related to the parent operation. The key is a unique identifier for the Callback Object. Each value in the map is a [Callback Object](#callback-object) that describes a request that may be initiated by the API provider and the expected responses. |
| <a name="operation-deprecated"></a>deprecated | `boolean` | Declares this operation to be deprecated. Consumers SHOULD refrain from usage of the declared operation. Default value is `false`. |
| <a name="operation-security"></a>security | [[Security Requirement Object](#security-requirement-object)] | A declaration of which security mechanisms can be used for this operation. The list of values includes alternative Security Requirement Objects that can be used. Only one of the Security Requirement Objects need to be satisfied to authorize a request. To make security optional, an empty security requirement (`{}`) can be included in the array. This definition overrides any declared top-level [`security`](#oas-security). To remove a top-level security declaration, an empty array can be used. |
| <a name="operation-servers"></a>servers | [[Server Object](#server-object)] | An alternative `servers` array to service this operation. If a `servers` array is specified at the [Path Item Object](#path-item-servers) or [OpenAPI Object](#oas-servers) level, it will be overridden by this value. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### Operation Object Example

```yaml
tags:
  - pet
summary: Updates a pet in the store with form data
operationId: updatePetWithForm
parameters:
  - name: petId
    in: path
    description: ID of pet that needs to be updated
    required: true
    schema:
      type: string
requestBody:
  content:
    application/x-www-form-urlencoded:
      schema:
        type: object
        properties:
          name:
            description: Updated name of the pet
            type: string
          status:
            description: Updated status of the pet
            type: string
        required:
          - status
responses:
  '200':
    description: Pet updated.
    content:
      application/json: {}
      application/xml: {}
  '405':
    description: Method Not Allowed
    content:
      application/json: {}
      application/xml: {}
security:
  - petstore_auth:
      - write:pets
      - read:pets
```

### External Documentation Object

Allows referencing an external resource for extended documentation.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="external-doc-description"></a>description | `string` | A description of the target documentation. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. |
| <a name="external-doc-url"></a>url | `string` | **REQUIRED**. The URI for the target documentation. This MUST be in the form of a URI. |

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### External Documentation Object Example

```yaml
description: Find more info here
url: https://example.com
```

---
← [index](./index.md)
