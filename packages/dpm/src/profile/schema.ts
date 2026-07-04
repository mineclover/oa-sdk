import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'

import { DPM_PROFILE_ARTIFACT_SCHEMA } from './schema-document.js'

export {
  DPM_PROFILE_ARTIFACT_SCHEMA,
  DPM_PROFILE_ARTIFACT_SCHEMA_ID,
} from './schema-document.js'

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
