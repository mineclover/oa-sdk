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
import { join, dirname } from 'node:path'
import { execaSync } from 'execa'

const { stdout } = execaSync('git', ['rev-parse', '--show-toplevel'])
const root = stdout.trim()

// ── 패키지 export 추출 (정규식 기반, 빌드 불필요) ──────────

interface ExportInfo {
  names: Set<string>
  /** re-export 소스 파일 (export * from './foo' 등) */
  reExportFiles: string[]
}

function extractExportsFromFile(filePath: string, visited = new Set<string>()): ExportInfo {
  if (visited.has(filePath)) return { names: new Set(), reExportFiles: [] }
  visited.add(filePath)

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return { names: new Set(), reExportFiles: [] }
  }

  const names = new Set<string>()
  const reExportFiles: string[] = []

  // export { Foo, Bar } from './module'
  // export { Foo as Bar } from './module'
  for (const m of content.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const items = m[1]
    for (const item of items.split(',')) {
      const trimmed = item.trim()
      if (!trimmed) continue
      // "Foo as Bar" → Bar, "Foo" → Foo
      const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/)
      names.add(asMatch ? asMatch[1] : trimmed.split(/\s/)[0])
    }
  }

  // export type { Foo, Bar } from './module'
  for (const m of content.matchAll(/export\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const item of m[1].split(',')) {
      const trimmed = item.trim()
      if (!trimmed) continue
      const asMatch = trimmed.match(/\w+\s+as\s+(\w+)/)
      names.add(asMatch ? asMatch[1] : trimmed.split(/\s/)[0])
    }
  }

  // export * from './module' / export type * from './module' → follow
  for (const m of content.matchAll(/export\s+(?:type\s+)?\*\s*from\s*['"]([^'"]+)['"]/g)) {
    const rel = m[1]
    const resolvedDir = dirname(filePath)
    // .js → .ts resolve (ESM TypeScript convention)
    const base = rel.replace(/\.js$/, '')
    const candidates = [
      join(resolvedDir, base + '.ts'),
      join(resolvedDir, base, 'index.ts'),
      join(resolvedDir, base + '/index.ts'),
      join(resolvedDir, rel),
    ]
    for (const candidate of candidates) {
      try {
        readFileSync(candidate)
        reExportFiles.push(candidate)
        const sub = extractExportsFromFile(candidate, visited)
        for (const n of sub.names) names.add(n)
        break
      } catch { /* try next */ }
    }
  }

  // export function foo(
  for (const m of content.matchAll(/export\s+function\s+(\w+)/g)) {
    names.add(m[1])
  }

  // export const foo =
  for (const m of content.matchAll(/export\s+const\s+(\w+)/g)) {
    names.add(m[1])
  }

  // export class Foo
  for (const m of content.matchAll(/export\s+(?:abstract\s+)?class\s+(\w+)/g)) {
    names.add(m[1])
  }

  // export type Foo =
  for (const m of content.matchAll(/export\s+type\s+(\w+)\s*[=<{]/g)) {
    names.add(m[1])
  }

  // export interface Foo
  for (const m of content.matchAll(/export\s+interface\s+(\w+)/g)) {
    names.add(m[1])
  }

  // export enum Foo
  for (const m of content.matchAll(/export\s+enum\s+(\w+)/g)) {
    names.add(m[1])
  }

  return { names, reExportFiles }
}

// ── api-index.md에서 이름 추출 ──────────────────────────────

function extractDocNames(mdPath: string): Map<string, Set<string>> {
  const content = readFileSync(mdPath, 'utf-8')
  const pkgMap = new Map<string, Set<string>>()

  // 패키지 섹션 감지: ## ... (`@oa-sdk/xxx`)
  let currentPkg: string | null = null
  let isInternal = false
  for (const line of content.split('\n')) {
    // 섹션 제목 감지
    if (line.startsWith('#')) {
      const pkgMatch = line.match(/@oa-sdk\/(\w[\w-]*)/)
      if (pkgMatch) {
        currentPkg = pkgMatch[1]
        // "내부 함수" / "index 미노출" / "재구현 금지" 섹션은 제외
        isInternal = /내부|미노출|internal|재구현|금지|re-export/i.test(line)
        if (!pkgMap.has(currentPkg)) pkgMap.set(currentPkg, new Set())
      } else {
        // 패키지명 없는 섹션 → 비교 대상 아님 (재구현 금지 체크리스트 등)
        currentPkg = null
        isInternal = false
      }
    }
    if (!currentPkg || isInternal) continue

    // 테이블 구분선이나 헤더 행 건너뛰기
    if (line.startsWith('|---') || line.startsWith('| 파일') || line.startsWith('| 함수') || line.startsWith('| 타입') || line.startsWith('| 필요')) continue

    // 테이블 행에서 backtick-quoted 식별자 추출
    // `funcName()`, `TypeName`, `TypeName<T>` 매치 — 파일 경로(`/` 포함) 제외
    if (line.startsWith('|')) {
      for (const m of line.matchAll(/`(\w+)(?:<[^>]*>)?(?:\(\))?`/g)) {
        const name = m[1]
        // 파일 경로나 테이블 헤더 단어 제외
        if (name.length <= 2) continue
        if (/^(types|src|core|adapters|errors|drizzle|typegen|cli)$/.test(name)) continue
        pkgMap.get(currentPkg)!.add(name)
      }
    }
  }

  return pkgMap
}

// ── 비교 ────────────────────────────────────────────────────

const PACKAGES = ['core', 'parser', 'codegen', 'mock-server', 'router', 'client'] as const

function main() {
  const apiIndexPath = join(root, 'docs/internal/api-index.md')
  const docNames = extractDocNames(apiIndexPath)

  let hasIssue = false
  const report: string[] = []

  for (const pkg of PACKAGES) {
    const entryPath = join(root, 'packages', pkg, 'src/index.ts')
    const { names: codeNames } = extractExportsFromFile(entryPath)

    // api-index.md에서는 "mock-server" 가 여러 섹션에 걸쳐 있을 수 있음
    const docNamesForPkg = new Set<string>()
    for (const [key, names] of docNames) {
      if (key === pkg || key.includes(pkg)) {
        for (const n of names) docNamesForPkg.add(n)
      }
    }

    // mock-server의 parser re-exports는 제외 (parser 섹션에서 이미 문서화됨)
    const parserReExports = new Set([
      'foldSchema', 'SchemaFolder', 'SchemaAlgebra', 'DerefFolder', 'derefSpec',
      'runPipeline', 'derefPass', 'DEFAULT_PASSES', 'SpecPass',
      'loadSchema', 'matchRoute',
    ])

    const missing = [...codeNames].filter(n => {
      if (pkg === 'mock-server' && parserReExports.has(n)) return false
      return !docNamesForPkg.has(n)
    }).sort()

    const orphaned = [...docNamesForPkg].filter(n => !codeNames.has(n)).sort()

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

  if (hasIssue) {
    console.log('## API Index Drift Report\n')
    console.log(report.join('\n'))
    console.log('\n\nUpdate docs/internal/api-index.md to match actual exports.')
    process.exit(1)
  } else {
    console.log('API index is in sync with code exports.')
    process.exit(0)
  }
}

main()
