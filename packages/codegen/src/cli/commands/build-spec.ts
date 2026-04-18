import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import { buildSpec, type BuildSpecDiagnostic } from '../lib/build-spec.js'

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
  },
  async run(args) {
    const fragmentsDir = optStr(args, 'fragments')
    const outputPath = optStr(args, 'output')
    const diagnosticsPath = optStr(args, 'diagnostics')
    const collisionReportPath = optStr(args, 'collision-report')
    const compositionReportPath = optStr(args, 'composition-report')
    const provenancePath = optStr(args, 'provenance')
    const result = buildSpec({
      targetPath: str(args, 'target'),
      ...(fragmentsDir ? { fragmentsDir } : {}),
      ...(outputPath ? { outputPath } : {}),
      ...(diagnosticsPath ? { diagnosticsPath } : {}),
      ...(collisionReportPath ? { collisionReportPath } : {}),
      ...(compositionReportPath ? { compositionReportPath } : {}),
      ...(provenancePath ? { provenancePath } : {}),
    })

    const summary = result.summary
    const details = [
      `${summary.fragmentCount} fragments`,
      `${summary.selectedNodeCount} selected nodes`,
      `${summary.errors} errors`,
      `${summary.warnings} warnings`,
      `${summary.infos} infos`,
    ].join(', ')

    if (result.valid) {
      const outputLabel = summary.outputPath ?? 'stdout'
      console.error(`build-spec: built "${summary.targetName}" to ${outputLabel} (${details})`)
      return
    }

    console.error(`build-spec: failed "${summary.targetName}" (${details})`)
    for (const diagnostic of result.diagnostics.filter(isErrorDiagnostic)) {
      console.error(formatDiagnostic(diagnostic))
    }
    process.exit(1)
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
