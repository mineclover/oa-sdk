export const OPENAPI_PROJECTION_PROFILES = [
  'component-bundle',
  'operation-contract',
  'full-api-document',
] as const

export type OpenApiProjectionProfile = typeof OPENAPI_PROJECTION_PROFILES[number]

export type OpenApiProjectionProfileSemantics = {
  profile: OpenApiProjectionProfile
  summary: string
  paths: {
    rule: 'may-be-empty' | 'requires-operation' | 'standard-openapi'
    description: string
  }
  components: {
    schemas: 'required' | 'standard-openapi'
    description: string
  }
  validation: {
    rule: 'profile-specific' | 'standard-openapi-document'
    description: string
  }
}

export const OPENAPI_PROJECTION_PROFILE_SEMANTICS = {
  'component-bundle': {
    profile: 'component-bundle',
    summary: 'Reusable schema components without requiring an API surface.',
    paths: {
      rule: 'may-be-empty',
      description: 'paths may be absent or empty because the projection is a schema component bundle.',
    },
    components: {
      schemas: 'required',
      description: 'components.schemas must be present so validators have schema material to consume.',
    },
    validation: {
      rule: 'profile-specific',
      description: 'OpenAPI document validation is relaxed only for the empty paths shape and tightened for schema components.',
    },
  },
  'operation-contract': {
    profile: 'operation-contract',
    summary: 'One or more request/response contracts represented as OpenAPI operations.',
    paths: {
      rule: 'requires-operation',
      description: 'paths must contain at least one operation object under a path item.',
    },
    components: {
      schemas: 'standard-openapi',
      description: 'components.schemas may be present when operations reference reusable schemas.',
    },
    validation: {
      rule: 'profile-specific',
      description: 'OpenAPI document validation is combined with the requirement that paths contain at least one operation.',
    },
  },
  'full-api-document': {
    profile: 'full-api-document',
    summary: 'A complete OpenAPI document intended to pass normal OpenAPI document validation.',
    paths: {
      rule: 'standard-openapi',
      description: 'paths follow the normal OpenAPI document rules without projection-specific relaxation.',
    },
    components: {
      schemas: 'standard-openapi',
      description: 'components.schemas follow the normal OpenAPI document rules.',
    },
    validation: {
      rule: 'standard-openapi-document',
      description: 'validators should apply normal OpenAPI document validation for this profile.',
    },
  },
} as const satisfies Record<OpenApiProjectionProfile, OpenApiProjectionProfileSemantics>

export function isOpenApiProjectionProfile(value: unknown): value is OpenApiProjectionProfile {
  return typeof value === 'string' && (OPENAPI_PROJECTION_PROFILES as readonly string[]).includes(value)
}

export function getOpenApiProjectionProfileSemantics(
  profile: OpenApiProjectionProfile,
): OpenApiProjectionProfileSemantics {
  return OPENAPI_PROJECTION_PROFILE_SEMANTICS[profile]
}

export type SchemaSourceCoordinate =
  | {
      kind: 'file'
      filePath: string
      pointer: string
      line?: number
      column?: number
    }
  | {
      kind: 'db'
      entity: string
      id: string
      pointer: string
    }

export type SchemaRefEdge = {
  from: string
  to?: string
  ref: string
  kind: string
  source: SchemaSourceCoordinate
}

export type SchemaDiagnostic = {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  source?: SchemaSourceCoordinate
}

export type SchemaValidateResult = {
  valid: boolean
  diagnostics: SchemaDiagnostic[]
}

export type SchemaTypeTarget = {
  id: string
  name: string
  kind: string
  source?: SchemaSourceCoordinate
}

export type OpenApiProjectionResult<TProjection extends object = { openapi: string }> = {
  profile: OpenApiProjectionProfile
  projection: TProjection
  refs: SchemaRefEdge[]
  diagnostics: SchemaDiagnostic[]
  sources: Record<string, SchemaSourceCoordinate>
  versionHash: string
  typeTargets?: SchemaTypeTarget[]
}
