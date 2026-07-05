import {
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipApprovalSchemas() {
  return {
    DpmRelationshipApprovalRequest: requiredObjectSchema({
      owner: stringSchema(),
      approvedBy: stringSchema(),
      reason: stringSchema(),
    }),
    DpmRelationshipApprovalResponse: requiredObjectSchema({
      relationshipName: stringSchema(),
      status: { type: 'string', enum: ['approved'] },
    }),
  } as const
}
