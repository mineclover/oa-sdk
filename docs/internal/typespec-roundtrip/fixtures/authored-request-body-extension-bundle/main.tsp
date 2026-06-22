import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{ title: "Authored Request Body Extension Bundle API" })
@info(#{ version: "1.0.0" })
namespace AuthoredRequestBodyExtensionBundleApi;

model CreateUserRequest {
  @format("email")
  email: string;

  @minLength(1)
  name: string;

  ...Record<never>;
}

model User {
  id: string;

  @format("email")
  email: string;

  name: string;

  ...Record<never>;
}

model CreateUser201Response {
  @statusCode statusCode: 201;
  @body body: User;
}

@route("/users")
@post
@operationId("createUser")
@summary("Create user")
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "bob@example.com",
            name: "Bob"
          },
          serializedValue: "{\"email\":\"bob@example.com\",\"name\":\"Bob\"}"
        }
      }
    }
  }
})
op createUser(
  @body body: CreateUserRequest,
): CreateUser201Response;
