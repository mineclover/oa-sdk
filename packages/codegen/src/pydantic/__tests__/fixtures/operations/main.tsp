// Golden fixture source for operation IR. Regenerate operations.openapi.yaml from the repository root:
//   corepack pnpm exec tsp compile packages/codegen/src/pydantic/__tests__/fixtures/operations/main.tsp --config packages/codegen/src/pydantic/__tests__/fixtures/operations/tspconfig.yaml
// Post-edit after compilation: delete exactly the line `operationId: createThing` under `POST /things/{id}`.
import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{ title: "Operations fixture" })
namespace OperationsFixture;

model Thing { id: int64; name: string; }
@error
model Error { message: string; }
model BadRequestResponse { @statusCode statusCode: 400; @body error: Error; }
model ThingResponse { @header requestId: string; @body value: Thing; }

@route("/things/{id}")
@get
@operationId("get_thing")
op getThing(
  @path id: int64,
  @query filter?: string | null,
  @header trace?: string,
  @cookie session?: string,
  @body body: Thing,
): ThingResponse | BadRequestResponse | Error;

@route("/things/{id}")
@post
@operationId("createThing")
op createThing(
  @path id: int64,
  @body body: { name: string; inner: { y: string; } },
): Thing | BadRequestResponse | Error;

@route("/things")
@get
@operationId("getThing")
op listThings(): Thing | BadRequestResponse | Error;
