import { readFileSync } from 'node:fs'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { formatLintLocation } from '../lib/diagnostics.js'
import { bool, optStr, str } from '../lib/args.js'
import { createCliSourceLocationResolver, type CliSourceLocationResolver } from '../lib/source-locations.js'
import {
  closeCliIncrementalRun,
  createCliIncrementalRun,
  recordCliIncrementalIndex,
} from '../lib/incremental.js'
import type { WorkspaceDiagnosticRecord } from '../../workspace-index.js'
import { CliExitError } from '../lib/errors.js'
import {
  isOpenApiProjectionProfile,
  OPENAPI_PROJECTION_PROFILES,
  validateOpenApiProjection,
  type OpenApiProjectionProfile,
  type SchemaValidateResult,
} from '@oa-sdk/openapi-projection-contract'

export const validate: Command = {
  name: 'validate',
  description: '종합 검증 (파싱 + 린트 + 3.1 호환)',
  options: {
    spec:          { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    profile:       { type: 'string', description: 'OpenAPI 프로젝션 프로필 (component-bundle | operation-contract | full-api-document)' },
    'require-32':  { type: 'boolean', description: '관리 대상 계약으로 OpenAPI 3.2.x 버전을 강제' },
    incremental:   { type: 'boolean', description: 'SQLite workspace index를 사용해 변경 감지/무효화를 수행' },
    'cache-dir':   { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
  },
  async run(args) {
    const { validateDocument } = await import('@oa-sdk/parser')
    const specPath = str(args, 'spec')
    const rawProfile = optStr(args, 'profile')
    if (rawProfile !== undefined && !isOpenApiProjectionProfile(rawProfile)) {
      throw new Error(`--profile 값은 ${OPENAPI_PROJECTION_PROFILES.join(' | ')} 중 하나여야 합니다: ${rawProfile}`)
    }
    const profile = rawProfile as OpenApiProjectionProfile | undefined

    const cacheDir = optStr(args, 'cache-dir')
    const incremental = createCliIncrementalRun({
      enabled: bool(args, 'incremental'),
      specPath,
      ...(cacheDir ? { cacheDir } : {}),
    })

    try {
      const { document: doc, path: resolvedSpecPath, raw } = loadSpecWithPath(specPath)
      const sourceLocations = createCliSourceLocationResolver({ filePath: resolvedSpecPath, raw })
      console.log('━━━ Step 1: 파싱 + 구조 검증 ━━━')
      const result = validateDocument(doc, {
        basePath: resolvedSpecPath,
        lookupSourceLocation: sourceLocations.lookup,
        requireOpenApi32: bool(args, 'require-32'),
      })

      for (const r of [...result.errors, ...result.warnings, ...result.infos]) {
        const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
        console.log(`  ${icon} [${r.rule}] ${r.message}`)
        console.log(`    at ${formatLintLocation(r, {
          defaultFilePath: resolvedSpecPath,
          lookupSourceLocation: sourceLocations.lookup,
        })}`)
      }
      console.log(result.summary)

      let profileResult: SchemaValidateResult | undefined
      if (profile) {
        console.log(`\n━━━ Step 1.5: 프로젝션 프로필 검증 (${profile}) ━━━`)
        profileResult = validateOpenApiProjection({
          profile,
          projection: doc as Record<string, unknown>,
          refs: [],
          diagnostics: [],
          sources: {},
          versionHash: 'cli-validation',
        })

        for (const d of profileResult.diagnostics) {
          const icon = d.severity === 'error' ? '❌' : d.severity === 'warning' ? '⚠️' : 'ℹ️'
          console.log(`  ${icon} [${d.code}] ${d.message}`)
        }
        const errors = profileResult.diagnostics.filter(d => d.severity === 'error')
        const warnings = profileResult.diagnostics.filter(d => d.severity === 'warning')
        const infos = profileResult.diagnostics.filter(d => d.severity === 'info')
        if (profileResult.valid) {
          console.log(`  ✅ 프로필 '${profile}' 요구사항 충족 (${profileResult.diagnostics.length} 진단)`)
        } else {
          console.log(`  ❌ 프로필 '${profile}' 요구사항 미충족: ${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos`)
        }
      }

      console.log('\n━━━ Step 2: 3.1 호환성 ━━━')
      const version = (doc as Record<string, unknown>)['openapi'] as string
      if (version === '3.2.0') {
        const raw = readFileSync(resolvedSpecPath, 'utf8')
        const features32 = [
          { name: 'dataValue', count: (raw.match(/dataValue/g) ?? []).length },
          { name: 'serializedValue', count: (raw.match(/serializedValue/g) ?? []).length },
          { name: 'itemSchema', count: (raw.match(/itemSchema/g) ?? []).length },
          { name: 'deviceAuthorization', count: (raw.match(/deviceAuthorization/g) ?? []).length },
          { name: 'oauth2MetadataUrl', count: (raw.match(/oauth2MetadataUrl/g) ?? []).length },
        ].filter(f => f.count > 0)

        if (features32.length > 0) {
          console.log('  3.2 전용 필드 사용:')
          for (const f of features32) console.log(`    ${f.name}: ${f.count}회`)
          console.log('  → pnpm --filter @oa-sdk/schemas run downgrade:3.1 로 3.1 변환 가능')
        } else {
          console.log('  3.2 전용 필드 미사용 — 3.1과 완전 호환')
        }
      } else {
        console.log(`  이미 OAS ${version} — 3.1 호환`)
      }

      await recordCliIncrementalIndex(incremental, doc, {
        diagnostics: [
          ...[...result.errors, ...result.warnings, ...result.infos].map(r => toWorkspaceDiagnostic(
            resolvedSpecPath,
            r,
            sourceLocations,
          )),
          ...(profileResult?.diagnostics ?? []).map(d => ({
            producer: 'validate' as const,
            severity: d.severity,
            code: d.code,
            message: d.message,
            filePath: resolvedSpecPath,
            pointer: '/',
          })),
        ],
      })

      if (!result.valid || (profileResult && !profileResult.valid)) throw new CliExitError(1)
    } finally {
      closeCliIncrementalRun(incremental)
    }
  },
}

function toWorkspaceDiagnostic(
  resolvedSpecPath: string,
  result: {
    severity: 'error' | 'warning' | 'info'
    rule: string
    message: string
    path: string
    source?: { sourceFilePath?: string; sourcePointer?: string; line?: number; column?: number }
  },
  sourceLocations: CliSourceLocationResolver,
): WorkspaceDiagnosticRecord {
  const filePath = result.source?.sourceFilePath ?? resolvedSpecPath
  const pointer = result.source?.sourcePointer ?? result.path
  const location = result.source?.line !== undefined && result.source.column !== undefined
    ? { line: result.source.line, column: result.source.column }
    : sourceLocations.lookup(filePath, pointer)
  const record: WorkspaceDiagnosticRecord = {
    producer: 'validate',
    severity: result.severity,
    code: result.rule,
    message: result.message,
    filePath,
    pointer,
  }
  if (location) {
    record.line = location.line
    record.column = location.column
  }
  return record
}
