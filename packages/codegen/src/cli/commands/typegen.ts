import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { writeOutput } from '../lib/output.js'
import { bool, choice, str, optStr } from '../lib/args.js'
import {
  closeCliIncrementalRun,
  createCliIncrementalRun,
  recordCliIncrementalIndex,
} from '../lib/incremental.js'
import type { WorkspaceDiagnosticRecord, WorkspaceTypeAliasRecord } from '../../workspace-index.js'
import type { ExternalSchemaTypeAlias } from '../../typegen/generate-types.js'

export const typegen: Command = {
  name: 'typegen',
  description: 'OAS spec → TypeScript 타입',
  options: {
    spec:          { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    output:        { type: 'string', short: 'o', description: '출력 파일 경로 (기본: stdout)' },
    style:         { type: 'string', description: 'type | interface (기본: type)' },
    incremental:   { type: 'boolean', description: 'SQLite workspace index를 사용해 변경 감지/무효화를 수행' },
    'cache-dir':   { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
  },
  async run(args) {
    const { analyzeExternalSchemaRefs, generateTypesFromSpec } = await import('../../typegen/generate-types.js')
    const specPath = str(args, 'spec')
    const cacheDir = optStr(args, 'cache-dir')
    const incremental = createCliIncrementalRun({
      enabled: bool(args, 'incremental'),
      specPath,
      ...(cacheDir ? { cacheDir } : {}),
    })
    try {
      const { document: doc, path: resolvedSpecPath } = loadSpecWithPath(specPath)
      const style = choice(args, 'style', ['type', 'interface'] as const, 'type')
      const warnings: string[] = []
      const externalAnalysis = analyzeExternalSchemaRefs(doc, resolvedSpecPath)
      const ts = generateTypesFromSpec(doc, { style, basePath: resolvedSpecPath, warnings, externalAnalysis })
      for (const warning of warnings) console.warn(`⚠️  ${warning}`)
      writeOutput(optStr(args, 'output'), ts, 'TypeScript 타입 생성')
      await recordCliIncrementalIndex(incremental, doc, {
        diagnostics: warnings.map(warning => toWorkspaceDiagnostic(resolvedSpecPath, warning)),
        typeAliases: externalAnalysis.typeAliases.map(alias => toWorkspaceTypeAlias(resolvedSpecPath, alias)),
      })
    } finally {
      closeCliIncrementalRun(incremental)
    }
  },
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
