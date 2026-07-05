import {
  DPM_PROFILE_SOURCE_KINDS,
} from './types.js'

export const nonEmptyStringSchema = { type: 'string', minLength: 1 } as const
export const sha256Schema = { type: 'string', pattern: '^sha256:.+' } as const

export const profileCoordinateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: DPM_PROFILE_SOURCE_KINDS },
    sourceId: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
    pointer: nonEmptyStringSchema,
    externalId: nonEmptyStringSchema,
  },
  required: ['kind', 'path'],
} as const

export const evidenceIdsSchema = {
  type: 'array',
  minItems: 1,
  items: nonEmptyStringSchema,
} as const
