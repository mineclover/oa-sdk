import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command, CommandArgValue } from '../lib/types.js'
import { loadSpecDocumentAsync, loadSpecRecordingInputs } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { bool, choice, str, optStr } from '../lib/args.js'
import {
  closeCliIncrementalRun,
  detectCliIncrementalIndex,
  invalidateCliIncrementalIndex,
  openCliIncrementalRun,
  recordCliIncrementalIndex,
  type CliIncrementalRun,
} from '../lib/incremental.js'
import { planImpactScope, type GenerationUnit } from '../lib/impact-scope.js'
import {
  beginCliGeneration,
  planCliGenerationTarget,
  recordCliGenerationTarget,
  reportCliGenerationPlan,
  resolveCliGeneratorIdentity,
  type CliGenerationTarget,
  type CliTargetGeneration,
} from '../lib/incremental-targets.js'
import type { InputObservation } from '../lib/input-observations.js'
import type { GenerationTargetRecord } from '../../generation-target-store.js'
import type {
  WorkspaceDiagnosticRecord,
  WorkspaceDirtyDetectionResult,
  WorkspaceTypeAliasRecord,
} from '../../workspace-index.js'
import type { ExternalSchemaTypeAlias, GeneratedTypeDeclaration } from '../../typegen/generate-types.js'
import type { TypeSpecGraphProvenance } from '../../typegen/typespec-graph-semantic.js'

const TYPEGEN_STYLES = ['type', 'interface'] as const
type TypegenStyle = typeof TYPEGEN_STYLES[number]

/** Bump when the typegen command's generation pipeline changes without a package version change. */
const TYPEGEN_TARGET_FORMAT = 'oa-gen.typegen.target.v1'
/** Bump when the graph semantic index derivation changes without a package version change. */
const TYPEGEN_GRAPH_SEMANTIC_TARGET_FORMAT = 'oa-gen.typegen.graph-semantic-index.target.v1'
/** Packages on the typegen generation path; their versions form the generator identity. */
const TYPEGEN_GENERATOR_PACKAGES = ['@oa-sdk/codegen', '@oa-sdk/parser', '@oa-sdk/core', 'yaml'] as const
const TYPESPEC_GENERATOR_PACKAGES = ['@typespec/compiler', '@typespec/openapi3'] as const
/** The semantic index also depends on how the provenance file is validated. */
const GRAPH_SEMANTIC_GENERATOR_PACKAGES = ['zod'] as const

/** `--graph-semantic-index` request: every path is absolute except the graph file, which is project-relative. */
type GraphSemanticRequest = {
  outputPath: string
  provenancePath: string
  graphFile: string
}

export const typegen: Command = {
  name: 'typegen',
  description: 'OAS spec → TypeScript 타입',
  options: {
    spec:          { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:        { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    style:         { type: 'string', description: 'type | interface (기본: type)' },
    incremental:   { type: 'boolean', description: 'SQLite workspace index로 입력/옵션/출력이 그대로인 대상의 재생성을 생략' },
    'cache-dir':   { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
    'typespec-provenance': { type: 'string', description: 'oa-sdk.typespec-ref-provenance.v1 JSON 경로 (--graph-semantic-index와 함께 필요)' },
    'graph-semantic-index': { type: 'string', description: '생성 TypeScript 선언의 TypeSpec origin graph semantic index 출력 경로 (--output 필요)' },
    'graph-file': { type: 'string', description: 'graph에서 보이는 생성 TypeScript의 프로젝트 상대 경로 (--graph-semantic-index와 함께 필요)' },
  },
  async run(args) {
    const specPath = str(args, 'spec')
    const outputPath = optStr(args, 'output')
    const style = choice(args, 'style', TYPEGEN_STYLES, 'type')
    const cacheDir = optStr(args, 'cache-dir')
    const graphSemantic = readGraphSemanticRequest(args, outputPath)
    const incremental = openCliIncrementalRun({
      enabled: bool(args, 'incremental'),
      specPath,
      ...(cacheDir ? { cacheDir } : {}),
    })
    try {
      let generations: { types: CliTargetGeneration; graphSemantic?: CliTargetGeneration } | undefined
      if (incremental.enabled) {
        const typesTarget = createTypegenTarget(incremental, outputPath, style)
        const graphSemanticTarget = graphSemantic
          ? createGraphSemanticTarget(incremental, typesTarget, graphSemantic, style)
          : undefined
        const typesPlan = planCliGenerationTarget(incremental, typesTarget)
        const graphSemanticPlan = graphSemanticTarget ? planCliGenerationTarget(incremental, graphSemanticTarget) : undefined
        const dirtyBeforeInvalidation = detectCliIncrementalIndex(incremental)
        const impact = planTypegenImpact(incremental, typesTarget, graphSemanticTarget, dirtyBeforeInvalidation)
        if (process.env.OA_SDK_DEBUG_INCREMENTAL_IMPACT === '1') reportTypegenImpact(impact)
        const graphReused = !graphSemanticPlan || graphSemanticPlan.action === 'reuse'
        // The index describes the generated source, so both are generated together or reused together.
        if (typesPlan.action === 'reuse' && graphReused) {
          reportCliGenerationPlan(typesTarget, typesPlan)
          if (graphSemanticTarget && graphSemanticPlan) reportCliGenerationPlan(graphSemanticTarget, graphSemanticPlan)
          replayTypegenTarget(typesPlan.record)
          return
        }
        if (typesPlan.action === 'reuse') {
          // The index needs the declarations of a fresh generation, so the types are
          // regenerated too; do not report a skip that will not happen.
          reportCliGenerationPlan(typesTarget, { action: 'generate', reason: 'the graph semantic index needs the generated source' })
        } else {
          reportCliGenerationPlan(typesTarget, typesPlan)
        }
        if (graphSemanticTarget && graphSemanticPlan) reportCliGenerationPlan(graphSemanticTarget, graphSemanticPlan)
        invalidateCliIncrementalIndex(incremental)
        generations = {
          types: beginCliGeneration(incremental, typesTarget),
          ...(graphSemanticTarget ? { graphSemantic: beginCliGeneration(incremental, graphSemanticTarget) } : {}),
        }
      }

      const { analyzeExternalSchemaRefs, generateTypesFromSpec } = await import('../../typegen/generate-types.js')
      const recorded = generations ? await loadSpecRecordingInputs(specPath) : undefined
      const { document: doc, path: resolvedSpecPath } = recorded?.loaded ?? await loadSpecDocumentAsync(specPath)
      const warnings: string[] = []
      const declarations: GeneratedTypeDeclaration[] = []
      const externalAnalysis = analyzeExternalSchemaRefs(doc, resolvedSpecPath)
      const ts = generateTypesFromSpec(doc, {
        style,
        basePath: resolvedSpecPath,
        warnings,
        externalAnalysis,
        ...(graphSemantic ? { declarations } : {}),
      })
      for (const warning of warnings) console.warn(`⚠️  ${warning}`)

      // Build the index before writing anything, so a provenance that does not describe this document leaves both outputs untouched.
      let graphSemanticOutput: { content: string; provenance: InputObservation } | undefined
      if (graphSemantic) {
        const { buildTypeSpecGeneratedGraphSemanticIndex } = await import('../../typegen/typespec-graph-semantic.js')
        const provenance = await readTypeSpecGraphProvenance(graphSemantic.provenancePath)
        const index = buildTypeSpecGeneratedGraphSemanticIndex({
          document: doc,
          generatedTypeScript: ts,
          declarations,
          generatedFile: graphSemantic.graphFile,
          typeSpecProvenance: provenance.artifact,
        })
        graphSemanticOutput = { content: `${JSON.stringify(index, null, 2)}\n`, provenance: provenance.observation }
      }

      writeOutput(outputPath, ts, 'TypeScript 타입 생성')
      if (graphSemantic && graphSemanticOutput) {
        writeOutput(graphSemantic.outputPath, graphSemanticOutput.content, 'TypeSpec graph semantic index')
      }
      const indexed = await recordCliIncrementalIndex(incremental, doc, {
        diagnostics: warnings.map(warning => toWorkspaceDiagnostic(resolvedSpecPath, warning)),
        typeAliases: externalAnalysis.typeAliases.map(alias => toWorkspaceTypeAlias(resolvedSpecPath, alias)),
      })
      if (generations) {
        recordCliGenerationTarget(incremental, generations.types, {
          content: ts,
          inputFiles: indexed.referencedFilePaths,
          observations: recorded?.inputs ?? [],
          messages: warnings,
        })
        if (generations.graphSemantic && graphSemanticOutput) {
          recordCliGenerationTarget(incremental, generations.graphSemantic, {
            content: graphSemanticOutput.content,
            inputFiles: indexed.referencedFilePaths,
            observations: [...(recorded?.inputs ?? []), graphSemanticOutput.provenance],
            // Warnings belong to the types target, which replays them.
            messages: [],
          })
        }
      }
    } finally {
      closeCliIncrementalRun(incremental)
    }
  },
}

function readGraphSemanticRequest(
  args: Record<string, CommandArgValue>,
  outputPath: string | undefined,
): GraphSemanticRequest | undefined {
  const indexPath = optStr(args, 'graph-semantic-index')
  const provenancePath = optStr(args, 'typespec-provenance')
  const graphFile = optStr(args, 'graph-file')
  if (indexPath === undefined && provenancePath === undefined && graphFile === undefined) return undefined
  if (indexPath === undefined || provenancePath === undefined || graphFile === undefined || outputPath === undefined) {
    throw new Error('--graph-semantic-index, --typespec-provenance and --graph-file must be given together, with --output.')
  }
  return {
    outputPath: resolve(process.cwd(), indexPath),
    provenancePath: resolve(process.cwd(), provenancePath),
    graphFile,
  }
}

/** Read and validate the provenance, reporting the text it was read from for `--incremental`. */
async function readTypeSpecGraphProvenance(
  provenancePath: string,
): Promise<{ artifact: TypeSpecGraphProvenance; observation: InputObservation }> {
  const { typeSpecGraphProvenanceSchema } = await import('../lib/typespec-graph-provenance.js')
  const text = readFileSync(provenancePath, 'utf8')
  let parsed: ReturnType<typeof typeSpecGraphProvenanceSchema.safeParse>
  try {
    parsed = typeSpecGraphProvenanceSchema.safeParse(JSON.parse(text))
  } catch (error) {
    throw new Error(`TypeSpec provenance is not JSON: ${provenancePath}\n${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new Error(`TypeSpec provenance is not oa-sdk.typespec-ref-provenance.v1: ${provenancePath}\n${issues.join('\n')}`)
  }
  return {
    artifact: parsed.data,
    observation: { kind: 'content', path: provenancePath, consumed: { text } },
  }
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

/**
 * The semantic index is a second output of the same generation. Its options
 * hold everything besides the recorded inputs that its content depends on: the
 * generated source it describes (style, output) and the provenance file it
 * binds to, whose content is recorded as an input of this target.
 */
function createGraphSemanticTarget(
  incremental: CliIncrementalRun,
  typesTarget: CliGenerationTarget,
  request: GraphSemanticRequest,
  style: TypegenStyle,
): CliGenerationTarget {
  const isTypeSpec = incremental.resolvedSpecPath.endsWith('.tsp')
  return {
    command: 'typegen:graph-semantic-index',
    entryPath: incremental.resolvedSpecPath,
    output: { kind: 'file', filePath: request.outputPath },
    options: {
      style,
      typesOutput: typesTarget.output.kind === 'file' ? typesTarget.output.filePath : 'stdout',
      typeSpecProvenance: request.provenancePath,
      graphFile: request.graphFile,
    },
    generator: resolveCliGeneratorIdentity(TYPEGEN_GRAPH_SEMANTIC_TARGET_FORMAT, [
      ...TYPEGEN_GENERATOR_PACKAGES,
      ...GRAPH_SEMANTIC_GENERATOR_PACKAGES,
      ...(isTypeSpec ? TYPESPEC_GENERATOR_PACKAGES : []),
    ]),
  }
}

function planTypegenImpact(
  incremental: CliIncrementalRun,
  typesTarget: CliGenerationTarget,
  graphSemanticTarget: CliGenerationTarget | undefined,
  dirty: WorkspaceDirtyDetectionResult | undefined,
) {
  const indexedSourceFiles = incremental.index.listFiles().map(file => file.filePath)
  const typegenUnit: GenerationUnit = {
    unitId: 'typegen',
    sourceFiles: [...new Set([typesTarget.entryPath, ...indexedSourceFiles])],
    outputFiles: typesTarget.output.kind === 'file' ? [typesTarget.output.filePath] : [],
  }
  const units: GenerationUnit[] = [typegenUnit]
  if (graphSemanticTarget) {
    const provenance = graphSemanticTarget.options['typeSpecProvenance']
    units.push({
      unitId: 'graph-semantic',
      sourceFiles: typeof provenance === 'string' ? [provenance] : [],
      outputFiles: graphSemanticTarget.output.kind === 'file' ? [graphSemanticTarget.output.filePath] : [],
      dependencyUnitIds: ['typegen'],
    })
  }
  return planImpactScope(units, dirty?.dirtyFilePaths ?? [], {
    reason: dirty && dirty.dependentFilePaths.length > 0 ? 'ref-change' : 'source-change',
  })
}

function reportTypegenImpact(impact: ReturnType<typeof planTypegenImpact>): void {
  const dirty = impact.dirtyUnitIds.length > 0 ? impact.dirtyUnitIds.join(', ') : 'none'
  const preserved = impact.preservedUnitIds.length > 0 ? impact.preservedUnitIds.join(', ') : 'none'
  console.warn(`incremental: impact units dirty=[${dirty}] preserved=[${preserved}] reason=${impact.reason}`)
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
