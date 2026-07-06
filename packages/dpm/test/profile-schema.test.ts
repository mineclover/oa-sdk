import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_SCHEMA,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  normalizeDpmProfileArtifact,
} from '../src/index.js'
import { createKafkaProfileInput } from './support/profile-artifact-kafka-inputs.js'

function compileProfileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  return ajv.compile(DPM_PROFILE_ARTIFACT_SCHEMA)
}

describe('DPM profile artifact JSON Schema contract', () => {
  it('projects runtime profile taxonomies into the JSON Schema contract', () => {
    const schema = DPM_PROFILE_ARTIFACT_SCHEMA as any

    expect(schema.properties.sources.items.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(schema.properties.nodes.items.properties.kind.enum).toEqual([...DPM_PROFILE_NODE_KINDS])
    expect(schema.properties.edges.items.properties.kind.enum).toEqual([...DPM_PROFILE_EDGE_KINDS])
    expect(schema.properties.metrics.items.properties.kind.enum).toEqual([...DPM_PROFILE_METRIC_KINDS])
  })

  it('rejects unknown taxonomy values, missing provenance, and raw sample payload fields', () => {
    const validate = compileProfileSchema()
    const profile = normalizeDpmProfileArtifact(createKafkaProfileInput())

    expect(validate({
      ...profile,
      sources: [{ ...profile.sources[0], kind: 'unknown_source' }],
    }), 'profile unexpectedly accepted an unknown source kind').toBe(false)
    expect(validate({
      ...profile,
      nodes: [{ id: 'node:field:missing-provenance', kind: 'message_field', label: 'missing' }],
    }), 'profile unexpectedly accepted a node without a coordinate').toBe(false)
    expect(validate({
      ...profile,
      rawSample: { customer_no: 'C-001' },
    }), 'profile unexpectedly accepted a raw sample payload').toBe(false)
  })

})
