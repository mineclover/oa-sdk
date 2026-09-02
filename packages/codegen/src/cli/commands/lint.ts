import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { formatLintLocation } from '../lib/diagnostics.js'
import { createCliSourceLocationResolver } from '../lib/source-locations.js'
import { optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { LintCategory } from '@oa-sdk/parser'

export const ALLOWED_LINT_CATEGORIES: readonly LintCategory[] = [
  'structure',
  'operations',
  'parameters',
  'refs',
  'security',
  'style',
  'components',
  'surface',
]

export function isLintCategory(value: string): value is LintCategory {
  return (ALLOWED_LINT_CATEGORIES as readonly string[]).includes(value)
}

export function parseLintCategories(raw: string | string[] | undefined): LintCategory[] | undefined {
  if (raw === undefined) return undefined
  const rawList = Array.isArray(raw) ? raw : [raw]
  const items = rawList
    .flatMap(s => s.split(','))
    .map(s => s.trim())
    .filter(Boolean)
  if (items.length === 0) {
    throw new Error(
      `--categories 옵션에 하나 이상의 유효한 카테고리를 지정해야 합니다. 허용된 카테고리: ${ALLOWED_LINT_CATEGORIES.join(', ')}`,
    )
  }

  for (const item of items) {
    if (!isLintCategory(item)) {
      throw new Error(`--categories 값은 ${ALLOWED_LINT_CATEGORIES.join(' | ')} 중 하나여야 합니다: ${item}`)
    }
  }

  return items as LintCategory[]
}

export const lint: Command = {
  name: 'lint',
  description: 'OAS 3.2 스펙 린트',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    categories: {
      type: 'string',
      description: '실행할 규칙 카테고리 (쉼표 구분: structure, operations, parameters, refs, security, style, components, surface)',
    },
  },
  async run(args) {
    const { lintDocument } = await import('@oa-sdk/parser')
    const categories = parseLintCategories(optStr(args, 'categories') ?? (args.categories as string | string[] | undefined))
    const { document: doc, path: resolvedSpecPath, raw } = loadSpecWithPath(str(args, 'spec'))
    const sourceLocations = createCliSourceLocationResolver({ filePath: resolvedSpecPath, raw })
    const results = lintDocument(doc, {
      basePath: resolvedSpecPath,
      lookupSourceLocation: sourceLocations.lookup,
      ...(categories ? { categories } : {}),
    })

    for (const r of results) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
      console.log(`    at ${formatLintLocation(r, {
        defaultFilePath: resolvedSpecPath,
        lookupSourceLocation: sourceLocations.lookup,
      })}`)
    }

    const errors = results.filter(r => r.severity === 'error')
    const warnings = results.filter(r => r.severity === 'warning')
    const infos = results.filter(r => r.severity === 'info')
    console.log(`\n${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos`)

    if (errors.length > 0) throw new CliExitError(1)
  },
}
