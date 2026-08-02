import "@oa-sdk/typespec-erd";
using OaSdkErd;

@dataset("commerce")
namespace Commerce {

  @entity("commerce.customer")
  model Customer {
    @field("commerce.customer.id")
    @primaryKey
    id: string;
  }

  @entity("commerce.order")
  model Order {
    @field("commerce.order.id")
    @primaryKey("commerce.order.primary", 1)
    id: string;

    @field("commerce.order.customer-id")
    @primaryKey("commerce.order.primary", 2)
    @foreignKey(Customer.id)
    customerId: string;
  }

  @relationship("commerce.order-customer", Order.customerId, Customer.id, "many-to-one")
  namespace Relationships {}
}
