import { resolve, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { parseDocument, type OasDocument, type ParsedDocument } from '@oa-sdk/parser'
import type { Command, CommandArgValue } from '../lib/types.js'
import type { CodegenConfig, OaConfig } from '../../config.js'
import { resolveConfigWithDefaults } from '../../config.js'
import type { OutputOptions } from '../../types.js'
import { generateComponents } from '../../generator.js'
import { bool, optStr } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { StandaloneGuardGeneratorOptions } from '../../standalone-guards/types.js'
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import {
  CompanionLoader,
  GENERATE_COMPANION_OUTPUTS,
  explicitCompanionOutputs,
  formatMissingCompanionError,
  missingCompanionPackages,
  companionImporterFrom,
  companionInstallCommand,
  type CompanionOutput,
  type ExplicitCompanionOutput,
  type MissingCompanionOutput,
  type CompanionImporter,
  type CompanionModules,
  type CompanionPackageName,
} from '../lib/companion-packages.js'
import { projectTargetSpec, projectTargetGuards, type TargetSpecProjectionResult } from '../../spec-projector.js'
import {
  createPathDispatcher,
  OaManifestManager,
  DEFAULT_BANNER_MARKERS,
  MANIFEST_PRODUCERS,
  manifestArtifactOwner,
  toPosixPath,
  type ManifestArtifact,
  type PruneResult,
  type WriteArtifactInput,
} from '../../routing/index.js'

import { runStandaloneGuards } from './generate-guards.js'
import { runDrizzle } from './generate-drizzle.js'

export const generate: Command = {
  name: 'generate',
  description: 'Config/Drizzle 기반 스키마, 멀티 타겟 스펙 또는 독립형 타입 가드(standalone-guards) 생성',
  options: {
    target:           { type: 'string', description: '생성 타겟 (standalone-guards)' },
    input:            { type: 'string', short: 'i', description: '입력 스키마 또는 OpenAPI spec 파일 경로' },
    'out-dir':        { type: 'string', description: '출력 디렉토리 경로' },
    'type-import':    { type: 'string', description: 'TypeScript 타입 import 지정자 (예: @oa-sdk/models)' },
    'module-format':  { type: 'string', description: '모듈 포맷 (esm)' },
    config:           { type: 'string', short: 'c', description: 'oa.config.ts 또는 codegen.config.mjs 파일 경로' },
    'drizzle-schema': { type: 'string', short: 'd', description: 'Drizzle 스키마 파일 경로' },
    output:           { type: 'string', short: 'o', description: '출력 디렉토리 (기본: .)' },
    'merge-into':     { type: 'string', description: '기존 spec.yaml에 병합' },
    schemas:          { type: 'string', description: '생성 대상 필터 (Drizzle: select,insert,update / 가드: 컴포넌트/가드명 목록)' },
    split:            { type: 'boolean', description: '개별 가드 모듈 분할 생성 (guards/<TypeName>.js)' },
    tanstack:         { type: 'boolean', description: 'TanStack Query 클라이언트 옵션/키 팩토리 생성 (권장: oa-gen generate:tanstack)' },
    spec:             { type: 'string', short: 's', description: 'OpenAPI 3.1/3.2 spec 파일 경로' },
    tier:             { type: 'string', description: '생성 티어 필터 (all, keys, options, hooks)' },
    framework:        { type: 'string', description: '대상 UI 프레임워크 (react, vue, svelte)' },
    'types-import':   { type: 'string', description: '타입 import 지정자' },
    'client-import':  { type: 'string', description: '클라이언트 SDK import 지정자' },
  },
  async run(args, context) {
    const isTanstack = bool(args, 'tanstack')
    if (isTanstack) {
      console.log('[oa-gen] Note: "oa-gen generate --tanstack" is deprecated. Please use "oa-gen generate:tanstack" directly.')
      const { generateTanstackCommand } = await import('./generate-tanstack.js')
      const mappedArgs = { ...args }
      if (!mappedArgs['spec'] && (mappedArgs['input'] || mappedArgs['target'])) {
        mappedArgs['spec'] = mappedArgs['input'] ?? mappedArgs['target']
      }
      await generateTanstackCommand.run(mappedArgs, context)
      return
    }

    const target = optStr(args, 'target')
    const drizzlePath = optStr(args, 'drizzle-schema')
    const configPath = optStr(args, 'config')
    const inputPath = optStr(args, 'input')
    const specPath = optStr(args, 'spec')

    // 1. Explicit single-target flags
    if (target === 'standalone-guards' || (inputPath && !drizzlePath && !configPath && !specPath && !inputPath.endsWith('.tsp'))) {
      await runStandaloneGuards(args)
      return
    }
    if (drizzlePath) {
      await runDrizzle(drizzlePath, args)
      return
    }

    // 1.5. Direct spec/input execution without explicit config
    const directSpecPath = specPath ?? (inputPath && (inputPath.endsWith('.tsp') || inputPath.endsWith('.yaml') || inputPath.endsWith('.yml') || inputPath.endsWith('.json')) ? inputPath : undefined)
    if (directSpecPath && !drizzlePath && !configPath) {
      const outDir = optStr(args, 'out-dir') ?? optStr(args, 'output') ?? './dist'
      const id = directSpecPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.(tsp|yaml|yml|json)$/, '') ?? 'api'
      const syntheticConfig: OaConfig = {
        specs: [
          {
            id,
            schemaEntry: directSpecPath,
            outDir,
          },
        ],
      }
      const rootDir = context?.projectRoot ?? (context as any)?.rootDir ?? context?.cwd ?? process.cwd()
      // Resolved the way projectTargetSpec resolves `schemaEntry`.
      const specFile = toPosixPath(relative(rootDir, resolve(rootDir, directSpecPath)))
      await runConfigDrivenPipeline(syntheticConfig, rootDir, companionImporterFrom(context), { specFile })
      return
    }

    // 2. Config-driven execution (via explicit --config or no-arg discovery)
    const loaded = await loadOaConfig({
      ...(configPath ? { configPath } : {}),
      ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
      ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
    })

    if (loaded) {
      // Check if loaded config is extended OaConfig with specs, guards, core, or product
      if (loaded.config.specs || loaded.config.guards || loaded.config.core || loaded.config.product) {
        const configFile = toPosixPath(relative(loaded.rootDir, loaded.configPath))
        await runConfigDrivenPipeline(loaded.config, loaded.rootDir, companionImporterFrom(context), { configFile })
        return
      }
      // Legacy config with schemas
      if (loaded.config.schemas) {
        await runConfigWithObject(loaded.config, args)
        return
      }
    }

    // 3. If explicit --config was passed but not handled by loadOaConfig
    if (configPath) {
      await runConfig(configPath, args)
      return
    }

    // 4. No targeting arguments and no config found
    console.error('오류: oa.config.ts 설정 파일을 찾을 수 없으며, --config, --drizzle-schema 또는 --target standalone-guards (--input) 옵션이 필요합니다')
    throw new CliExitError(1)
  },
}

type Args = Record<string, CommandArgValue>

/**
 * Fails, before any artifact is written, when an output the configuration
 * requests explicitly (read from the configuration as written, before
 * archetype defaults) needs a companion package that is not installed.
 */
async function assertExplicitCompanionOutputsAvailable(config: OaConfig, companions: CompanionLoader): Promise<void> {
  const unavailable: ExplicitCompanionOutput[] = []
  for (const request of explicitCompanionOutputs(config)) {
    if (await companions.load(request.packageName) === undefined) unavailable.push(request)
  }
  if (unavailable.length === 0) return

  const switches = [...new Set(unavailable.map(request => request.configSwitch))]
  console.error(formatMissingCompanionError('generate', unavailable))
  console.error(`To generate without ${unavailable.length === 1 ? 'this output' : 'these outputs'}, set ${switches.join(' and ')} to false instead.`)
  throw new CliExitError(1)
}

/** An output of one spec target whose generation threw. */
interface FailedCompanionOutput {
  output: CompanionOutput
  /** Companion packages that generate the output. */
  packages: readonly CompanionPackageName[]
  /** Spec target id. */
  target: string
  message: string
  /** The configuration switch that turned the output on, when the configuration requests it explicitly. */
  request: ExplicitCompanionOutput | undefined
}

/**
 * Companion-produced outputs of a run that were not generated.
 *
 * An output is generated for a spec target whole or not at all. One that is not
 * was either skipped, because its companion package is not installed, or
 * failed, because generating it threw. Either way it keeps what an earlier run
 * generated for it: the spec still asks for the output, which only could not
 * be regenerated here, so those files are not orphans and must survive pruning.
 * A failed output that the configuration requests explicitly fails the run.
 */
class CompanionOutputOutcomes {
  readonly skipped: MissingCompanionOutput[] = []
  readonly failed: FailedCompanionOutput[] = []
  private readonly retainedKindsByTarget = new Set<string>()

  constructor(private readonly explicitOutputs: readonly ExplicitCompanionOutput[]) {}

  skip(output: CompanionOutput, packageName: CompanionPackageName, target: string): void {
    if (!this.skipped.some(entry => entry.output === output.label && entry.packageName === packageName)) {
      this.skipped.push({ output: output.label, packageName })
    }
    this.retain(output, target)
  }

  fail(output: CompanionOutput, packages: readonly CompanionPackageName[], target: string, error: unknown): void {
    this.failed.push({
      output,
      packages,
      target,
      message: error instanceof Error ? error.message : String(error),
      request: this.explicitOutputs.find(request => request.output === output.label),
    })
    this.retain(output, target)
  }

  /** Failed outputs that the configuration requests explicitly. Any of them fails the run. */
  requestedFailures(): FailedCompanionOutput[] {
    return this.failed.filter(failure => failure.request !== undefined)
  }

  /** Recorded artifacts of an output that was skipped or failed for a spec target of this run. */
  retainedPaths(artifacts: readonly ManifestArtifact[]): string[] {
    return artifacts
      .filter(artifact => {
        const { target } = manifestArtifactOwner(artifact)
        return target !== undefined && this.retainedKindsByTarget.has(JSON.stringify([artifact.kind, target]))
      })
      .map(artifact => artifact.path)
  }

  /** Warning that names every skipped output, its package, and the install command. */
  formatSkipped(): string {
    const lines = ['⚠️  [oa-gen generate] Skipped outputs whose companion package is not installed:']
    for (const entry of this.skipped) lines.push(`   - ${entry.output}: ${entry.packageName}`)
    lines.push('   Install the packages to generate these outputs (files from earlier runs are kept):')
    lines.push(`     ${companionInstallCommand(missingCompanionPackages(this.skipped))}`)
    lines.push('   Outputs turned on explicitly (core.contracts.pureHandlers: true, core.client.enabled: true) fail generation instead of being skipped.')
    return lines.join('\n')
  }

  /** Error for a run stopped because an output the configuration requests explicitly failed. */
  formatRequestedFailures(): string {
    const lines = ['[oa-gen generate] Generation failed; no files were written. An output the configuration turns on explicitly could not be generated:']
    for (const line of describeFailures(this.failed)) lines.push(`  - ${line}`)
    const switches = [...new Set(this.requestedFailures().flatMap(failure => failure.request ? [failure.request.configSwitch] : []))]
    lines.push(`Fix the error, or set ${switches.join(' and ')} to false to generate without ${switches.length === 1 ? 'this output' : 'these outputs'}.`)
    return lines.join('\n')
  }

  /** Warning for outputs that failed although nothing requests them explicitly. */
  formatImpliedFailures(): string {
    const lines = ['⚠️  [oa-gen generate] Skipped outputs that failed to generate:']
    for (const line of describeFailures(this.failed)) lines.push(`   - ${line}`)
    lines.push('   No configuration switch turns these outputs on explicitly, so generation continued without them (files from earlier runs are kept).')
    return lines.join('\n')
  }

  private retain(output: CompanionOutput, target: string): void {
    for (const kind of output.kinds) this.retainedKindsByTarget.add(JSON.stringify([kind, target]))
  }
}

/** One line per output and error, naming the spec targets it failed for. */
function describeFailures(failures: readonly FailedCompanionOutput[]): string[] {
  const groups = new Map<string, { failure: FailedCompanionOutput; targets: string[] }>()
  for (const failure of failures) {
    const key = JSON.stringify([failure.output.label, failure.message])
    const group = groups.get(key)
    if (group) group.targets.push(failure.target)
    else groups.set(key, { failure, targets: [failure.target] })
  }
  return [...groups.values()].map(({ failure, targets }) => {
    const scope = `spec target${targets.length === 1 ? '' : 's'} ${targets.map(target => `"${target}"`).join(', ')}`
    const requestedBy = failure.request ? `; requested by ${failure.request.requestedBy}` : ''
    return `Failed to generate ${failure.output.label} via ${failure.packages.join(' and ')}: ${failure.message} (${scope}${requestedBy})`
  })
}

/**
 * The file an `oa-gen generate` run starts from, relative to rootDir (POSIX):
 * its configuration file, or the spec file of `oa-gen generate --spec`, which
 * reads no configuration file. The run records it on every artifact it writes,
 * and it decides which manifest records the run owns.
 */
type GenerateRunSource =
  | { readonly configFile: string; readonly specFile?: undefined }
  | { readonly configFile?: undefined; readonly specFile: string }

/** What an `oa-gen generate` run generates, which decides the manifest records it owns. */
interface GenerateRunScope {
  source: GenerateRunSource
  /** Spec target ids the run generates. */
  targets: ReadonlySet<string>
  /** Whether the run generates guards (`guards` is configured). */
  generatesGuards: boolean
}

/**
 * Manifest records an `oa-gen generate` run owns, and so may prune.
 *
 * - A run owns the records `oa-gen generate` wrote from the same source file.
 *   For a run from a configuration file that covers whichever spec targets the
 *   file declared then, so that the outputs of a target removed from it are
 *   cleaned up. For `oa-gen generate --spec <file>` it covers what earlier runs
 *   wrote from that same spec file, whatever their `--out-dir`; a spec file at
 *   another path is another source even when its file name, and so its spec
 *   target id, is the same.
 * - Records written before codegen 0.9.0 name no source file (see
 *   `manifestArtifactOwner`), only the spec target id. A spec target id
 *   identifies an output only within a configuration file, which declares it;
 *   for `--spec` runs it is just the spec file name. Those records of
 *   `oa-gen generate` are therefore owned by any run from a configuration file
 *   that generates their spec target, legacy guard records by any such run that
 *   generates guards, and none of them by a `--spec` run.
 *
 * Records of other commands, such as `oa-gen generate:tanstack`, and of runs
 * from other source files are never pruned.
 */
function ownedByGenerateRun(run: GenerateRunScope): (artifact: ManifestArtifact) => boolean {
  return (artifact) => {
    const owner = manifestArtifactOwner(artifact)
    if (owner.producer !== MANIFEST_PRODUCERS.generate) return false
    if (owner.legacy) {
      if (run.source.configFile === undefined) return false
      return owner.target !== undefined ? run.targets.has(owner.target) : run.generatesGuards
    }
    return owner.configFile === run.source.configFile && owner.specFile === run.source.specFile
  }
}

/** Summary label of a projected OpenAPI document: the version its `openapi` field declares. */
function openApiLabel(doc: Record<string, unknown>): string {
  return typeof doc['openapi'] === 'string' ? `OpenAPI ${doc['openapi']}` : 'OpenAPI (no version declared)'
}

/**
 * Executes declarative multi-target generation driven by oa.config.ts.
 *
 * Projections and companion outputs are generated in memory, and nothing is
 * written until no output the configuration requests explicitly has failed:
 * such a failure leaves the files and `.oa-manifest.json` of the previous run
 * as they were. Guards come next (their generator writes the files itself),
 * then every artifact is committed through the manifest.
 *
 * @param source The configuration file the run reads, or for
 *   `oa-gen generate --spec`, which reads none, the spec file.
 */
async function runConfigDrivenPipeline(
  config: OaConfig,
  rootDir: string,
  importCompanion: CompanionImporter,
  source: GenerateRunSource,
): Promise<void> {
  const resolvedConfig = resolveConfigWithDefaults(config)
  const specs = resolvedConfig.specs ?? []
  const specResults: TargetSpecProjectionResult[] = []

  // Companion-backed outputs only exist for projected specs; without specs nothing needs a companion.
  const companions = new CompanionLoader(importCompanion)
  if (specs.length > 0) {
    await assertExplicitCompanionOutputsAvailable(config, companions)
  }
  const outcomes = new CompanionOutputOutcomes(explicitCompanionOutputs(config))
  const loadCompanionFor = async <N extends CompanionPackageName>(
    output: CompanionOutput,
    packageName: N,
    target: string,
  ): Promise<CompanionModules[N] | undefined> => {
    const loaded = await companions.load(packageName)
    if (loaded === undefined) outcomes.skip(output, packageName, target)
    return loaded
  }

  const outputRouting = resolvedConfig.product?.outputRouting ?? resolvedConfig.outputRouting
  const dispatcher = createPathDispatcher(outputRouting, rootDir)
  const bannerMarkers = [
    ...DEFAULT_BANNER_MARKERS,
    '@oa-sdk',
    'Auto-generated',
    'Do not edit',
    'openapi',
    '$schema',
  ]
  const manifestManager = new OaManifestManager(rootDir, undefined, bannerMarkers)
  const artifactsToWrite: WriteArtifactInput[] = []

  /** Queues an artifact of this run, recorded as written by `oa-gen generate` from `source` for `target`. */
  const queue = (artifact: WriteArtifactInput, target?: string): void => {
    artifactsToWrite.push({ ...artifact, producer: MANIFEST_PRODUCERS.generate, ...source, target })
  }

  /**
   * Generates one companion output for one spec target, whole or not at all:
   * its artifacts are queued only when `build` produced every one of them.
   * `build` returns undefined when a companion it needs is not installed.
   * Returns whether the output was generated.
   */
  const generateCompanionOutput = async (
    output: CompanionOutput,
    packages: readonly CompanionPackageName[],
    target: string,
    build: () => Promise<WriteArtifactInput[] | undefined>,
  ): Promise<boolean> => {
    let artifacts: WriteArtifactInput[] | undefined
    try {
      artifacts = await build()
    } catch (error) {
      outcomes.fail(output, packages, target, error)
      return false
    }
    if (artifacts === undefined) return false
    for (const artifact of artifacts) queue(artifact, target)
    return true
  }

  console.log('\n🚀 [oa-gen generate] Executing Declarative Spec Pipeline...')
  console.log(`   Project Root: ${rootDir}\n`)

  // Every downstream generator consumes the same projected document. Parse it
  // once per target, on first use, instead of once per generator.
  const parsedSpecs = new Map<TargetSpecProjectionResult, ParsedDocument>()
  const parsedSpec = (res: TargetSpecProjectionResult): ParsedDocument => {
    let parsed = parsedSpecs.get(res)
    if (!parsed) {
      parsed = parseDocument(res.openApiDoc as OasDocument)
      parsedSpecs.set(res, parsed)
    }
    return parsed
  }

  // Step 1: Schema Projection (OpenAPI 3.1/3.2 and JSON Schema 2020-12)
  for (const target of specs) {
    const result = await projectTargetSpec(target, rootDir)
    queue({
      path: result.openApiPath,
      kind: 'schemas',
      tag: target.id,
      content: JSON.stringify(result.openApiDoc, null, 2) + '\n',
      sourceSpec: target.schemaEntry,
    }, target.id)
    queue({
      path: result.jsonSchemaPath,
      kind: 'schemas',
      tag: target.id,
      content: JSON.stringify(result.jsonSchemaDoc, null, 2) + '\n',
      sourceSpec: target.schemaEntry,
    }, target.id)
    specResults.push(result)
  }

  // Step 2: Handler Contracts (@oa-sdk/router)
  const contractsConfig = resolvedConfig.core?.contracts
  let contractsGeneratedCount = 0
  if (contractsConfig?.pureHandlers !== false) {
    const output = GENERATE_COMPANION_OUTPUTS.contracts
    for (const res of specResults) {
      const id = res.target.id
      const generated = await generateCompanionOutput(output, ['@oa-sdk/router'], id, async () => {
        const router = await loadCompanionFor(output, '@oa-sdk/router', id)
        if (!router) return undefined
        const contractCode = router.generateHandlerContract(parsedSpec(res), {
          contractName: contractsConfig?.contractName ?? 'ApiHandlers',
          banner: contractsConfig?.banner ?? true,
          contextImport: resolvedConfig.product?.contextInjection?.importPath,
          contextTypeName: resolvedConfig.product?.contextInjection?.typeName,
        })

        let contractPath: string
        if (outputRouting) {
          contractPath = dispatcher.dispatch({ kind: 'contract', tag: id }).absolutePath
        } else if (contractsConfig?.outDir) {
          contractPath = resolve(rootDir, contractsConfig.outDir, `${id}.contract.ts`)
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          contractPath = resolve(targetResolved.resolvedOutDir, `${id}.contract.ts`)
        }

        return [{ path: contractPath, kind: 'contract', tag: id, content: contractCode, sourceSpec: res.openApiPath }]
      })
      if (generated) contractsGeneratedCount++
    }
  }

  // Step 3: Client SDK (@oa-sdk/client)
  const clientConfig = resolvedConfig.core?.client
  let clientGeneratedCount = 0
  if (clientConfig?.enabled !== false) {
    const output = GENERATE_COMPANION_OUTPUTS.client
    for (const res of specResults) {
      const id = res.target.id
      const generated = await generateCompanionOutput(output, ['@oa-sdk/client'], id, async () => {
        const client = await loadCompanionFor(output, '@oa-sdk/client', id)
        if (!client) return undefined
        const typesImport = clientConfig?.typesImport ?? (res.target as any).typesImport
        const clientCode = client.generateClient(parsedSpec(res), {
          banner: true,
          ...(typesImport ? { typesImport } : {}),
        })

        let clientPath: string
        if (outputRouting) {
          clientPath = dispatcher.dispatch({ kind: 'client', tag: id }).absolutePath
        } else if (clientConfig?.outDir) {
          clientPath = resolve(rootDir, clientConfig.outDir, `${id}.client.ts`)
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          clientPath = resolve(targetResolved.resolvedOutDir, `${id}.client.ts`)
        }

        return [{ path: clientPath, kind: 'client', tag: id, content: clientCode, sourceSpec: res.openApiPath }]
      })
      if (generated) clientGeneratedCount++
    }
  }

  // Step 4: TanStack Query options (@oa-sdk/client)
  let tanstackGeneratedCount = 0
  {
    const output = GENERATE_COMPANION_OUTPUTS.tanstack
    for (const res of specResults) {
      const id = res.target.id
      const generated = await generateCompanionOutput(output, ['@oa-sdk/client'], id, async () => {
        const client = await loadCompanionFor(output, '@oa-sdk/client', id)
        if (!client) return undefined
        const { generateTanstackQuery } = client

        let clientImport: string | undefined
        let keysPath: string
        let queriesPath: string
        if (outputRouting) {
          keysPath = dispatcher.dispatch({ kind: 'keys', tag: id }).absolutePath
          queriesPath = dispatcher.dispatch({ kind: 'queries', tag: id }).absolutePath
          clientImport = dispatcher.resolveImport(
            { kind: 'queries', tag: id },
            { kind: 'client', tag: id },
          )
        } else {
          const targetResolved = resolveProfileTarget(res.target, rootDir)
          keysPath = resolve(targetResolved.resolvedOutDir, `${id}.keys.ts`)
          queriesPath = resolve(targetResolved.resolvedOutDir, `${id}.queries.ts`)
          clientImport = `./${id}.client.js`
        }

        if (outputRouting && keysPath !== queriesPath) {
          const keysImport = dispatcher.resolveImport(
            { kind: 'queries', tag: id },
            { kind: 'keys', tag: id },
          )
          const tanstackResult = generateTanstackQuery(parsedSpec(res), {
            queryPackage: '@tanstack/react-query',
            includeHooks: true,
            clientImport,
            keysImport,
            tier: 'all',
          })
          return [
            { path: keysPath, kind: 'keys', tag: id, content: tanstackResult.keysCode, sourceSpec: res.openApiPath },
            { path: queriesPath, kind: 'queries', tag: id, content: tanstackResult.queriesCode, sourceSpec: res.openApiPath },
          ]
        }

        const tanstackResult = generateTanstackQuery(parsedSpec(res), {
          queryPackage: '@tanstack/react-query',
          includeHooks: true,
          clientImport,
        })
        return [{ path: queriesPath, kind: 'queries', tag: id, content: tanstackResult.combinedCode, sourceSpec: res.openApiPath }]
      })
      if (generated) tanstackGeneratedCount++
    }
  }

  // Step 5: CRDT Collaboration Modules (@oa-sdk/router & @oa-sdk/client)
  let crdtGeneratedCount = 0
  {
    const output = GENERATE_COMPANION_OUTPUTS.crdt
    for (const res of specResults) {
      const schemas = (res.openApiDoc as any)?.components?.schemas ?? {}
      const hasCrdtEntity = Object.values(schemas).some(
        (s: any) => s && typeof s === 'object' && ('x-oa-sdk-crdt-entity' in s || 'x-oa-sdk-crdt' in s),
      )
      if (!hasCrdtEntity) continue

      const id = res.target.id
      const generated = await generateCompanionOutput(output, ['@oa-sdk/router', '@oa-sdk/client'], id, async () => {
        // The four CRDT modules reference each other, so they are produced together or not at all.
        const router = await loadCompanionFor(output, '@oa-sdk/router', id)
        const client = await loadCompanionFor(output, '@oa-sdk/client', id)
        if (!router || !client) return undefined
        const { generateCrdtHandlerContract, generateCrdtRouter } = router
        const { generateCrdtClient, generateCrdtHooks } = client

        const targetResolved = resolveProfileTarget(res.target, rootDir)
        const targetDir = targetResolved.resolvedOutDir

        // 1. CRDT contract
        const crdtContractCode = generateCrdtHandlerContract(parsedSpec(res), { banner: true })
        const crdtContractPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-contract', tag: id }).absolutePath
          : resolve(targetDir, `${id}.crdt.contract.ts`)

        // 2. CRDT router
        const crdtRouterCode = generateCrdtRouter(parsedSpec(res), {
          target: ((resolvedConfig.core as any)?.router as any)?.target ?? 'hono',
          contractImport: outputRouting
            ? dispatcher.resolveImport(
                { kind: 'crdt-router', tag: id },
                { kind: 'crdt-contract', tag: id },
              )
            : `./${id}.crdt.contract.js`,
          banner: true,
        })
        const crdtRouterPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-router', tag: id }).absolutePath
          : resolve(targetDir, `${id}.crdt.router.ts`)

        // 3. CRDT client
        const crdtClientCode = generateCrdtClient(parsedSpec(res), { banner: true })
        const crdtClientPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-client', tag: id }).absolutePath
          : resolve(targetDir, `${id}.crdt.client.ts`)

        // 4. CRDT hooks
        const crdtHooksCode = generateCrdtHooks(parsedSpec(res), {
          clientImport: outputRouting
            ? dispatcher.resolveImport(
                { kind: 'crdt-hooks', tag: id },
                { kind: 'crdt-client', tag: id },
              )
            : `./${id}.crdt.client.js`,
          banner: true,
        })
        const crdtHooksPath = outputRouting
          ? dispatcher.dispatch({ kind: 'crdt-hooks', tag: id }).absolutePath
          : resolve(targetDir, `${id}.crdt.hooks.ts`)

        return [
          { path: crdtContractPath, kind: 'crdt-contract', tag: id, content: crdtContractCode, sourceSpec: res.openApiPath },
          { path: crdtRouterPath, kind: 'crdt-router', tag: id, content: crdtRouterCode, sourceSpec: res.openApiPath },
          { path: crdtClientPath, kind: 'crdt-client', tag: id, content: crdtClientCode, sourceSpec: res.openApiPath },
          { path: crdtHooksPath, kind: 'crdt-hooks', tag: id, content: crdtHooksCode, sourceSpec: res.openApiPath },
        ]
      })
      if (generated) crdtGeneratedCount++
    }
  }

  // An output the configuration requests explicitly must not fail silently.
  // Stop before anything is written, so no partial output looks like a success.
  if (outcomes.requestedFailures().length > 0) {
    console.error(outcomes.formatRequestedFailures())
    throw new CliExitError(1)
  }

  // Step 6: Standalone Type Guards (written by the guard generator, then recorded)
  let guardSummary: string | undefined
  if (resolvedConfig.guards) {
    const guardRes = await projectTargetGuards(resolvedConfig.guards, specResults, rootDir)
    guardSummary = `${guardRes.artifacts.length} guard artifacts (${guardRes.guardCount} types) -> ${relative(rootDir, guardRes.outDir)}`
    for (const artifact of guardRes.artifacts) {
      queue({ path: artifact.filePath, kind: 'guards', content: artifact.content })
    }
  }

  // Step 7: Commit all artifacts through OaManifestManager and prune the orphans this run owns
  const writeResult = await manifestManager.writeArtifacts(artifactsToWrite)
  let pruneResult: PruneResult | undefined
  if (outputRouting?.pruneOrphans !== false) {
    const activePaths = artifactsToWrite.map((a) =>
      relative(rootDir, resolve(rootDir, a.path)),
    )
    activePaths.push(...outcomes.retainedPaths(writeResult.manifest.artifacts))
    pruneResult = await manifestManager.pruneOrphans(activePaths, {
      scope: ownedByGenerateRun({
        source,
        targets: new Set(specResults.map(res => res.target.id)),
        generatesGuards: resolvedConfig.guards !== undefined,
      }),
    })
  }

  // Step 8: Formatted Summary
  console.log('================================================================================')
  console.log('                 OA-SDK GENERATE: SPEC & GUARD SUMMARY                          ')
  console.log('                 OA-SDK GENERATE: DECLARATIVE PIPELINE SUMMARY                  ')
  console.log('================================================================================')
  console.log(`Specs Processed:     ${specResults.length}`)
  console.log(`Contracts Generated: ${contractsGeneratedCount}`)
  console.log(`Clients Generated:   ${clientGeneratedCount}`)
  console.log(`TanStack Generated:  ${tanstackGeneratedCount}`)
  if (crdtGeneratedCount > 0) {
    console.log(`CRDT Modules:        ${crdtGeneratedCount}`)
  }
  console.log(`Artifacts Written:   ${writeResult.written.length}`)
  console.log(`Artifacts Cached:    ${writeResult.skipped.length}`)
  if (pruneResult) {
    console.log(`Artifacts Pruned:    ${pruneResult.pruned.length}`)
    for (const pruned of pruneResult.pruned) console.log(`    - ${pruned}`)
  } else {
    console.log('Artifacts Pruned:    0 (outputRouting.pruneOrphans: false)')
  }
  for (const res of specResults) {
    const relOpenApi = relative(rootDir, res.openApiPath)
    const relSchema = relative(rootDir, res.jsonSchemaPath)
    const opInfo = res.operationCount > 0 ? `${res.operationCount} ops, ` : ''
    const titleInfo = res.target.title ? `(${res.target.title}) ` : ''
    console.log(` ✅ ${res.target.id.padEnd(20)} [${(res.target.profile ?? 'full-api-document').padEnd(18)}] ${titleInfo}-> ${opInfo}${res.schemaCount} schemas`)
    console.log(`    - ${openApiLabel(res.openApiDoc)}: ${relOpenApi}`)
    console.log(`    - JSON Schema: ${relSchema}`)
  }

  if (guardSummary) {
    console.log(`\nGuards Generated:`)
    console.log(` ✅ ${guardSummary}`)
  }
  console.log('================================================================================\n')
  if (outcomes.skipped.length > 0) {
    console.warn(outcomes.formatSkipped() + '\n')
  }
  if (outcomes.failed.length > 0) {
    console.warn(outcomes.formatImpliedFailures() + '\n')
  }
}

async function runConfigWithObject(config: OaConfig, args: Args): Promise<void> {
  if (!config?.schemas) {
    console.error('오류: 설정 파일에 schemas 필드가 없습니다')
    throw new CliExitError(1)
  }

  const genOptions: OutputOptions = { output: optStr(args, 'output') ?? config.output ?? '.' }
  if (config.grouping !== undefined) genOptions.grouping = config.grouping
  if (config.filename !== undefined) genOptions.filename = config.filename
  if (config.mergeIntoSpec !== undefined) genOptions.mergeIntoSpec = config.mergeIntoSpec
  if (config.specPath !== undefined) genOptions.specPath = config.specPath

  const result = generateComponents(config.schemas, genOptions)
  console.log(`✅ ${result.files.length}개 파일 생성 완료:`)
  for (const file of result.files) console.log(`   ${file}`)
  printWarnings(result.warnings)
}

async function runConfig(configPath: string, args: Args): Promise<void> {
  const resolvedConfig = resolve(process.cwd(), configPath)
  if (!existsSync(resolvedConfig)) {
    console.error(`오류: 설정 파일을 찾을 수 없습니다: ${resolvedConfig}`)
    throw new CliExitError(1)
  }

  const mod = await import(resolvedConfig) as { default?: CodegenConfig } | CodegenConfig
  const config: CodegenConfig = (mod as { default?: CodegenConfig }).default ?? (mod as CodegenConfig)

  if (!config?.schemas) {
    console.error('오류: 설정 파일에 schemas 필드가 없습니다')
    throw new CliExitError(1)
  }

  const genOptions: OutputOptions = { output: optStr(args, 'output') ?? config.output ?? '.' }
  if (config.grouping !== undefined) genOptions.grouping = config.grouping
  if (config.filename !== undefined) genOptions.filename = config.filename
  if (config.mergeIntoSpec !== undefined) genOptions.mergeIntoSpec = config.mergeIntoSpec
  if (config.specPath !== undefined) genOptions.specPath = config.specPath

  const result = generateComponents(config.schemas, genOptions)
  console.log(`✅ ${result.files.length}개 파일 생성 완료:`)
  for (const file of result.files) console.log(`   ${file}`)
  printWarnings(result.warnings)
}

function printWarnings(warnings: string[]): void {
  if (warnings.length > 0) {
    console.warn('\n경고:')
    for (const w of warnings) console.warn(`  ⚠️  ${w}`)
  }
}
