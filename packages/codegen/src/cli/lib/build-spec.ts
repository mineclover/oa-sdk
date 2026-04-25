import {
  mkdirSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  join,
  resolve,
} from 'node:path'
import {
  createDefinitionRegistry,
  emitDefinitionOpenApiDocument,
  selectDefinitionTarget,
  toDefinitionOpenApiProjectionResult,
  type DefinitionOpenApiEmitDiagnostic,
  type DefinitionOpenApiProjectionResult,
  type DefinitionOutputNameCollisionReportEntry,
  type DefinitionRegistryDiagnostic,
  type OasDocument,
  type SourceLocationIndex,
} from '@oa-sdk/parser'
import type { SchemaDiagnostic } from '@oa-sdk/openapi-projection-contract'
import { stringify as stringifyYaml } from 'yaml'
import {
  detectBuilderDirtyTargets,
  recordBuilderWorkspaceIndex,
  scanBuilderWorkspaceFiles,
  type BuilderDirtyTargetResult,
} from '../../builder-index.js'
import type { WorkspaceIndex } from '../../workspace-index.js'
import {
  createBuildSpecCompositionReport,
  type BuildSpecCompositionReport,
} from './composition-report.js'
import {
  createBuildSpecMetadataRegistry,
  type BuildSpecMetadataRegistry,
  type BuildSpecMetadataRegistryDiagnostic,
} from './metadata-registry.js'
import {
  createBuildSpecProvenanceMap,
  type BuildSpecProvenanceMap,
} from './provenance-report.js'
import {
  loadDefinitionFragments,
  loadDefinitionTargetConfig,
  lookupDefinitionSourceLocation,
  type DefinitionFragmentLoadDiagnostic,
} from './definition-fragments.js'

export type BuildSpecOptions = {
  targetPath: string
  fragmentsDir?: string
  outputPath?: string
  diagnosticsPath?: string
  collisionReportPath?: string
  compositionReportPath?: string
  provenancePath?: string
  metadataRegistryPath?: string
  writeOutput?: boolean
  workspaceIndex?: WorkspaceIndex
  parserVersion?: string
  runId?: string
}

export type BuildSpecCliDiagnostic = DefinitionFragmentLoadDiagnostic

export type BuildSpecDiagnostic =
  | BuildSpecCliDiagnostic
  | BuildSpecMetadataRegistryDiagnostic
  | DefinitionRegistryDiagnostic
  | DefinitionOpenApiEmitDiagnostic

export type BuildSpecSummary = {
  valid: boolean
  targetName: string
  targetPath: string
  fragmentsDir: string
  fragmentCount: number
  selectedNodeCount: number
  directPathIds: string[]
  directDefinitionIds: string[]
  dirtyTargetPaths?: string[]
  dirtyTargetNames?: string[]
  outputPath?: string
  diagnosticsPath?: string
  collisionReportPath?: string
  compositionReportPath?: string
  provenancePath?: string
  metadataRegistryPath?: string
  errors: number
  warnings: number
  infos: number
}

export type BuildSpecResult = {
  valid: boolean
  document: OasDocument
  projection: DefinitionOpenApiProjectionResult
  diagnostics: BuildSpecDiagnostic[]
  collisionReport: DefinitionOutputNameCollisionReportEntry[]
  compositionReport: BuildSpecCompositionReport
  provenance: BuildSpecProvenanceMap
  metadataRegistry: BuildSpecMetadataRegistry
  summary: BuildSpecSummary
  dirty?: BuilderDirtyTargetResult
}

export function buildSpec(options: BuildSpecOptions): BuildSpecResult {
  const targetPath = resolve(process.cwd(), options.targetPath)
  const fragmentsDir = resolve(
    process.cwd(),
    options.fragmentsDir ?? join(dirname(targetPath), '..', 'fragments'),
  )
  const target = loadDefinitionTargetConfig(targetPath)
  const fragments = loadDefinitionFragments(fragmentsDir)
  const scannedFiles = options.workspaceIndex
    ? scanBuilderWorkspaceFiles({
      targetPaths: [targetPath],
      fragmentPaths: fragments.filePaths,
      ...(options.parserVersion ? { parserVersion: options.parserVersion } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
    })
    : []
  const dirty = options.workspaceIndex
    ? detectBuilderDirtyTargets(options.workspaceIndex, scannedFiles, { targetPaths: [targetPath] })
    : undefined
  const registry = createDefinitionRegistry(fragments.nodes, {
    lookupSourceLocation(sourcePath, sourcePointer) {
      return lookupDefinitionSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
    },
  })
  const selection = selectDefinitionTarget(registry, target)
  const emitted = emitDefinitionOpenApiDocument(selection)
  const baseProjection = toDefinitionOpenApiProjectionResult({ registry, selection, emitted }, {
    lookupSourceLocation(sourcePath, sourcePointer) {
      return lookupDefinitionSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
    },
  })
  const projection: DefinitionOpenApiProjectionResult = fragments.diagnostics.length === 0
    ? baseProjection
    : {
        ...baseProjection,
        diagnostics: [
          ...fragments.diagnostics.map(diagnostic => toProjectionDiagnostic(
            diagnostic,
            fragments.sourceLocations,
          )),
          ...baseProjection.diagnostics,
        ],
      }
  const metadataRegistryResult = createBuildSpecMetadataRegistry(selection)
  const metadataRegistry = metadataRegistryResult.registry
  const diagnostics: BuildSpecDiagnostic[] = [
    ...fragments.diagnostics,
    ...registry.diagnostics,
    ...emitted.diagnostics,
    ...metadataRegistryResult.diagnostics,
  ]
  const valid = diagnostics.every(diagnostic => diagnostic.severity !== 'error')
  const outputPath = options.outputPath ? resolve(process.cwd(), options.outputPath) : undefined
  const diagnosticsPath = options.diagnosticsPath ? resolve(process.cwd(), options.diagnosticsPath) : undefined
  const collisionReportPath = options.collisionReportPath
    ? resolve(process.cwd(), options.collisionReportPath)
    : undefined
  const compositionReportPath = options.compositionReportPath
    ? resolve(process.cwd(), options.compositionReportPath)
    : undefined
  const provenancePath = options.provenancePath
    ? resolve(process.cwd(), options.provenancePath)
    : undefined
  const metadataRegistryPath = options.metadataRegistryPath
    ? resolve(process.cwd(), options.metadataRegistryPath)
    : undefined
  const compositionReport = createBuildSpecCompositionReport({
    targetPath,
    fragmentsDir,
    target,
    registry,
    selection,
    emitted,
  })
  const provenance = createBuildSpecProvenanceMap(selection)
  const summary: BuildSpecSummary = {
    valid,
    targetName: target.name,
    targetPath,
    fragmentsDir,
    fragmentCount: fragments.nodes.length,
    selectedNodeCount: selection.nodes.length,
    directPathIds: selection.directPathIds,
    directDefinitionIds: selection.directDefinitionIds,
    errors: diagnostics.filter(diagnostic => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length,
    infos: diagnostics.filter(diagnostic => diagnostic.severity === 'info').length,
  }

  if (outputPath !== undefined) summary.outputPath = outputPath
  if (diagnosticsPath !== undefined) summary.diagnosticsPath = diagnosticsPath
  if (collisionReportPath !== undefined) summary.collisionReportPath = collisionReportPath
  if (compositionReportPath !== undefined) summary.compositionReportPath = compositionReportPath
  if (provenancePath !== undefined) summary.provenancePath = provenancePath
  if (metadataRegistryPath !== undefined) summary.metadataRegistryPath = metadataRegistryPath
  if (dirty !== undefined) {
    summary.dirtyTargetPaths = dirty.dirtyTargetPaths
    summary.dirtyTargetNames = dirty.dirtyTargetNames
  }

  if (diagnosticsPath !== undefined) {
    writeJsonFile(diagnosticsPath, {
      valid,
      summary,
      diagnostics,
    })
  }

  if (collisionReportPath !== undefined) {
    writeJsonFile(collisionReportPath, emitted.report.collisionReport)
  }

  if (compositionReportPath !== undefined) {
    writeJsonFile(compositionReportPath, compositionReport)
  }

  if (provenancePath !== undefined) {
    writeJsonFile(provenancePath, provenance)
  }

  if (metadataRegistryPath !== undefined) {
    writeJsonFile(metadataRegistryPath, metadataRegistry)
  }

  if (valid && options.writeOutput !== false) {
    const yaml = stringifyYaml(emitted.document)
    if (outputPath !== undefined) {
      writeTextFile(outputPath, yaml)
    } else {
      process.stdout.write(yaml)
    }
  }

  if (options.workspaceIndex !== undefined) {
    recordBuilderWorkspaceIndex({
      index: options.workspaceIndex,
      files: scannedFiles,
      targetPath,
      target,
      registry,
      selection,
    })
  }

  return {
    valid,
    document: emitted.document,
    projection,
    diagnostics,
    collisionReport: emitted.report.collisionReport,
    compositionReport,
    provenance,
    metadataRegistry,
    summary,
    ...(dirty !== undefined ? { dirty } : {}),
  }
}

function toProjectionDiagnostic(
  diagnostic: BuildSpecCliDiagnostic,
  sourceLocations: ReadonlyMap<string, SourceLocationIndex>,
): SchemaDiagnostic {
  const pointer = diagnostic.sourcePointer ?? '#'
  const location = lookupDefinitionSourceLocation(sourceLocations, diagnostic.sourcePath, pointer)

  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    source: {
      kind: 'file',
      filePath: diagnostic.sourcePath,
      pointer,
      ...(location?.line !== undefined ? { line: location.line } : {}),
      ...(location?.column !== undefined ? { column: location.column } : {}),
    },
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeTextFile(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, value, 'utf8')
}
