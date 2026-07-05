import {
  DPM_PROFILE_ARTIFACT_KIND,
} from './types.js'
import {
  nonEmptyStringSchema,
} from './schema-fragments.js'
import {
  profileEdgesSchema,
  profileNodesSchema,
} from './schema-graph-sections.js'
import {
  profileDiagnosticsSchema,
  profileFreshnessSchema,
  profileMetricsSchema,
} from './schema-observation-sections.js'
import {
  profileEvidenceSourcesSchema,
  profileSourcesSchema,
} from './schema-source-sections.js'

export const DPM_PROFILE_ARTIFACT_SCHEMA_ID = 'https://oa-sdk.dev/schemas/dpm-profile-artifact.v1.json' as const

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
    sources: profileSourcesSchema,
    evidenceSources: profileEvidenceSourcesSchema,
    nodes: profileNodesSchema,
    edges: profileEdgesSchema,
    metrics: profileMetricsSchema,
    diagnostics: profileDiagnosticsSchema,
    freshness: profileFreshnessSchema,
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
