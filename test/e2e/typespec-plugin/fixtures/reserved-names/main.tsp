import "@typespec/http";

using Http;

/**
 * Operation names that cannot name a function or const in the generated client module:
 * - root-level operations whose operationId is a reserved word (`delete`, `import`, `new`);
 *   `new` is also quoted as an ApiClient member, where it would otherwise be a construct signature
 * - a root-level operation named like a binding client.ts declares itself (`createClient`)
 * - a root-level operation named like a global client.ts refers to (`fetch`, used by the transport)
 * - a namespaced operation whose unique short name is a reserved word (`Orders.export`)
 * - a namespaced operation whose reserved short name is shared with a root-level one (`Pets.delete`)
 */
@service(#{ title: "Reserved Names Service" })
namespace ReservedNames;

model Pet {
  id: string;
  name: string;
}

model Order {
  id: string;
  total: int32;
}

@error
model NotFound {
  @statusCode code: 404;
  message: string;
}

@route("/things/{id}")
@delete
op delete(@path id: string): {
  @statusCode code: 204;
} | NotFound;

@route("/imports")
@post
op `import`(@body pets: Pet[]): Pet[];

@route("/clients")
@post
op createClient(@body pet: Pet): Pet;

@route("/new-pets")
@post
op `new`(@body pet: Pet): Pet;

@route("/fetch/{id}")
@get
op fetch(@path id: string): Pet | NotFound;

@route("/pets")
namespace Pets {
  @delete
  op delete(@path id: string): void | NotFound;
}

@route("/orders")
namespace Orders {
  @route("/export")
  @get
  op `export`(): Order[];
}
