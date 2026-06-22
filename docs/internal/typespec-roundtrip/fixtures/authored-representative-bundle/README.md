# Authored Representative TypeSpec Bundle

This fixture is the G1/G2 representative authored bundle for the TypeSpec-first decision track.

It is derived from the canonical OA SDK OpenAPI artifact at `packages/schemas/src/.merged.yaml`, but it is intentionally smaller than the full canonical API. The fixture proves that a hand-authored `.tsp` project can cover the semantic families needed before drafting a conditional TypeSpec-first ADR.

## Selected Canonical Surface

| Selected source | Canonical location | Why selected |
|---|---|---|
| `listUsers` | `GET /users` | Covers a paginated list operation, reusable `Page` and `Limit` query semantics, role filtering, bearer security, and response media examples. |
| `createUser` | `POST /users` | Covers request body authoring with reusable component schemas, created response semantics, and shared error response reuse. |
| `reportUser` | `POST /users/{id}/reports` | Covers path parameter authoring, enum-heavy request/response models, and another shared error response consumer. |
| `User` | `components.schemas.User` | Covers the main reusable object model with format, enum, array/list usage, and strict object sealing. |
| `CreateUserRequest` | `components.schemas.CreateUserRequest` | Covers request body model constraints such as email format and min/max length. |
| `ReportRequest` and `Report` | `components.schemas.ReportRequest`, `components.schemas.Report` | Covers domain enum values and optional fields. |
| `Error` and `ValidationError` | `components.schemas.Error`, `components.schemas.ValidationError` | Covers shared error responses and a union/composed detail model. |
| `Page` and `Limit` | `components.parameters.Page`, `components.parameters.Limit` | Covers reusable pagination parameter semantics and OA SDK `dataValue` / `serializedValue` examples. |
| `bearerAuth` and `oauth2` | `components.securitySchemes.bearerAuth`, `components.securitySchemes.oauth2` | Covers TypeSpec-native bearer auth requirements plus OA SDK extension restoration for unsupported OAuth2 security scheme metadata. |

## Coverage Checklist

- Paginated list operation with query parameters and OA SDK `dataValue` / `serializedValue` examples: `listUsers`.
- Request body operation with reusable component schemas: `createUser` and `reportUser`.
- Success response with response media examples: `listUsers`, `createUser`, and `reportUser`.
- Shared error response across multiple operations: `UnauthorizedResponse`, `BadRequestResponse`, and `UnprocessableEntityResponse`.
- Sealed object model using `...Record<never>;`: `User`, request models, response body models, and error models.
- Union or composed schema that exercises accepted TypeSpec projection shape: `ErrorDetail = ValidationError | ErrorMeta`.
- Security requirement and restored security metadata: operations use TypeSpec-native `@useAuth(bearerAuth)`, while `x-oa-sdk-security-schemes` restores the unsupported `oauth2` component metadata.

## Gate

```bash
pnpm typespec:bundle-check -- --manifest docs/internal/typespec-roundtrip/fixtures/authored-representative-bundle/oa-sdk.typespec-bundle.json --fail-on-breaking
```
