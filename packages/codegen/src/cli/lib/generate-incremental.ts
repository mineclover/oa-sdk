import { resolve } from 'node:path'
import type { CliIncrementalRun } from './incremental.js'
import {
  beginCliGeneration,
  planCliGenerationTarget,
  recordCliGenerationTarget,
  resolveCliGeneratorIdentity,
  type CliGenerationTarget,
  type CliTargetGeneration,
} from './incremental-targets.js'
import type { GenerationTargetRecord } from '../../generation-target-store.js'
import type { WriteArtifactInput } from '../../routing/index.js'

const GENERATE_TARGET_FORMAT = 'oa-gen.generate.target.v1'
const GENERATE_GENERATOR_PACKAGES = [
  '@oa-sdk/codegen',
  '@oa-sdk/parser',
  '@oa-sdk/core',
  '@oa-sdk/router',
  '@oa-sdk/client',
] as const

export type GenerateIncrementalTarget = {
  readonly target: CliGenerationTarget
  readonly plan: ReturnType<typeof planCliGenerationTarget>
}

export function createGenerateIncrementalTarget(options: {
  run: CliIncrementalRun
  targetId: string
  entryPath: string
  preloadInputPaths?: readonly string[] | undefined
  outputRouting?: unknown
  guardsEnabled: boolean
  source: { configFile?: string | undefined; specFile?: string | undefined }
}): CliGenerationTarget {
  return {
    command: 'generate',
    entryPath: resolve(options.entryPath),
    ...(options.preloadInputPaths ? { preloadInputPaths: options.preloadInputPaths.map(path => resolve(path)) } : {}),
    output: { kind: 'stdout' },
    options: {
      targetId: options.targetId,
      outputRouting: options.outputRouting ?? null,
      guardsEnabled: options.guardsEnabled,
      source: options.source,
    },
    generator: resolveCliGeneratorIdentity(GENERATE_TARGET_FORMAT, GENERATE_GENERATOR_PACKAGES),
  }
}

export function planGenerateIncrementalTarget(
  run: CliIncrementalRun,
  target: CliGenerationTarget,
): GenerateIncrementalTarget {
  return { target, plan: planCliGenerationTarget(run, target) }
}

export function beginGenerateIncrementalTarget(
  run: CliIncrementalRun,
  target: CliGenerationTarget,
): CliTargetGeneration {
  return beginCliGeneration(run, target)
}

export function serializeGenerateArtifacts(artifacts: readonly WriteArtifactInput[]): string {
  return `${JSON.stringify([...artifacts].sort((a, b) => a.path.localeCompare(b.path)), null, 2)}\n`
}

export function deserializeGenerateArtifacts(content: string): WriteArtifactInput[] {
  const parsed: unknown = JSON.parse(content)
  if (!Array.isArray(parsed)) throw new Error('Incremental generate target bundle is not an array')
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || typeof (item as { path?: unknown }).path !== 'string') {
      throw new Error(`Incremental generate target bundle artifact ${index} is invalid`)
    }
    return item as WriteArtifactInput
  })
}

export function recordGenerateIncrementalTarget(
  run: CliIncrementalRun,
  generation: CliTargetGeneration,
  artifacts: readonly WriteArtifactInput[],
  inputFiles: readonly string[],
): void {
  recordCliGenerationTarget(run, generation, {
    content: serializeGenerateArtifacts(artifacts),
    inputFiles,
    messages: [],
  })
}

export function readGenerateTargetRecordContent(record: GenerationTargetRecord): WriteArtifactInput[] {
  if (record.output.kind !== 'stdout') {
    throw new Error('Incremental generate target record must use stdout bundle output')
  }
  return deserializeGenerateArtifacts(record.output.content)
}
