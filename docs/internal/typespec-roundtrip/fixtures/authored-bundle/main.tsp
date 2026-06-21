import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{ title: "Authored Bundle API" })
@info(#{ version: "1.0.0" })
namespace AuthoredBundleApi;

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
op listUsers(
  @query @minValue(1) page?: integer = 1,
): ListUsers200Response;
