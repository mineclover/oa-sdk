import {
  arrayOf,
  integerSchema,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmGatewayRelationshipCandidateImportSchemas() {
  return {
    DpmCandidateImportRequest: requiredObjectSchema({
      datasetId: stringSchema(),
      candidates: arrayOf(requiredObjectSchema({
        name: stringSchema(),
        evidenceRef: stringSchema(),
      })),
    }),
    DpmCandidateImportResponse: requiredObjectSchema({
      imported: integerSchema(),
      rejected: integerSchema(),
    }),
  } as const
}
