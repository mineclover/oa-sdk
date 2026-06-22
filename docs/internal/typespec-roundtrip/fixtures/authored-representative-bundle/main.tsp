import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@extension("x-oa-sdk-security-schemes", #{
  oauth2: #{
    type: "oauth2",
    description: "OAuth 2.0 authentication metadata",
    flows: #{
      authorizationCode: #{
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        refreshUrl: "https://auth.example.com/token",
        scopes: #[
          #{ name: "read", description: "Read access" },
          #{ name: "write", description: "Write access" }
        ]
      }
    }
  }
})
@service(#{ title: "Authored Representative Bundle API" })
@info(#{ version: "1.0.0" })
@tagMetadata("users", #{ description: "User management" })
namespace AuthoredRepresentativeBundleApi;

model bearerAuth is BearerAuth;

alias UserRole = "admin" | "user" | "guest";
alias ReportReason = "spam" | "harassment" | "hate-speech" | "fraud" | "impersonation" | "other";
alias ReportStatus = "open" | "under-review" | "resolved" | "dismissed";
alias ErrorCode =
  "BAD_REQUEST" |
  "UNAUTHORIZED" |
  "SCHEMA_VALIDATION_FAILED" |
  "INTERNAL_SERVER_ERROR";
alias ErrorDetail = ValidationError | ErrorMeta;

@doc("User information.")
@example(#{
  id: "00000000-0000-0000-0000-000000000001",
  email: "alice@example.com",
  name: "Alice",
  role: "user",
  createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z")
})
model User {
  @format("uuid")
  id: string;

  @format("email")
  email: string;

  @minLength(1)
  @maxLength(100)
  name: string;

  role: UserRole;

  createdAt: utcDateTime;

  ...Record<never>;
}

@doc("User creation request.")
model CreateUserRequest {
  @format("email")
  email: string;

  @minLength(1)
  @maxLength(100)
  name: string;

  @doc("At least 8 characters.")
  @minLength(8)
  password: string;

  ...Record<never>;
}

@doc("Report request body.")
model ReportRequest {
  reason: ReportReason;

  @maxLength(1000)
  details?: string;

  ...Record<never>;
}

@doc("Report record.")
@example(#{
  id: "00000000-0000-0000-0000-000000000300",
  targetUserId: "00000000-0000-0000-0000-000000000001",
  reporterUserId: "00000000-0000-0000-0000-000000000002",
  reason: "harassment",
  status: "open",
  createdAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z")
})
model Report {
  @format("uuid")
  id: string;

  @format("uuid")
  targetUserId: string;

  @format("uuid")
  reporterUserId: string;

  reason: ReportReason;

  details?: string;

  status: ReportStatus;

  createdAt: utcDateTime;

  resolvedAt?: utcDateTime;

  ...Record<never>;
}

@doc("Standard error response schema.")
model Error {
  @doc("Machine-readable error code.")
  code: ErrorCode;

  @doc("Human-readable error message.")
  message: string;

  details?: ErrorDetail[];

  _meta?: ErrorMeta;

  ...Record<never>;
}

@doc("Field-level validation error.")
model ValidationError {
  path: string;
  message: string;
  expected?: string;
  received?: unknown;
  ...Record<never>;
}

@doc("Error metadata.")
model ErrorMeta {
  operationId?: string;

  @format("uuid")
  requestId?: string;

  ...Record<never>;
}

model ListUsers200Body {
  items: User[];

  @minValue(0)
  total: integer;

  ...Record<never>;
}

model ListUsers200Response {
  @statusCode statusCode: 200;
  @body body: ListUsers200Body;
}

model CreateUser201Response {
  @statusCode statusCode: 201;
  @body body: User;
}

model ReportUser201Response {
  @statusCode statusCode: 201;
  @body body: Report;
}

model BadRequestResponse {
  @statusCode statusCode: 400;
  @body body: Error;
}

model UnauthorizedResponse {
  @statusCode statusCode: 401;
  @body body: Error;
}

model UnprocessableEntityResponse {
  @statusCode statusCode: 422;
  @body body: Error;
}

model InternalServerErrorResponse {
  @statusCode statusCode: 500;
  @body body: Error;
}

@route("/users")
@get
@tag("users")
@useAuth(bearerAuth)
@operationId("listUsers")
@summary("List users")
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    page: #{
      in: "query",
      examples: #{ default: #{ dataValue: 1, serializedValue: "page=1" } }
    },
    limit: #{
      in: "query",
      examples: #{ default: #{ dataValue: 20, serializedValue: "limit=20" } }
    }
  },
  responses: #{
    ok: #{
      json: #{
        statusCode: "200",
        mediaType: "application/json",
        examples: #{
          default: #{
            dataValue: #{
              items: #[
                #{
                  id: "00000000-0000-0000-0000-000000000001",
                  email: "alice@example.com",
                  name: "Alice",
                  role: "user",
                  createdAt: "2024-01-01T00:00:00.000Z"
                }
              ],
              total: 1
            },
            serializedValue: "{\"items\":[{\"id\":\"00000000-0000-0000-0000-000000000001\",\"email\":\"alice@example.com\",\"name\":\"Alice\",\"role\":\"user\",\"createdAt\":\"2024-01-01T00:00:00.000Z\"}],\"total\":1}"
          }
        }
      }
    }
  }
})
op listUsers(
  @query @minValue(1) page?: integer = 1,
  @query @minValue(1) @maxValue(100) limit?: integer = 20,
  @query role?: UserRole,
): ListUsers200Response | UnauthorizedResponse;

@route("/users")
@post
@tag("users")
@useAuth(bearerAuth)
@operationId("createUser")
@summary("Create user")
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    created: #{
      json: #{
        statusCode: "201",
        mediaType: "application/json",
        examples: #{
          default: #{
            dataValue: #{
              id: "00000000-0000-0000-0000-000000000002",
              email: "bob@example.com",
              name: "Bob",
              role: "user",
              createdAt: "2024-01-01T00:00:00.000Z"
            }
          }
        }
      }
    }
  }
})
op createUser(
  @body body: CreateUserRequest,
): CreateUser201Response | BadRequestResponse | UnauthorizedResponse | UnprocessableEntityResponse | InternalServerErrorResponse;

@route("/users/{id}/reports")
@post
@tag("users")
@useAuth(bearerAuth)
@operationId("reportUser")
@summary("Report user")
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    created: #{
      json: #{
        statusCode: "201",
        mediaType: "application/json",
        examples: #{
          default: #{
            dataValue: #{
              id: "00000000-0000-0000-0000-000000000300",
              targetUserId: "00000000-0000-0000-0000-000000000001",
              reporterUserId: "00000000-0000-0000-0000-000000000002",
              reason: "harassment",
              status: "open",
              createdAt: "2026-05-04T00:00:00.000Z"
            }
          }
        }
      }
    }
  }
})
op reportUser(
  @path @format("uuid") id: string,
  @body body: ReportRequest,
): ReportUser201Response | BadRequestResponse | UnauthorizedResponse | UnprocessableEntityResponse;
