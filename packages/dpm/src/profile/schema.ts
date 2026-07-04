import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_CAPTURE_MODES,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
} from './types.js'

export const DPM_PROFILE_ARTIFACT_SCHEMA_ID = 'https://oa-sdk.dev/schemas/dpm-profile-artifact.v1.json' as const

const nonEmptyStringSchema = { type: 'string', minLength: 1 } as const
const sha256Schema = { type: 'string', pattern: '^sha256:.+' } as const

const profileCoordinateSchema = {
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

const evidenceIdsSchema = {
  type: 'array',
  minItems: 1,
  items: nonEmptyStringSchema,
} as const

export const DPM_PROFILE_ARTIFACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: DPM_PROFILE_ARTIFACT_SCHEMA_ID,
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { const: DPM_PROFILE_ARTIFACT_KIND },
    profileId: nonEmptyStringSchema,
    datasetId: nonEmptyStringSchema,
    profileVersion: nonEmptyStringSchema,
    createdAt: nonEmptyStringSchema,
    sources: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: nonEmptyStringSchema,
          kind: { type: 'string', enum: DPM_PROFILE_SOURCE_KINDS },
          connectorId: nonEmptyStringSchema,
          connectorVersion: nonEmptyStringSchema,
          refs: {
            type: 'array',
            minItems: 1,
            items: nonEmptyStringSchema,
          },
          captureMode: { type: 'string', enum: DPM_PROFILE_CAPTURE_MODES },
          capturedAt: nonEmptyStringSchema,
          sourceVersionHash: sha256Schema,
        },
        required: ['id', 'kind', 'connectorId', 'connectorVersion', 'refs', 'captureMode'],
      },
    },
    evidenceSources: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        properties: {
          coordinate: profileCoordinateSchema,
          connectorId: nonEmptyStringSchema,
          capturedAt: nonEmptyStringSchema,
          description: nonEmptyStringSchema,
        },
        required: ['coordinate'],
      },
    },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: nonEmptyStringSchema,
          kind: { type: 'string', enum: DPM_PROFILE_NODE_KINDS },
          label: nonEmptyStringSchema,
          coordinate: profileCoordinateSchema,
          dataType: nonEmptyStringSchema,
          shape: {
            type: 'object',
            additionalProperties: {
              type: ['string', 'number', 'boolean', 'null'],
            },
          },
        },
        required: ['id', 'kind', 'label', 'coordinate'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: nonEmptyStringSchema,
          kind: { type: 'string', enum: DPM_PROFILE_EDGE_KINDS },
          fromNodeId: nonEmptyStringSchema,
          toNodeId: nonEmptyStringSchema,
          evidenceIds: evidenceIdsSchema,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['id', 'kind', 'fromNodeId', 'toNodeId', 'evidenceIds'],
      },
    },
    metrics: {
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
    },
    diagnostics: {
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
    },
    freshness: {
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
    },
  },
  required: [
    'kind',
    'profileId',
    'datasetId',
    'profileVersion',
    'createdAt',
    'sources',
    'evidenceSources',
    'nodes',
    'edges',
    'metrics',
    'diagnostics',
    'freshness',
  ],
} as const

export type DpmProfileArtifactSchemaIssue = {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
}

export type DpmProfileArtifactSchemaValidationResult = {
  valid: boolean
  issues: DpmProfileArtifactSchemaIssue[]
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateDpmProfileArtifactSchemaDocument = ajv.compile(DPM_PROFILE_ARTIFACT_SCHEMA)

export function validateDpmProfileArtifactSchema(artifact: unknown): DpmProfileArtifactSchemaValidationResult {
  const valid = validateDpmProfileArtifactSchemaDocument(artifact)
  if (valid) {
    return {
      valid: true,
      issues: [],
    }
  }

  return {
    valid: false,
    issues: (validateDpmProfileArtifactSchemaDocument.errors ?? []).map(toDpmProfileArtifactSchemaIssue),
  }
}

function toDpmProfileArtifactSchemaIssue(error: ErrorObject): DpmProfileArtifactSchemaIssue {
  return {
    instancePath: error.instancePath || '/',
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: formatProfileSchemaMessage(error),
  }
}

function formatProfileSchemaMessage(error: ErrorObject): string {
  const message = error.message ?? 'failed JSON Schema validation'
  const missingProperty = typeof error.params?.missingProperty === 'string'
    ? `: ${error.params.missingProperty}`
    : ''
  return `DPM profile artifact schema ${message}${missingProperty}.`
}
