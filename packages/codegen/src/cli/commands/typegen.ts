import { resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecDocumentAsync, loadSpecRecordingInputs } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { bool, choice, str, optStr } from '../lib/args.js'
import {
  closeCliIncrementalRun,
  invalidateCliIncrementalIndex,
  openCliIncrementalRun,
  recordCliIncrementalIndex,
  type CliIncrementalRun,
} from '../lib/incremental.js'
import {
  beginCliGeneration,
  planCliGenerationTarget,
  recordCliGenerationTarget,
  reportCliGenerationPlan,
  resolveCliGeneratorIdentity,
  type CliGenerationTarget,
  type CliTargetGeneration,
} from '../lib/incremental-targets.js'
import type { GenerationTargetRecord } from '../../generation-target-store.js'
import type { WorkspaceDiagnosticRecord, WorkspaceTypeAliasRecord } from '../../workspace-index.js'
import type { ExternalSchemaTypeAlias } from '../../typegen/generate-types.js'

const TYPEGEN_STYLES = ['type', 'interface'] as const
type TypegenStyle = typeof TYPEGEN_STYLES[number]

/** Bump when the typegen command's generation pipeline changes without a package version change. */
const TYPEGEN_TARGET_FORMAT = 'oa-gen.typegen.target.v1'
/** Packages on the typegen generation path; their versions form the generator identity. */
const TYPEGEN_GENERATOR_PACKAGES = ['@oa-sdk/codegen', '@oa-sdk/parser', '@oa-sdk/core', 'yaml'] as const
const TYPESPEC_GENERATOR_PACKAGES = ['@typespec/compiler', '@typespec/openapi3'] as const

export const typegen: Command = {
  name: 'typegen',
  description: 'OAS spec → TypeScript 타입',
  options: {
    spec:          { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:        { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    style:         { type: 'string', description: 'type | interface (기본: type)' },
    incremental:   { type: 'boolean', description: 'SQLite workspace index로 입력/옵션/출력이 그대로인 대상의 재생성을 생략' },
    'cache-dir':   { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
  },
  async run(args) {
    const specPath = str(args, 'spec')
    const outputPath = optStr(args, 'output')
    const style = choice(args, 'style', TYPEGEN_STYLES, 'type')
    const cacheDir = optStr(args, 'cache-dir')
    const incremental = openCliIncrementalRun({
      enabled: bool(args, 'incremental'),
      specPath,
      ...(cacheDir ? { cacheDir } : {}),
    })
    try {
      let generation: CliTargetGeneration | undefined
      if (incremental.enabled) {
        const target = createTypegenTarget(incremental, outputPath, style)
        const plan = planCliGenerationTarget(incremental, target)
        reportCliGenerationPlan(target, plan)
        if (plan.action === 'reuse') {
          replayTypegenTarget(plan.record)
          return
        }
        invalidateCliIncrementalIndex(incremental)
        generation = beginCliGeneration(incremental, target)
      }

      const { analyzeExternalSchemaRefs, generateTypesFromSpec } = await import('../../typegen/generate-types.js')
      const recorded = generation ? await loadSpecRecordingInputs(specPath) : undefined
      const { document: doc, path: resolvedSpecPath } = recorded?.loaded ?? await loadSpecDocumentAsync(specPath)
      const warnings: string[] = []
      const externalAnalysis = analyzeExternalSchemaRefs(doc, resolvedSpecPath)
      const ts = generateTypesFromSpec(doc, { style, basePath: resolvedSpecPath, warnings, externalAnalysis })
      for (const warning of warnings) console.warn(`⚠️  ${warning}`)
      writeOutput(outputPath, ts, 'TypeScript 타입 생성')
      const indexed = await recordCliIncrementalIndex(incremental, doc, {
        diagnostics: warnings.map(warning => toWorkspaceDiagnostic(resolvedSpecPath, warning)),
        typeAliases: externalAnalysis.typeAliases.map(alias => toWorkspaceTypeAlias(resolvedSpecPath, alias)),
      })
      if (generation) {
        recordCliGenerationTarget(incremental, generation, {
          content: ts,
          inputFiles: indexed.referencedFilePaths,
          observations: recorded?.inputs ?? [],
          messages: warnings,
        })
      }
    } finally {
      closeCliIncrementalRun(incremental)
    }
  },
}

function createTypegenTarget(
  incremental: CliIncrementalRun,
  outputPath: string | undefined,
  style: TypegenStyle,
): CliGenerationTarget {
  const isTypeSpec = incremental.resolvedSpecPath.endsWith('.tsp')
  return {
    command: 'typegen',
    entryPath: incremental.resolvedSpecPath,
    output: outputPath ? { kind: 'file', filePath: resolve(process.cwd(), outputPath) } : { kind: 'stdout' },
    options: { style },
    generator: resolveCliGeneratorIdentity(TYPEGEN_TARGET_FORMAT, [
      ...TYPEGEN_GENERATOR_PACKAGES,
      ...(isTypeSpec ? TYPESPEC_GENERATOR_PACKAGES : []),
    ]),
  }
}

/** Reproduce the observable result of the recorded generation without regenerating. */
function replayTypegenTarget(record: GenerationTargetRecord): void {
  for (const message of record.messages) console.warn(`⚠️  ${message}`)
  if (record.output.kind === 'stdout') process.stdout.write(record.output.content)
}

function toWorkspaceTypeAlias(resolvedSpecPath: string, alias: ExternalSchemaTypeAlias): WorkspaceTypeAliasRecord {
  return {
    sourceFile: alias.sourceFilePath ?? resolvedSpecPath,
    sourcePointer: alias.sourcePointer,
    refText: alias.ref,
    aliasName: alias.aliasName,
    contentHash: alias.contentHash,
    ...(alias.renamedFrom ? { renamedFrom: alias.renamedFrom } : {}),
  }
}

function toWorkspaceDiagnostic(resolvedSpecPath: string, warning: string): WorkspaceDiagnosticRecord {
  return {
    producer: 'typegen',
    severity: 'warning',
    code: 'typegen/warning',
    message: warning,
    filePath: resolvedSpecPath,
    pointer: '#',
  }
}
