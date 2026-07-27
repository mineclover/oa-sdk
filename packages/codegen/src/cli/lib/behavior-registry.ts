import { z } from 'zod'
import {
  validateBuildOpenApiTargetComponents,
  validateSyncRuntimeOpenApiComponents,
} from './build-runtime-behavior-validation.js'
import {
  issue,
  readBoolean,
  readDecisionSignal,
  readNullableBoolean,
  readNullableNumber,
  readNumber,
  readSidecarPairState,
  readString,
  validateCrossStringField,
  validateSameStringField,
} from './behavior-validation-utils.js'
import { validateReviewBehaviorComponents } from './review-behavior-validation.js'

export type BehaviorRegistryComponents = {
  target?: Record<string, unknown> | undefined
  result?: Record<string, unknown> | undefined
  decision?: Record<string, unknown> | undefined
  input?: Record<string, unknown> | undefined
  context?: Record<string, unknown> | undefined
}

export type BehaviorProjectionPolicy = {
  latestByType: boolean
  latestByIdentity: boolean
  latestByTarget: boolean
  latestByDecisionSignal: boolean
  latestFailureByType: boolean
  latestByRecommendation: boolean
}

export type BehaviorTypeComponentSchemas = {
  input?: z.ZodTypeAny
  target?: z.ZodTypeAny
  decision?: z.ZodTypeAny
  result?: z.ZodTypeAny
}

export type BehaviorRegistryValidationIssue = {
  path: string
  message: string
}

export type BehaviorTypeDefinition = {
  componentSchemas?: BehaviorTypeComponentSchemas
  buildIdentityParts?: (
    components: BehaviorRegistryComponents,
  ) => Record<string, string> | undefined
  projectionPolicy?: Partial<BehaviorProjectionPolicy>
  validateComponents?: (
    components: BehaviorRegistryComponents,
  ) => BehaviorRegistryValidationIssue[]
}

const behaviorRecommendationSchema = z.enum([
  'APPROVE',
  'COMMENT',
  'REQUEST_CHANGES',
])
const nonNegativeInt = z.number().int().nonnegative()
const nullableNonNegativeInt = z.number().int().nonnegative().nullable()
const nullableBoolean = z.boolean().nullable()

const buildOpenApiTargetTargetSchema = z.object({
  targetType: z.literal('definition-target'),
  targetKey: z.string().min(1),
  targetPath: z.string().min(1),
  targetName: z.string().min(1).optional(),
}).passthrough()

const buildOpenApiTargetInputSchema = z.object({
  targetPath: z.string().min(1),
  fragmentsDir: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  diagnosticsPath: z.string().min(1).optional(),
  collisionReportPath: z.string().min(1).optional(),
  compositionReportPath: z.string().min(1).optional(),
  provenancePath: z.string().min(1).optional(),
  metadataRegistryPath: z.string().min(1).optional(),
}).passthrough()

const buildOpenApiTargetResultSchema = z.object({
  valid: z.boolean(),
  fragmentCount: nonNegativeInt,
  selectedNodeCount: nonNegativeInt,
  errors: nonNegativeInt,
  warnings: nonNegativeInt,
  infos: nonNegativeInt,
  errorCodes: z.array(z.string().min(1)),
  outputPath: z.string().min(1).optional(),
}).passthrough().or(z.object({
  valid: z.literal(false),
  errorMessage: z.string().min(1),
}).passthrough())

const buildOpenApiTargetDecisionSchema = z.object({
  primarySignal: z.enum(['build-valid', 'build-invalid', 'build-exception']),
  decisionReason: z.string().min(1),
}).passthrough()

const reviewOpenApiChangeTargetSchema = z.object({
  targetType: z.literal('openapi-review'),
  targetKey: z.string().min(1),
  basePath: z.string().min(1),
  headPath: z.string().min(1),
  targetPath: z.string().min(1).optional(),
}).passthrough()

const reviewOpenApiChangeInputSchema = z.object({
  basePath: z.string().min(1),
  headPath: z.string().min(1),
  artifactPath: z.string().min(1).optional(),
  targetPath: z.string().min(1).optional(),
  fragmentsDir: z.string().min(1).optional(),
  baseProvenancePath: z.string().min(1).optional(),
  headProvenancePath: z.string().min(1).optional(),
  baseMetadataRegistryPath: z.string().min(1).optional(),
  headMetadataRegistryPath: z.string().min(1).optional(),
}).passthrough()

const reviewOpenApiChangeResultSchema = z.object({
  recommendation: behaviorRecommendationSchema,
  reasonCount: nonNegativeInt,
  reasons: z.array(z.string().min(1)),
  breakingChanges: nonNegativeInt,
  nonBreakingChanges: nonNegativeInt,
  validationErrors: nonNegativeInt,
  validationWarnings: nonNegativeInt,
  validationInfos: nonNegativeInt,
  artifactChecked: z.boolean(),
  artifactFresh: nullableBoolean,
  provenanceChecked: z.boolean(),
  provenanceChanges: nullableNonNegativeInt,
  metadataRegistryChecked: z.boolean(),
  metadataRegistryChanges: nullableNonNegativeInt,
  checksIncomplete: z.boolean(),
}).passthrough().or(z.object({
  errorMessage: z.string().min(1),
}).passthrough())

const reviewOpenApiChangeDecisionSchema = z.object({
  primarySignal: z.enum(['approve', 'comment', 'request-changes', 'exception']),
  decisionReason: z.string().min(1),
}).passthrough()

const syncRuntimeOpenApiTargetSchema = z.object({
  targetType: z.literal('runtime-openapi'),
  targetKey: z.string().min(1),
  managedPath: z.string().min(1),
  runtimePath: z.string().min(1).optional(),
  runtimeSource: z.string().min(1).optional(),
}).refine(
  value => value.runtimePath !== undefined || value.runtimeSource !== undefined,
  { message: 'runtimePath or runtimeSource is required' },
).passthrough()

const syncRuntimeOpenApiInputSchema = z.object({
  managedPath: z.string().min(1),
  runtimePath: z.string().min(1).optional(),
  runtimeUrl: z.string().min(1).optional(),
  runtimeHeaders: z.array(z.string().min(1)).optional(),
}).refine(
  value => value.runtimePath !== undefined || value.runtimeUrl !== undefined,
  { message: 'runtimePath or runtimeUrl is required' },
).passthrough()

const syncRuntimeOpenApiResultSchema = z.object({
  drift: z.boolean().optional(),
  status: z.enum(['ok', 'drift-check-failed']).optional(),
  issueCount: nonNegativeInt.optional(),
  issueKinds: z.array(z.string().min(1)).optional(),
  failureCode: z.string().min(1).optional(),
  failureMessage: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
}).passthrough()

const syncRuntimeOpenApiDecisionSchema = z.object({
  primarySignal: z.enum(['no-drift', 'drift-detected', 'fetch-failure', 'runtime-error']),
  decisionReason: z.string().min(1),
}).passthrough()

const publishReviewBundleTargetSchema = z.object({
  targetType: z.literal('review-bundle'),
  targetKey: z.string().min(1),
  basePath: z.string().min(1),
  headPath: z.string().min(1),
  artifactPath: z.string().min(1),
}).passthrough()

const publishReviewBundleInputSchema = z.object({
  basePath: z.string().min(1),
  headPath: z.string().min(1),
  artifactPath: z.string().min(1),
  runtimeDriftPath: z.string().min(1).optional(),
  baseProvenancePath: z.string().min(1).optional(),
  headProvenancePath: z.string().min(1).optional(),
  compositionPath: z.string().min(1).optional(),
  metadataRegistryPath: z.string().min(1).optional(),
  baseMetadataRegistryPath: z.string().min(1).optional(),
  headMetadataRegistryPath: z.string().min(1).optional(),
  duplicateReviewPath: z.string().min(1).optional(),
  typeSpecProvenancePath: z.string().min(1).optional(),
  ttscProvenancePath: z.string().min(1).optional(),
  includeInventory: z.boolean(),
}).passthrough()

const publishReviewBundleResultSchema = z.object({
  recommendation: behaviorRecommendationSchema,
  reasonCount: nonNegativeInt,
  reasons: z.array(z.string().min(1)),
  breakingChanges: nonNegativeInt,
  nonBreakingChanges: nonNegativeInt,
  artifactChecked: z.boolean(),
  artifactFresh: nullableBoolean,
  runtimeDriftIncluded: z.boolean(),
  runtimeDrift: nullableBoolean,
  provenanceChecked: z.boolean(),
  provenanceChanges: nullableNonNegativeInt,
  inventoryIncluded: z.boolean(),
  compositionIncluded: z.boolean(),
  metadataRegistryIncluded: z.boolean(),
  metadataRegistryChecked: z.boolean(),
  metadataRegistryValid: z.boolean().nullable(),
  metadataRegistryChanges: nullableNonNegativeInt,
  duplicateReviewIncluded: z.boolean(),
  duplicateReviewValid: z.boolean().nullable(),
  // Older persisted review-bundle behavior records predate this observational
  // section. New command output always sets it; retain read compatibility.
  parallelEvidenceIncluded: z.boolean().optional(),
  checksIncomplete: z.boolean(),
}).passthrough().or(z.object({
  errorMessage: z.string().min(1),
}).passthrough())

const publishReviewBundleDecisionSchema = z.object({
  primarySignal: z.enum(['approve', 'comment', 'request-changes', 'exception']),
  decisionReason: z.string().min(1),
}).passthrough()

const defaultBehaviorProjectionPolicy: BehaviorProjectionPolicy = {
  latestByType: true,
  latestByIdentity: true,
  latestByTarget: true,
  latestByDecisionSignal: true,
  latestFailureByType: true,
  latestByRecommendation: true,
}

function identityPartsFromTarget(
  components: BehaviorRegistryComponents,
): Record<string, string> | undefined {
  const targetType = components.target?.targetType
  const targetKey = components.target?.targetKey
  if (typeof targetType !== 'string' || typeof targetKey !== 'string') return undefined
  return {
    targetKey,
    targetType,
  }
}

function validateReviewOpenApiChangeComponents(
  components: BehaviorRegistryComponents,
): BehaviorRegistryValidationIssue[] {
  const issues = validateReviewBehaviorComponents({
    commandName: 'review',
    components,
  })
  issues.push(
    ...validateSameStringField(components, 'basePath'),
  )
  const inputTargetPath = readString(components.input, 'targetPath')
  const targetTargetPath = readString(components.target, 'targetPath')
  if (inputTargetPath !== undefined || targetTargetPath !== undefined) {
    issues.push(
      ...validateSameStringField(components, 'targetPath'),
    )
  }
  const targetBasePath = readString(components.target, 'basePath')
  const targetHeadPath = readString(components.target, 'headPath')
  const targetKey = readString(components.target, 'targetKey')
  if (targetBasePath !== undefined && targetHeadPath !== undefined && targetKey !== `${targetBasePath}|${targetHeadPath}`) {
    issues.push(issue(
      'components.target.targetKey',
      'review targetKey must match basePath|headPath',
    ))
  }
  return issues
}

function validatePublishReviewBundleComponents(
  components: BehaviorRegistryComponents,
): BehaviorRegistryValidationIssue[] {
  const issues = validateReviewBehaviorComponents({
    commandName: 'review-bundle',
    components,
  })
  const basePath = readString(components.target, 'basePath')
  const headPath = readString(components.target, 'headPath')
  const artifactPath = readString(components.target, 'artifactPath')
  const targetKey = readString(components.target, 'targetKey')
  if (
    targetKey !== undefined
    && basePath !== undefined
    && headPath !== undefined
    && artifactPath !== undefined
    && targetKey !== `${basePath}|${headPath}|${artifactPath}`
  ) {
    issues.push(issue(
      'components.target.targetKey',
      'review-bundle targetKey must match basePath|headPath|artifactPath',
    ))
  }

  issues.push(
    ...validateSameStringField(components, 'basePath'),
    ...validateSameStringField(components, 'headPath'),
    ...validateSameStringField(components, 'artifactPath'),
  )
  const hasArtifactPath = readString(components.input, 'artifactPath') !== undefined
  if (readBoolean(components.result, 'artifactChecked') !== hasArtifactPath) {
    issues.push(issue(
      'components.result.artifactChecked',
      'review-bundle result.artifactChecked must reflect artifactPath presence',
    ))
  }
  const hasRuntimeDrift = readString(components.input, 'runtimeDriftPath') !== undefined
  if (readBoolean(components.result, 'runtimeDriftIncluded') !== hasRuntimeDrift) {
    issues.push(issue(
      'components.result.runtimeDriftIncluded',
      'review-bundle result.runtimeDriftIncluded must reflect runtimeDriftPath presence',
    ))
  }
  const provenanceState = readSidecarPairState(components, 'baseProvenancePath', 'headProvenancePath')
  if (readBoolean(components.result, 'provenanceChecked') !== (provenanceState === 'complete')) {
    issues.push(issue(
      'components.result.provenanceChecked',
      'review-bundle result.provenanceChecked must reflect provenance sidecar completeness',
    ))
  }
  const includeInventory = readBoolean(components.input, 'includeInventory')
  if (includeInventory !== undefined && readBoolean(components.result, 'inventoryIncluded') !== includeInventory) {
    issues.push(issue(
      'components.result.inventoryIncluded',
      'review-bundle result.inventoryIncluded must match input.includeInventory',
    ))
  }
  const hasComposition = readString(components.input, 'compositionPath') !== undefined
  if (hasComposition !== readBoolean(components.result, 'compositionIncluded')) {
    issues.push(issue(
      'components.result.compositionIncluded',
      'review-bundle result.compositionIncluded must reflect compositionPath presence',
    ))
  }
  const hasMetadataRegistry = readString(components.input, 'metadataRegistryPath') !== undefined
  if (hasMetadataRegistry !== readBoolean(components.result, 'metadataRegistryIncluded')) {
    issues.push(issue(
      'components.result.metadataRegistryIncluded',
      'review-bundle result.metadataRegistryIncluded must reflect metadataRegistryPath presence',
    ))
  }
  const metadataState = readSidecarPairState(components, 'baseMetadataRegistryPath', 'headMetadataRegistryPath')
  if (readBoolean(components.result, 'metadataRegistryChecked') !== (metadataState === 'complete')) {
    issues.push(issue(
      'components.result.metadataRegistryChecked',
      'review-bundle result.metadataRegistryChecked must reflect metadata registry sidecar completeness',
    ))
  }
  if (hasMetadataRegistry && readNullableBoolean(components.result, 'metadataRegistryValid') === null) {
    issues.push(issue(
      'components.result.metadataRegistryValid',
      'review-bundle with metadataRegistryPath requires result.metadataRegistryValid',
    ))
  }
  if (!hasMetadataRegistry && readNullableBoolean(components.result, 'metadataRegistryValid') !== null) {
    issues.push(issue(
      'components.result.metadataRegistryValid',
      'review-bundle without metadataRegistryPath requires result.metadataRegistryValid=null',
    ))
  }
  const hasDuplicateReview = readString(components.input, 'duplicateReviewPath') !== undefined
  if (readBoolean(components.result, 'duplicateReviewIncluded') !== hasDuplicateReview) {
    issues.push(issue(
      'components.result.duplicateReviewIncluded',
      'review-bundle result.duplicateReviewIncluded must reflect duplicateReviewPath presence',
    ))
  }
  if (!hasRuntimeDrift && readNullableBoolean(components.result, 'runtimeDrift') !== null) {
    issues.push(issue(
      'components.result.runtimeDrift',
      'review-bundle without runtimeDriftPath requires result.runtimeDrift=null',
    ))
  }
  if (!hasDuplicateReview && readNullableBoolean(components.result, 'duplicateReviewValid') !== null) {
    issues.push(issue(
      'components.result.duplicateReviewValid',
      'review-bundle without duplicateReviewPath requires result.duplicateReviewValid=null',
    ))
  }
  return issues
}

const behaviorTypeRegistry = {
  build_openapi_target: {
    componentSchemas: {
      input: buildOpenApiTargetInputSchema,
      target: buildOpenApiTargetTargetSchema,
      decision: buildOpenApiTargetDecisionSchema,
      result: buildOpenApiTargetResultSchema,
    },
    buildIdentityParts: identityPartsFromTarget,
    projectionPolicy: {
      latestByRecommendation: false,
    },
    validateComponents: validateBuildOpenApiTargetComponents,
  },
  review_openapi_change: {
    componentSchemas: {
      input: reviewOpenApiChangeInputSchema,
      target: reviewOpenApiChangeTargetSchema,
      decision: reviewOpenApiChangeDecisionSchema,
      result: reviewOpenApiChangeResultSchema,
    },
    buildIdentityParts: identityPartsFromTarget,
    validateComponents: validateReviewOpenApiChangeComponents,
  },
  sync_runtime_openapi: {
    componentSchemas: {
      input: syncRuntimeOpenApiInputSchema,
      target: syncRuntimeOpenApiTargetSchema,
      decision: syncRuntimeOpenApiDecisionSchema,
      result: syncRuntimeOpenApiResultSchema,
    },
    buildIdentityParts: identityPartsFromTarget,
    projectionPolicy: {
      latestByRecommendation: false,
    },
    validateComponents: validateSyncRuntimeOpenApiComponents,
  },
  publish_review_bundle: {
    componentSchemas: {
      input: publishReviewBundleInputSchema,
      target: publishReviewBundleTargetSchema,
      decision: publishReviewBundleDecisionSchema,
      result: publishReviewBundleResultSchema,
    },
    buildIdentityParts: identityPartsFromTarget,
    validateComponents: validatePublishReviewBundleComponents,
  },
} as const satisfies Record<string, BehaviorTypeDefinition>

export function getBehaviorTypeDefinition(
  behaviorType: string,
): BehaviorTypeDefinition | undefined {
  return behaviorTypeRegistry[behaviorType as keyof typeof behaviorTypeRegistry]
}

export function readBehaviorComponentSchemas(
  behaviorType: string,
): BehaviorTypeComponentSchemas | undefined {
  return getBehaviorTypeDefinition(behaviorType)?.componentSchemas
}

export function readBehaviorProjectionPolicy(
  behaviorType: string,
): BehaviorProjectionPolicy {
  return {
    ...defaultBehaviorProjectionPolicy,
    ...getBehaviorTypeDefinition(behaviorType)?.projectionPolicy,
  }
}

export function resolveBehaviorIdentityParts(
  behaviorType: string,
  components: BehaviorRegistryComponents,
): Record<string, string> | undefined {
  return getBehaviorTypeDefinition(behaviorType)?.buildIdentityParts?.(components)
}

export function validateBehaviorRegistryComponents(
  behaviorType: string,
  components: BehaviorRegistryComponents,
): BehaviorRegistryValidationIssue[] {
  return getBehaviorTypeDefinition(behaviorType)?.validateComponents?.(components) ?? []
}
