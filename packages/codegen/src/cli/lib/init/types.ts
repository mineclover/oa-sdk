import type { ProductLifecycleArchetype } from '../../../config.js'
import type {
  OaSdkPackageName,
  OaSdkPackageSources,
  UnavailableOaSdkPackage,
  UninstallableOaSdkEntry,
} from './oa-sdk-packages.js'

export type TargetFrameworkId =
  | 'fastify'
  | 'elysia'
  | 'hono'
  | 'express'
  | 'nestjs'
  | 'generic'

export type TargetRuntime = 'node' | 'bun'

export interface TargetDetectionResult {
  confidence: number // 0.0 to 1.0
  matchedMarkers: string[]
  detectedRuntime: TargetRuntime
  details?: Record<string, unknown> | undefined
}

export interface RecommendedDependencies {
  dependencies?: Record<string, string> | undefined
  devDependencies: Record<string, string>
  /**
   * `@oa-sdk` packages to add as dev dependencies, named without a specifier:
   * which specifier installs them depends on where the project lives, so
   * `composeInitDependencies` resolves them (see oa-sdk-packages.ts).
   */
  oaSdkDevDependencies?: readonly OaSdkPackageName[] | undefined
}

export interface DetectedSchemaItem {
  type: 'typespec' | 'openapi-yaml' | 'openapi-json' | 'jsdoc-operations'
  filePath: string
  confidence: number
  description: string
  kind?: 'typespec' | 'openapi-yaml' | 'openapi-json' | 'oa-operation' | undefined
  path?: string | undefined
  relativePath?: string | undefined
  score?: number | undefined
  title?: string | undefined
  version?: string | undefined
  operationsCount?: number | undefined
}

export type OutputRoutingPreset = 'default' | 'fsd' | 'monorepo' | 'by-kind'

export interface TargetGenerateOptions {
  cwd: string
  frameworkId: TargetFrameworkId
  runtime: TargetRuntime
  detectedSchema?: DetectedSchemaItem | undefined
  projectName?: string | undefined
  packageJson?: Record<string, unknown> | undefined
  force?: boolean | undefined
  routing?: OutputRoutingPreset | undefined
  /** Where the project installs `@oa-sdk` packages from; the registry when omitted. */
  oaSdkSources?: OaSdkPackageSources | undefined
}

export interface TargetProfile {
  readonly id: TargetFrameworkId
  readonly displayName: string
  readonly description: string
  readonly defaultRuntime: TargetRuntime
  detect(cwd: string): Promise<TargetDetectionResult>
  generateConfig(options: TargetGenerateOptions): Promise<string>
  getRecommendedScripts(options: TargetGenerateOptions): Record<string, string>
  getRecommendedDependencies(options: TargetGenerateOptions): RecommendedDependencies
}

export interface PatchAction<T = string> {
  key: string
  before?: T | undefined
  after: T
  action: 'added' | 'updated' | 'skipped' | 'unchanged'
  reason?: string | undefined
}

export interface PackagePatchResult {
  patchedContent: string
  modified: boolean
  scripts: PatchAction[]
  dependencies: PatchAction[]
  devDependencies: PatchAction[]
  indentation: string
  lineEnding: '\n' | '\r\n'
  filePath?: string | undefined
}

export interface PackagePatchOptions {
  scripts?: Record<string, string> | undefined
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
  force?: boolean | undefined
  dryRun?: boolean | undefined
}

export type LifecycleArchetypeId = ProductLifecycleArchetype

export interface InitOptions {
  target?: string | undefined
  archetype?: string | undefined
  routing?: string | undefined
  cwd?: string | undefined
  spec?: string | undefined
  yes?: boolean | undefined
  force?: boolean | undefined
  dryRun?: boolean | undefined
  interactive?: boolean | undefined
}

export interface InitResult {
  targetId: TargetFrameworkId
  archetypeId: LifecycleArchetypeId
  routing?: OutputRoutingPreset | undefined
  runtime: TargetRuntime
  configPath: string
  patchResult?: PackagePatchResult | undefined
  detectedSchema?: DetectedSchemaItem | undefined
  configFileCreated?: boolean | undefined
  packageJsonPatched?: boolean | undefined
  packageJsonPath?: string | undefined
  /** `@oa-sdk` packages the scaffold uses that init does not add to package.json, because the project cannot install them. */
  unavailablePackages?: UnavailableOaSdkPackage[] | undefined
  /**
   * `@oa-sdk` entries package.json has (after the patch) that the project cannot install where it
   * lives, such as `workspace:*` entries an earlier init wrote outside a workspace.
   */
  uninstallableEntries?: UninstallableOaSdkEntry[] | undefined
  dryRun?: boolean | undefined
}
