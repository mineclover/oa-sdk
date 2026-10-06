/**
 * Schema Pipeline Types & Transparency Manifest Data Structures
 * (4-Stage Deterministic Lifecycle)
 *
 * 1. Zod Master Schema ->
 * 2. JSON Schema Draft 2020-12 ->
 * 3. OpenAPI document (3.1.0 from a Zod module; a spec file keeps its own `openapi` version) ->
 * 4. TypeScript Type Guards using AJV
 */

export interface SchemaStage1ZodInfo {
  name: string
  sourceFile: string
  propertyCount: number
  hasDiscriminator: boolean
  properties: string[]
}

export interface SchemaStage2JsonSchemaInfo {
  id: string
  path: string
  contentHash: string
  dialect: string
  defsCount: number
  defs: string[]
}

export interface SchemaStage3OpenApiInfo {
  id: string
  path: string
  profile: string
  /** OpenAPI version the projected document declares in its `openapi` field (`3.1.0` when it declares none). */
  specVersion: string
  versionHash: string
  schemaCount: number
  operationCount: number
  refsCount: number
  schemas: string[]
}

export interface SchemaStage4GuardInfo {
  id: string
  outDir: string
  files: string[]
  guardNames: string[]
  fastPathCount: number
  dispatchCount: number
  zeroEvalCsp: boolean
}

export interface SchemaPipelineTransparencyManifest {
  version: 1
  generatedAt: string
  rootDir: string
  stages: {
    stage1_zodMaster: {
      schemaCount: number
      schemas: SchemaStage1ZodInfo[]
    }
    stage2_jsonSchema202012: {
      dialect: 'https://json-schema.org/draft/2020-12/schema'
      bundles: SchemaStage2JsonSchemaInfo[]
    }
    /** OpenAPI documents of the run. The key keeps its original name for compatibility; the documents need not be 3.1. */
    stage3_openApi31: {
      /**
       * OpenAPI versions of `specs`: their distinct `specVersion` values in
       * target order, joined with `", "` (`"3.2.0"`, or `"3.1.0, 3.2.0"` when
       * the targets' documents differ). Empty when there are no specs.
       */
      specVersion: string
      specs: SchemaStage3OpenApiInfo[]
    }
    stage4_typeGuards: {
      generator: 'ajv/dist/standalone'
      guards: SchemaStage4GuardInfo[]
    }
  }
  summary: {
    totalSchemas: number
    allStagesAligned: boolean
    zeroEvalCspCompliant: boolean
    provenanceComplete: boolean
  }
}

export interface SchemaPipelineRunOptions {
  rootDir?: string | undefined
  configPath?: string | undefined
  writeFiles?: boolean | undefined
  auditCsp?: boolean | undefined
  tiered?: boolean | undefined
  polymorphicDispatch?: boolean | undefined
}
