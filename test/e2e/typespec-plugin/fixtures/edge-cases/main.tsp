import "@typespec/http";

using Http;

/**
 * Shapes that previously produced non-compiling generated code:
 * - operations declared directly in the service namespace (operationId without a namespace prefix)
 * - one short operation name shared by several namespaces
 * - typed (non-string) header parameters
 * - several error statuses with distinct models, with and without a `default` error
 */
@service(#{ title: "Edge Cases Service" })
namespace EdgeCases;

model Item {
  id: string;
  name: string;
}

@error
model NotFound {
  @statusCode code: 404;
  message: string;
}

@error
model Conflict {
  @statusCode code: 409;
  conflictKey: string;
}

@doc("Unexpected error (OpenAPI `default` response)")
@error
model GenericError {
  reason: string;
}

@route("/items")
@get
op listItems(@header("x-count") count?: int32, @header("x-debug") debug?: boolean): Item[];

@route("/items/{id}")
@get
op getItem(@path id: string): Item | NotFound | Conflict;

@route("/items/{id}")
@delete
op removeItem(@path id: string): {
  @statusCode code: 204;
};

@route("/things/{id}")
@get
op getThing(@path id: string): Item | NotFound | GenericError;

@route("/pets")
namespace Pets {
  @get
  op list(): Item[];
}

@route("/users")
namespace Users {
  @get
  op list(): Item[];
}
