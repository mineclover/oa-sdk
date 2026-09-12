/**
 * Init Harness
 * Re-exports genuine Target-Separated Onboarding Engine implementations from @oa-sdk/codegen
 */
export {
  TARGET_PROFILES,
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
  detectSchemas,
  patchPackageJson,
  runInit,
  getTargetProfile,
  detectTargetProfile,
} from '../../../../packages/codegen/src/cli/lib/init/index.js'

export type {
  TargetFrameworkId,
  TargetRuntime,
  TargetDetectionResult,
  RecommendedDependencies,
  TargetGenerateOptions,
  TargetProfile,
  DetectedSchemaItem,
  PatchAction,
  PackagePatchResult,
  PackagePatchOptions,
  InitOptions,
  InitResult,
} from '../../../../packages/codegen/src/cli/lib/init/index.js'
