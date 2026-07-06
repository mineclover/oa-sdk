import {
  DPM_PROFILE_CAPTURE_MODES,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  type DpmProfileArtifact,
} from '../../src/index.js'
import type { SchemaPath } from './schema-path.js'

export type ProfileArtifactSchemaTaxonomyProjectionCase = {
  readonly label: string
  readonly path: SchemaPath
  readonly expected: readonly string[]
}

export type ProfileArtifactSchemaRejectionCase = {
  readonly label: string
  readonly createPayload: (profile: DpmProfileArtifact) => unknown
}

export type ProfileArtifactSchemaIssueCase = {
  readonly label: string
  readonly createPayload: (profile: DpmProfileArtifact) => unknown
  readonly expectedInstancePathFragment: string
}

export const profileArtifactSchemaTaxonomyProjectionCases = [
  {
    label: 'source kinds',
    path: ['properties', 'sources', 'items', 'properties', 'kind', 'enum'],
    expected: DPM_PROFILE_SOURCE_KINDS,
  },
  {
    label: 'source capture modes',
    path: ['properties', 'sources', 'items', 'properties', 'captureMode', 'enum'],
    expected: DPM_PROFILE_CAPTURE_MODES,
  },
  {
    label: 'node kinds',
    path: ['properties', 'nodes', 'items', 'properties', 'kind', 'enum'],
    expected: DPM_PROFILE_NODE_KINDS,
  },
  {
    label: 'edge kinds',
    path: ['properties', 'edges', 'items', 'properties', 'kind', 'enum'],
    expected: DPM_PROFILE_EDGE_KINDS,
  },
  {
    label: 'metric kinds',
    path: ['properties', 'metrics', 'items', 'properties', 'kind', 'enum'],
    expected: DPM_PROFILE_METRIC_KINDS,
  },
] as const satisfies readonly ProfileArtifactSchemaTaxonomyProjectionCase[]

export const profileArtifactSchemaRejectionCases = [
  {
    label: 'unknown source kind',
    createPayload: (profile) => ({
      ...profile,
      sources: [{ ...profile.sources[0]!, kind: 'unknown_source' }],
    }),
  },
  {
    label: 'node without coordinate provenance',
    createPayload: (profile) => ({
      ...profile,
      nodes: [{ id: 'node:field:missing-provenance', kind: 'message_field', label: 'missing' }],
    }),
  },
  {
    label: 'raw sample payload field',
    createPayload: (profile) => ({
      ...profile,
      rawSample: { customer_no: 'C-001' },
    }),
  },
] as const satisfies readonly ProfileArtifactSchemaRejectionCase[]

export const profileArtifactSchemaIssueCases = [
  {
    label: 'empty metric id',
    createPayload: (profile) => ({
      ...profile,
      metrics: [{ id: '', kind: 'presence_ratio', subjectId: 'node:key:orders.created', value: 1 }],
    }),
    expectedInstancePathFragment: '/metrics/0/id',
  },
] as const satisfies readonly ProfileArtifactSchemaIssueCase[]
