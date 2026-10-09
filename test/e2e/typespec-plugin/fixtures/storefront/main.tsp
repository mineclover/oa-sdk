import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{
  title: "Storefront E-Commerce API"
})
@info(#{
  version: "2.1.0"
})
namespace Storefront;

enum OrderStatus {
  created: "created",
  processing: "processing",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
}

model Money {
  amount: int64;
  currency: string;
}

model Product {
  id: string;
  sku: string;
  title: string;
  description?: string;
  price: Money;
  tags?: string[];
  inStock: boolean;
  inventoryCount: int32;
}

model OrderItem {
  productId: string;
  quantity: int32;
  unitPrice: Money;
}

model Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  items: OrderItem[];
  total: Money;
  createdAt: utcDateTime;
}

model PaginatedProductsResponse {
  items: Product[];
  total: int32;
  page: int32;
  pageSize: int32;
  hasNext: boolean;
}

model CreateOrderRequest {
  items: OrderItem[];
  shippingAddress: {
    street: string;
    city: string;
    country: string;
    postalCode: string;
  };
}

@doc("Storefront error model")
model StorefrontError {
  code: "NOT_FOUND" | "OUT_OF_STOCK" | "PAYMENT_FAILED" | "INVALID_REQUEST";
  message: string;
  timestamp: utcDateTime;
}

@route("/products")
namespace Products {
  @get
  @summary("Search and list catalog products")
  op listProducts(
    @query page?: int32,
    @query pageSize?: int32,
    @query search?: string,
    @query inStockOnly?: boolean,
    @query sortBy?: "price_asc" | "price_desc" | "created_desc",
  ): PaginatedProductsResponse | StorefrontError;

  @get
  @route("/{productId}")
  @summary("Get product details by ID")
  op getProduct(
    @path productId: string,
  ): Product | StorefrontError;
}

@route("/orders")
namespace Orders {
  @post
  @summary("Place a new customer order")
  op createOrder(
    @body order: CreateOrderRequest,
    @header("idempotency-key") idempotencyKey?: string,
  ): {
    @statusCode statusCode: 201;
    @body body: Order;
  } | StorefrontError;

  @get
  @route("/{orderId}")
  @summary("Retrieve order details")
  op getOrder(
    @path orderId: string,
  ): Order | StorefrontError;

  @delete
  @route("/{orderId}")
  @summary("Cancel order")
  op cancelOrder(
    @path orderId: string,
  ): {
    @statusCode statusCode: 204;
  } | StorefrontError;
}
