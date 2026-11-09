import { resolve } from 'node:path'
import { z } from 'zod'
import { ARTIFACT_KINDS } from '../../config.js'
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

/** Shape of one recorded artifact in an incremental `generate` target bundle (`WriteArtifactInput`). */
const generateArtifactBundleSchema = z.array(z.object({
  path: z.string(),
  kind: z.enum(ARTIFACT_KINDS),
  content: z.string(),
  tag: z.string().optional(),
  producer: z.string().optional(),
  configFile: z.string().optional(),
  specFile: z.string().optional(),
  target: z.string().optional(),
  sourceSpec: z.string().optional(),
}))

export function deserializeGenerateArtifacts(content: string): WriteArtifactInput[] {
  const result = generateArtifactBundleSchema.safeParse(JSON.parse(content))
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue === undefined || issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`
    throw new Error(`Incremental generate target bundle is invalid${where}: ${issue?.message ?? 'unknown error'}`)
  }
  return result.data
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
