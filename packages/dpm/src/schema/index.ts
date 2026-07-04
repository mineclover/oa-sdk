import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js'

import dpmManifestSchema from './dpm-manifest.schema.json'

export const DPM_MANIFEST_SCHEMA_ID = 'https://oa-sdk.dev/schemas/dpm-manifest.v1.json' as const

export type DpmManifestSchemaIssue = {
  instancePath: string
  schemaPath: string
  keyword: string
  message: string
}

export type DpmManifestSchemaValidationResult = {
  valid: boolean
  issues: DpmManifestSchemaIssue[]
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateDpmManifestSchemaDocument = ajv.compile(dpmManifestSchema)

export function validateDpmManifestSchema(manifest: unknown): DpmManifestSchemaValidationResult {
  const valid = validateDpmManifestSchemaDocument(manifest)
  if (valid) {
    return {
      valid: true,
      issues: [],
    }
  }

  return {
    valid: false,
    issues: (validateDpmManifestSchemaDocument.errors ?? []).map(toDpmManifestSchemaIssue),
  }
}

function toDpmManifestSchemaIssue(error: ErrorObject): DpmManifestSchemaIssue {
  return {
    instancePath: error.instancePath || '/',
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: formatSchemaMessage(error),
  }
}

function formatSchemaMessage(error: ErrorObject): string {
  const message = error.message ?? 'failed JSON Schema validation'
  const missingProperty = typeof error.params?.missingProperty === 'string'
    ? `: ${error.params.missingProperty}`
    : ''
  return `DPM manifest schema ${message}${missingProperty}.`
}
