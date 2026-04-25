import { resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import { buildSpec, type BuildSpecDiagnostic } from '../lib/build-spec.js'
import {
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../lib/behavior-recorder.js'

export const buildSpecCommand: Command = {
  name: 'build-spec',
  description: 'Definition fragments에서 target OpenAPI 문서 빌드',
  options: {
    target:             { type: 'string', short: 't', required: true, description: 'target config 파일 경로' },
    fragments:          { type: 'string', description: 'definition fragments 디렉토리 (기본: target sibling ../fragments)' },
    output:             { type: 'string', short: 'o', description: '빌드된 OpenAPI YAML 출력 파일 경로' },
    diagnostics:        { type: 'string', description: 'builder diagnostics JSON 출력 파일 경로' },
    'collision-report': { type: 'string', description: 'machine-readable output name collision report JSON 출력 파일 경로' },
    'composition-report': { type: 'string', description: 'machine-readable target composition report JSON 출력 파일 경로' },
    provenance: { type: 'string', description: 'machine-readable output pointer provenance map JSON 출력 파일 경로' },
    'metadata-registry': { type: 'string', description: 'machine-readable internal metadata registry JSON 출력 파일 경로' },
    'behavior-log': { type: 'string', description: 'append-only behavior JSONL 출력 파일 경로' },
    'behavior-db': { type: 'string', description: 'append-only behavior SQLite DB 파일 경로' },
  },
  async run(args) {
    const fragmentsDir = optStr(args, 'fragments')
    const outputPath = optStr(args, 'output')
    const diagnosticsPath = optStr(args, 'diagnostics')
    const collisionReportPath = optStr(args, 'collision-report')
    const compositionReportPath = optStr(args, 'composition-report')
    const provenancePath = optStr(args, 'provenance')
    const metadataRegistryPath = optStr(args, 'metadata-registry')
    const behaviorLogPath = optStr(args, 'behavior-log')
    const behaviorDbPath = optStr(args, 'behavior-db')
    const targetPath = str(args, 'target')
    const behaviorRecorder = createBehaviorRecorderFromOptions({
      ...(behaviorLogPath !== undefined ? { jsonlPath: behaviorLogPath } : {}),
      ...(behaviorDbPath !== undefined ? { sqlitePath: behaviorDbPath } : {}),
    })
    const startedAt = Date.now()

    try {
      const result = buildSpec({
        targetPath,
        ...(fragmentsDir ? { fragmentsDir } : {}),
        ...(outputPath ? { outputPath } : {}),
        ...(diagnosticsPath ? { diagnosticsPath } : {}),
        ...(collisionReportPath ? { collisionReportPath } : {}),
        ...(compositionReportPath ? { compositionReportPath } : {}),
        ...(provenancePath ? { provenancePath } : {}),
        ...(metadataRegistryPath ? { metadataRegistryPath } : {}),
      })

      const summary = result.summary
      const targetKey = summary.targetName
      const details = [
        `${summary.fragmentCount} fragments`,
        `${summary.selectedNodeCount} selected nodes`,
        `${summary.errors} errors`,
        `${summary.warnings} warnings`,
        `${summary.infos} infos`,
      ].join(', ')

      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'build_openapi_target',
        status: result.valid ? 'succeeded' : 'failed',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'definition-target',
            targetKey,
            targetPath: summary.targetPath,
            targetName: summary.targetName,
          },
          input: {
            targetPath: summary.targetPath,
            ...(fragmentsDir ? { fragmentsDir } : {}),
            ...(outputPath ? { outputPath } : {}),
            ...(diagnosticsPath ? { diagnosticsPath } : {}),
            ...(collisionReportPath ? { collisionReportPath } : {}),
            ...(compositionReportPath ? { compositionReportPath } : {}),
            ...(provenancePath ? { provenancePath } : {}),
            ...(metadataRegistryPath ? { metadataRegistryPath } : {}),
          },
          context: {
            command: 'build-spec',
            source: 'cli',
          },
          decision: {
            primarySignal: result.valid ? 'build-valid' : 'build-invalid',
            decisionReason: result.valid
              ? 'builder diagnostics contain no errors'
              : 'builder diagnostics contain one or more errors',
          },
          result: {
            valid: summary.valid,
            fragmentCount: summary.fragmentCount,
            selectedNodeCount: summary.selectedNodeCount,
            errors: summary.errors,
            warnings: summary.warnings,
            infos: summary.infos,
            ...(summary.outputPath ? { outputPath: summary.outputPath } : {}),
            errorCodes: result.diagnostics
              .filter(isErrorDiagnostic)
              .map(diagnostic => diagnostic.code),
          },
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))

      if (result.valid) {
        const outputLabel = summary.outputPath ?? 'stdout'
        console.error(`build-spec: built "${summary.targetName}" to ${outputLabel} (${details})`)
        behaviorRecorder.close?.()
        return
      }

      console.error(`build-spec: failed "${summary.targetName}" (${details})`)
      for (const diagnostic of result.diagnostics.filter(isErrorDiagnostic)) {
        console.error(formatDiagnostic(diagnostic))
      }
      behaviorRecorder.close?.()
      process.exit(1)
    } catch (error) {
      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'build_openapi_target',
        status: 'failed',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'definition-target',
            targetKey: resolve(targetPath),
            targetPath: resolve(targetPath),
          },
          input: {
            targetPath: resolve(targetPath),
            ...(fragmentsDir ? { fragmentsDir } : {}),
            ...(outputPath ? { outputPath } : {}),
            ...(diagnosticsPath ? { diagnosticsPath } : {}),
            ...(collisionReportPath ? { collisionReportPath } : {}),
            ...(compositionReportPath ? { compositionReportPath } : {}),
            ...(provenancePath ? { provenancePath } : {}),
            ...(metadataRegistryPath ? { metadataRegistryPath } : {}),
          },
          context: {
            command: 'build-spec',
            source: 'cli',
          },
          decision: {
            primarySignal: 'build-exception',
            decisionReason: 'build-spec raised an exception before producing a summary',
          },
          result: {
            valid: false,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))
      behaviorRecorder.close?.()
      throw error
    }
  },
}

function isErrorDiagnostic(diagnostic: BuildSpecDiagnostic): boolean {
  return diagnostic.severity === 'error'
}

function formatDiagnostic(diagnostic: BuildSpecDiagnostic): string {
  const location = readLocation(diagnostic)
  return location
    ? `  error ${diagnostic.code}: ${diagnostic.message} (${location})`
    : `  error ${diagnostic.code}: ${diagnostic.message}`
}

function readLocation(diagnostic: BuildSpecDiagnostic): string | undefined {
  if ('sourcePath' in diagnostic && typeof diagnostic.sourcePath === 'string') {
    return `${diagnostic.sourcePath}${diagnostic.sourcePointer ?? ''}`
  }
  if ('path' in diagnostic && typeof diagnostic.path === 'string') return diagnostic.path
  if ('pointer' in diagnostic && typeof diagnostic.pointer === 'string') return diagnostic.pointer
  return undefined
}
