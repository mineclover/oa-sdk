import {
  arrayOf,
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipCandidateImportSchemas() {
  return {
    DpmCandidateImportRequest: requiredObjectSchema({
      datasetId: stringSchema(),
      candidates: arrayOf(ref('DpmRelationshipCandidateInput')),
    }),
    DpmCandidateImportResponse: requiredObjectSchema({
      imported: integerSchema(),
      rejected: integerSchema(),
    }),
  } as const
}
