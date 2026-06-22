import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@extension("x-oa-sdk-security-schemes", #{
  oauth2: #{
    type: "oauth2",
    flows: #{
      authorizationCode: #{
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        scopes: #[
          #{ name: "read:users", description: "Read users" }
        ]
      }
    }
  }
})
@service(#{ title: "Authored Extension Bundle API" })
@info(#{ version: "1.0.0" })
namespace AuthoredExtensionBundleApi;

model User {
  id: string;
  name: string;
  ...Record<never>;
}

model ListUsers200Response {
  @statusCode statusCode: 200;
  @body body: User[];
}

@route("/users")
@get
@operationId("listUsers")
@summary("List users")
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    page: #{
      in: "query",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    }
  },
  responses: #{
    ok: #{
      json: #{
        statusCode: "200",
        mediaType: "application/json",
        examples: #{
          default: #{
            dataValue: #[
              #{ id: "usr_1", name: "Alice" }
            ]
          }
        }
      }
    }
  }
})
op listUsers(
  @query @minValue(1) page?: integer = 1,
): ListUsers200Response;
