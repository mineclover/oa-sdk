export const relationshipHint = {
  id: 'proposal:edge:relationship-hint:orders-created-customer',
  status: 'review',
  fromNodeId: 'node:field:orders.created.value.customer.customer_no',
  hintNodeId: 'node:relationship-hint:orders-created-customer',
  targetRef: 'catalog://commerce/public.customers.customer_no',
  confidence: 0.93,
  evidenceIds: ['evidence:kafka:orders.created.customer_no'],
  explanation: 'Review orders.created customer_no as a relationship hint.',
}
