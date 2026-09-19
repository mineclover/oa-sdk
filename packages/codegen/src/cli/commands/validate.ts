import { readFileSync, existsSync } from 'node:fs'
import { relative, join } from 'node:path'
import { validateDocument } from '@oa-sdk/parser'
import type { Command, CommandArgValue } from '../lib/types.js'
import { loadSpecDocumentAsync } from '../lib/load-spec.js'
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
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import { projectTargetSpec } from '../../spec-projector.js'
import type { OaConfig } from '../../config.js'

export const validate: Command = {
  name: 'validate',
  description: '종합 검증 (파싱 + 린트 + 3.1 호환)',
  options: {
    spec: {
      type: 'string',
      short: 's',
      description: 'OAS spec 파일 경로',
    },
    config: {
      type: 'string',
      short: 'c',
      description: '설정 파일 경로',
    },
    profile:       { type: 'string', description: 'OpenAPI 프로젝션 프로필 (component-bundle | operation-contract | full-api-document)' },
    'require-32':  { type: 'boolean', description: '관리 대상 계약으로 OpenAPI 3.2.x 버전을 강제' },
    incremental:   { type: 'boolean', description: 'SQLite workspace index를 사용해 변경 감지/무효화를 수행' },
    'cache-dir':   { type: 'string', description: '증분 workspace index 디렉토리 (기본: ./.oa-cache)' },
  },
  async run(args, context) {
    const specPath = optStr(args, 'spec')
    const configPath = optStr(args, 'config')

    // 1. Single-spec validation mode (when --spec is provided)
    if (specPath) {
      await runSingleSpec(specPath, args)
      return
    }

    // 2. Config-driven multi-target validation mode (when invoked with --config or no arguments)
    const loaded = await loadOaConfig({
      ...(configPath ? { configPath } : {}),
      ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
      ...(context?.projectRoot !== undefined ? { explicitRoot: context.projectRoot } : {}),
    })

    if (!loaded) {
      console.error('오류: oa.config.ts 설정 파일을 찾을 수 없으며, --spec <경로> 옵션이 필요합니다')
      throw new CliExitError(1)
    }

    const specs = loaded.config.specs ?? []
    if (specs.length === 0) {
      console.error('오류: 설정 파일에 specs 목록이 비어 있습니다')
      throw new CliExitError(1)
    }

    await runConfigDrivenValidation(loaded.config, loaded.rootDir)
  },
}

interface TargetValidationRow {
  id: string
  profile: string
  status: 'PASS' | 'FAIL'
  errors: number
  warnings: number
  artifactPath: string
  diagnostics: string[]
}

async function runConfigDrivenValidation(config: OaConfig, rootDir: string): Promise<void> {
  const { validateDocument } = await import('@oa-sdk/parser')
  const specs = config.specs ?? []
  const rows: TargetValidationRow[] = []
  let overallFailed = false

  console.log('\n🔍 [oa-gen validate] Validating Declarative Specification Targets...')
  console.log(`   Project Root: ${rootDir}\n`)

  for (const target of specs) {
    const resolved = resolveProfileTarget(target, rootDir)
    const artifactPath = join(resolved.resolvedOutDir, `${target.id}.openapi.json`)

    let doc: Record<string, unknown>
    let resolvedSpecPath = artifactPath

    // If artifact exists on disk, validate stored artifact; otherwise project in-memory
    if (existsSync(artifactPath)) {
      try {
        const raw = readFileSync(artifactPath, 'utf8')
        doc = JSON.parse(raw)
      } catch (err: any) {
        rows.push({
          id: target.id,
          profile: target.profile ?? 'full-api-document',
          status: 'FAIL',
          errors: 1,
          warnings: 0,
          artifactPath: relative(rootDir, artifactPath),
          diagnostics: [`Failed to parse spec artifact JSON: ${err.message}`],
        })
        overallFailed = true
        continue
      }
    } else {
      try {
        const projected = await projectTargetSpec(target, rootDir)
        doc = projected.openApiDoc
      } catch (err: any) {
        rows.push({
          id: target.id,
          profile: target.profile ?? 'full-api-document',
          status: 'FAIL',
          errors: 1,
          warnings: 0,
          artifactPath: relative(rootDir, artifactPath) + ' (projected)',
          diagnostics: [`Failed to project spec from source: ${err.message}`],
        })
        overallFailed = true
        continue
      }
    }

    const targetDiagnostics: string[] = []

    // 1. Structure & Parser validation
    const parserResult = validateDocument(doc, { basePath: resolvedSpecPath, requireOpenApi32: false })
    const parserErrorsList = parserResult.errors.filter(e => {
      // In OpenAPI 3.1, circular references within components.schemas (e.g. recursive trees like VisualNode)
      // are standard recursive schema definitions.
      if (isRecursiveRefCycle(e as any)) {
        return false
      }
      targetDiagnostics.push(`[parser:error] ${e.message}`)
      return true
    })
    const parserErrors = parserErrorsList.length
    const parserWarnings = parserResult.warnings.length

    for (const w of parserResult.warnings) {
      targetDiagnostics.push(`[parser:warning] ${w.message}`)
    }

    // 2. Profile conformance validation
    const envelope = {
      profile: target.profile,
      projection: doc,
      refs: (doc['x-schema-engine-refs'] as any[]) ?? [],
      diagnostics: [],
      sources: (doc['x-schema-engine-sources'] as Record<string, any>) ?? {},
      versionHash: (doc['x-schema-engine-version-hash'] as string) ?? 'cli-validation',
    }

    const profileResult = validateOpenApiProjection(envelope)
    const profileErrors = profileResult.diagnostics.filter(d => d.severity === 'error').length
    const profileWarnings = profileResult.diagnostics.filter(d => d.severity === 'warning').length

    for (const d of profileResult.diagnostics) {
      targetDiagnostics.push(`[profile:${d.severity}] [${d.code}] ${d.message}`)
    }

    const totalErrors = parserErrors + profileErrors
    const totalWarnings = parserWarnings + profileWarnings
    const isPass = totalErrors === 0

    if (!isPass) {
      overallFailed = true
    }

    rows.push({
      id: target.id,
      profile: target.profile ?? 'full-api-document',
      status: isPass ? 'PASS' : 'FAIL',
      errors: totalErrors,
      warnings: totalWarnings,
      artifactPath: relative(rootDir, artifactPath),
      diagnostics: targetDiagnostics,
    })
  }

  // Print Formatted Report Table
  console.log('================================================================================')
  console.log('                    OA-SDK SPECIFICATION VALIDATION REPORT                      ')
  console.log('================================================================================')
  console.log(`${'Target ID'.padEnd(20)} ${'Profile'.padEnd(20)} ${'Status'.padEnd(10)} ${'Errors'.padEnd(8)} ${'Warnings'.padEnd(10)} Artifact`)
  console.log('--------------------------------------------------------------------------------')

  for (const r of rows) {
    const statusIcon = r.status === 'PASS' ? '🟢 PASS' : '🔴 FAIL'
    console.log(
      `${r.id.padEnd(20)} ${r.profile.padEnd(20)} ${statusIcon.padEnd(10)} ${String(r.errors).padEnd(8)} ${String(r.warnings).padEnd(10)} ${r.artifactPath}`
    )
    if (r.diagnostics.length > 0 && r.status === 'FAIL') {
      for (const diag of r.diagnostics) {
        console.log(`   ⚠️  ${diag}`)
      }
    }
  }

  const passCount = rows.filter(r => r.status === 'PASS').length
  const failCount = rows.filter(r => r.status === 'FAIL').length
  console.log('================================================================================')
  console.log(`Summary: ${rows.length} total targets, ${passCount} passed, ${failCount} failed.`)
  console.log('================================================================================\n')

  if (overallFailed) {
    throw new CliExitError(1)
  }
}

async function runSingleSpec(specPath: string, args: Record<string, CommandArgValue>): Promise<void> {
  const { validateDocument } = await import('@oa-sdk/parser')
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
    const { document: doc, path: resolvedSpecPath, raw } = await loadSpecDocumentAsync(specPath)
    const sourceLocations = createCliSourceLocationResolver({ filePath: resolvedSpecPath, raw })
    console.log('━━━ Step 1: 파싱 + 구조 검증 ━━━')
    const result = validateDocument(doc, {
      basePath: resolvedSpecPath,
      lookupSourceLocation: sourceLocations.lookup,
      requireOpenApi32: bool(args, 'require-32'),
    })

    const parserErrorsList = result.errors.filter(e => !isRecursiveRefCycle(e as any))

    for (const r of [...parserErrorsList, ...result.warnings, ...result.infos]) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
      console.log(`    at ${formatLintLocation(r, {
        defaultFilePath: resolvedSpecPath,
        lookupSourceLocation: sourceLocations.lookup,
      })}`)
    }
    const isValid = parserErrorsList.length === 0
    const summary = isValid
      ? `✅ Valid — ${result.warnings.length} warnings, ${result.infos.length} infos`
      : `❌ Invalid — ${parserErrorsList.length} errors, ${result.warnings.length} warnings`
    console.log(summary)

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
      const rawContent = readFileSync(resolvedSpecPath, 'utf8')
      const features32 = [
        { name: 'dataValue', count: (rawContent.match(/dataValue/g) ?? []).length },
        { name: 'serializedValue', count: (rawContent.match(/serializedValue/g) ?? []).length },
        { name: 'itemSchema', count: (rawContent.match(/itemSchema/g) ?? []).length },
        { name: 'deviceAuthorization', count: (rawContent.match(/deviceAuthorization/g) ?? []).length },
        { name: 'oauth2MetadataUrl', count: (rawContent.match(/oauth2MetadataUrl/g) ?? []).length },
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
        ...[...parserErrorsList, ...result.warnings, ...result.infos].map(r => toWorkspaceDiagnostic(
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

    if (!isValid || (profileResult && !profileResult.valid)) throw new CliExitError(1)
  } finally {
    closeCliIncrementalRun(incremental)
  }
}

function isRecursiveRefCycle(diagnostic: { message?: string; code?: string; rule?: string }): boolean {
  // In OpenAPI 3.1, circular references within components.schemas (e.g. recursive trees like VisualNode)
  // are standard recursive schema definitions.
  return (
    diagnostic.message?.includes('순환 $ref 감지') === true ||
    diagnostic.code === 'ref-cycle' ||
    diagnostic.rule === 'refs/cycle'
  )
}

function toWorkspaceDiagnostic(
  resolvedSpecPath: string,
  result: {
    severity: 'error' | 'warning' | 'info'
    rule: string
    message: string
    path: string
    source?: { sourceFilePath?: string | undefined; sourcePointer?: string | undefined; line?: number | undefined; column?: number | undefined } | undefined
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
