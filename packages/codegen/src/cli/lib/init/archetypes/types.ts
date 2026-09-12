import type {
  TargetFrameworkId,
  TargetRuntime,
  RecommendedDependencies,
  DetectedSchemaItem,
  LifecycleArchetypeId,
} from '../types.js'
import type { OaConfig } from '../../../../config.js'

export type { LifecycleArchetypeId }

export interface ArchetypeDetectionResult {
  confidence: number // 0.0 to 1.0
  matchedMarkers: string[]
  details?: Record<string, unknown> | undefined
}

export interface ArchetypeGenerateOptions {
  cwd: string
  frameworkId: TargetFrameworkId
  runtime: TargetRuntime
  archetypeId: LifecycleArchetypeId
  detectedSchema?: DetectedSchemaItem | undefined
  projectName?: string | undefined
  packageJson?: Record<string, unknown> | undefined
}

export interface ArchetypeConfigSnippet {
  /** Top-level configuration additions for oa.config.ts */
  rootFields: Record<string, unknown>
  /** Spec target overrides or additions */
  specFields?: Record<string, unknown> | undefined
}

export interface ArchetypeProfile {
  readonly id: LifecycleArchetypeId
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly summaryBullet: string

  /** Heuristic detection of archetype maturity from repo markers */
  detect(cwd: string, detectedSchema?: DetectedSchemaItem): Promise<ArchetypeDetectionResult>

  /** Returns configuration snippet to merge into oa.config.ts */
  getArchetypeConfig(options: ArchetypeGenerateOptions): ArchetypeConfigSnippet

  /** Returns partial OaConfig representation of the archetype */
  generateConfigFragment(options: ArchetypeGenerateOptions): Partial<OaConfig>

  /** Returns lifecycle-specific scripts tailored to runtime (bun vs node) */
  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string>

  /** Returns lifecycle-specific dependencies */
  getRecommendedDependencies(options: ArchetypeGenerateOptions): RecommendedDependencies
}
