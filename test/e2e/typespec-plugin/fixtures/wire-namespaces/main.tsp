import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/**
 * Wire models declared in sub-namespaces. TypeSpec names their components after the namespace
 * path (`Inventory.Widget`), which is not a TypeScript identifier, and two namespaces may declare
 * models with the same short name (`Inventory.Widget`, `Catalog.Widget`).
 */
@service(#{ title: "Wire Namespaces Service" })
@info(#{ version: "1.0.0" })
namespace WireNamespaces;

@extension("x-oa-sdk-protobuf", true)
model Widget {
  @extension("x-oa-sdk-field", #{ index: 1 })
  id: string;
}

namespace Inventory {
  @extension("x-oa-sdk-protobuf", true)
  model Widget {
    @extension("x-oa-sdk-field", #{ index: 1 })
    sku: string;

    @extension("x-oa-sdk-field", #{ index: 2 })
    quantity: int32;
  }

  @extension("x-oa-sdk-protobuf", true)
  model Shipment {
    @extension("x-oa-sdk-field", #{ index: 1 })
    shipmentId: string;

    @extension("x-oa-sdk-field", #{ index: 2 })
    widgets: Inventory.Widget[];
  }
}

namespace Catalog {
  @extension("x-oa-sdk-protobuf", true)
  model Widget {
    @extension("x-oa-sdk-field", #{ index: 1 })
    title: string;
  }
}

@route("/shipments")
namespace Shipments {
  @post
  op create(@body shipment: Inventory.Shipment): {
    @statusCode statusCode: 200;
    @body body: Inventory.Shipment;
  };
}

@route("/widgets")
namespace Widgets {
  @put
  op replace(@body widget: Widget): {
    @statusCode statusCode: 200;
    @body body: Catalog.Widget;
  };
}
