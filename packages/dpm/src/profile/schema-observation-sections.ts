import {
  DPM_PROFILE_METRIC_KINDS,
} from './types.js'
import {
  evidenceIdsSchema,
  nonEmptyStringSchema,
  profileCoordinateSchema,
  sha256Schema,
} from './schema-fragments.js'

export const profileMetricsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: nonEmptyStringSchema,
      kind: { type: 'string', enum: DPM_PROFILE_METRIC_KINDS },
      subjectId: nonEmptyStringSchema,
      value: { type: ['number', 'string'] },
      unit: nonEmptyStringSchema,
      evidenceIds: evidenceIdsSchema,
    },
    required: ['id', 'kind', 'subjectId', 'value', 'evidenceIds'],
  },
} as const

export const profileDiagnosticsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      severity: { type: 'string', enum: ['error', 'warning', 'info'] },
      code: { type: 'string', pattern: '^(PROF|CONN)[0-9]{3}$' },
      message: nonEmptyStringSchema,
      connectorId: nonEmptyStringSchema,
      coordinate: profileCoordinateSchema,
      evidenceIds: evidenceIdsSchema,
    },
    required: ['severity', 'code', 'message'],
    anyOf: [
      { required: ['coordinate'] },
      { required: ['evidenceIds'] },
    ],
  },
} as const

export const profileFreshnessSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    versionHash: sha256Schema,
    sourceVersionHashes: {
      type: 'object',
      additionalProperties: sha256Schema,
    },
  },
  required: ['versionHash'],
} as const
