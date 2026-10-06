import type {
  TargetFrameworkId,
  TargetRuntime,
  RecommendedDependencies,
  DetectedSchemaItem,
  LifecycleArchetypeId,
} from '../types.js'
import type { OaConfig } from '../../../../config.js'
import type { ContractBaselinePlan, ContractBaselineSkip } from '../common/contract-baseline.js'

export type { LifecycleArchetypeId, ContractBaselinePlan, ContractBaselineSkip }

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
  /** See `TargetGenerateOptions.specEntryUnavailable`. */
  specEntryUnavailable?: string | undefined
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

  /**
   * Returns lifecycle-specific scripts tailored to runtime (bun vs node). Each must run as written
   * in the scaffold: an `oa-gen` command with options it declares and reads, on files the scaffold
   * has (the spec, oa.config.ts, and what `getContractBaseline` creates).
   */
  getRecommendedScripts(options: ArchetypeGenerateOptions): Record<string, string>

  /**
   * The contract baseline the archetype's scripts compare the spec with, which `oa-gen init`
   * creates from the spec when the project has none, or why the archetype adds neither it nor
   * those scripts; omitted by archetypes without such scripts.
   */
  getContractBaseline?(options: ArchetypeGenerateOptions): ContractBaselinePlan | ContractBaselineSkip

  /** Returns lifecycle-specific dependencies */
  getRecommendedDependencies(options: ArchetypeGenerateOptions): RecommendedDependencies
}
