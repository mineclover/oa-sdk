/**
 * check-api-index.ts — api-index.md와 실제 패키지 export의 정합성 검증
 *
 * 실행:
 *   tsx scripts/check-api-index.ts
 *
 * 동작:
 *   1. 각 패키지의 src/index.ts에서 export된 이름을 추출
 *   2. docs/internal/api-index.md에서 문서화된 이름을 추출
 *   3. 누락(코드에 있는데 문서 없음) / 고아(문서에 있는데 코드 없음) 보고
 *
 * 종료 코드:
 *   0 — 정합
 *   1 — 불일치 존재
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiIndexPackages, assertRootExport, compareExportNames, extractDocNames, extractExportsFromFile } from './lib/api-index.js'
import { execaSync } from 'execa'

const { stdout } = execaSync('git', ['rev-parse', '--show-toplevel'])
const root = stdout.trim()

const CODEGEN_TYPEGEN_OPTION_EXPORTS = ['TypegenOptions', 'SchemaToTsOptions'] as const

function checkCodegenTypegenOptionPolicy(apiIndexPath: string): string[] {
  const issues: string[] = []
  const content = readFileSync(apiIndexPath, 'utf-8')
  const packageJson = JSON.parse(
    readFileSync(join(root, 'packages/codegen/package.json'), 'utf-8'),
  ) as { exports?: Record<string, unknown> }
  const rootExports = extractExportsFromFile(join(root, 'packages/codegen/src/index.ts')).names
  const typegenExports = extractExportsFromFile(join(root, 'packages/codegen/src/typegen/index.ts')).names

  if (!content.includes('@oa-sdk/codegen/typegen')) {
    issues.push('API index must document the supported `@oa-sdk/codegen/typegen` sub-entrypoint')
  }

  if (!packageJson.exports?.['./typegen']) {
    issues.push('`@oa-sdk/codegen/typegen` is documented but missing from packages/codegen/package.json exports')
  }

  for (const name of CODEGEN_TYPEGEN_OPTION_EXPORTS) {
    if (!content.includes(`\`${name}\``)) {
      issues.push(`API index must document \`${name}\` for codegen typegen option imports`)
    }
    if (!rootExports.has(name)) {
      issues.push(`packages/codegen/src/index.ts must export \`${name}\``)
    }
    if (!typegenExports.has(name)) {
      issues.push(`packages/codegen/src/typegen/index.ts must export \`${name}\``)
    }
  }

  return issues
}

function main() {
  const apiIndexPath = join(root, 'docs/internal/api-index.md')
  const documentation = readFileSync(apiIndexPath, 'utf8')
  const docNames = extractDocNames(documentation)
  const packages = apiIndexPackages(root)

  let hasIssue = false
  const report: string[] = []

  for (const pkg of packages) {
    const entryPath = join(root, 'packages', pkg, 'src/index.ts')
    let codeNames: Set<string>
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'))
      if (manifest.name !== `@oa-sdk/${pkg}`) throw new Error('Package manifest identity mismatch')
      if (pkg === 'schemas') {
        // The schema package exports data assets, not a TypeScript barrel.
        if (!docNames.has(pkg)) throw new Error('Missing asset package documentation')
        const assetSection = documentation.split(/^## /m).find(section => section.includes('(`@oa-sdk/schemas`)')) ?? ''
        if (!manifest.exports?.['.']) throw new Error('Schema package root asset is missing')
        const assetRows = new Map([...assetSection.matchAll(/^\|\s*`(\.(?:\/[^`]+)?)`\s*\|\s*`([^`]+)`/gm)].map(match => [match[1]!, match[2]!]))
        for (const [specifier, target] of Object.entries(manifest.exports ?? {})) {
          if (typeof target !== 'string' || !/\.(?:json|yaml)$/.test(target)) throw new Error(`Unsupported schema asset target ${specifier}`)
          if (assetRows.get(specifier) !== target) throw new Error(`Undocumented schema asset ${specifier}: ${target}`)
        }
        for (const specifier of assetRows.keys()) if (!(specifier in manifest.exports)) throw new Error(`Orphaned schema asset ${specifier}`)
        continue
      }
      assertRootExport(manifest.exports?.['.'])
      codeNames = extractExportsFromFile(entryPath).names
      if (!codeNames.size) throw new Error('No public exports found')
    } catch (error) {
      hasIssue = true
      report.push(`\n### @oa-sdk/${pkg}\n  ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const docNamesForPkg = docNames.get(pkg) ?? new Set<string>()
    const { missing, orphaned } = compareExportNames(codeNames, docNamesForPkg)

    if (missing.length || orphaned.length) {
      hasIssue = true
      report.push(`\n### @oa-sdk/${pkg}`)
      if (missing.length) {
        report.push(`  Missing from docs: ${missing.map(n => `\`${n}\``).join(', ')}`)
      }
      if (orphaned.length) {
        report.push(`  Orphaned in docs:  ${orphaned.map(n => `\`${n}\``).join(', ')}`)
      }
    }
  }

  const codegenTypegenIssues = checkCodegenTypegenOptionPolicy(apiIndexPath)
  if (codegenTypegenIssues.length) {
    hasIssue = true
    report.push('\n### @oa-sdk/codegen/typegen')
    for (const issue of codegenTypegenIssues) {
      report.push(`  ${issue}`)
    }
  }

  if (hasIssue) {
    console.log('## API Index Drift Report\n')
    console.log(report.join('\n'))
    console.log('\n\nUpdate docs/internal/api-index.md to match actual exports.')
    process.exit(1)
  } else {
    console.log(`API index is in sync with ${packages.length} packages (release policy + DPM; schemas checked as assets).`)
    process.exit(0)
  }
}

main()
