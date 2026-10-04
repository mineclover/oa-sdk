import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * oa-gen은 어떤 커맨드를 실행하든 모든 커맨드 모듈을 정적으로 불러온다(src/cli/commands.ts).
 * 그래서 한 커맨드만 쓰는 무거운 의존성을 커맨드 모듈이 정적으로 import하면 모든 oa-gen 기동이 그 로드 비용을 낸다.
 * 이런 의존성은 해당 커맨드의 run()에서 동적 import로 불러와야 한다.
 *
 * 측정(같은 호스트, 1분 부하 평균 약 6, 9회 번갈아 실행한 중앙값): `oa-gen --help`가
 * dist 348 ms → 212 ms, tsx 761 ms → 554 ms로 줄었다(@typespec/* 와 TypeScript 컴파일러를 지연 로드한 효과).
 * CLI 하위 프로세스를 여러 번 띄우는 테스트는 부하 상태에서 이 기동 비용이 누적되어 시간 예산을 넘겼다.
 */
const COMMAND_SCOPED_HEAVY_DEPENDENCIES: readonly RegExp[] = [
  /^@typespec\//, // TypeSpec 컴파일러 계열: tsp diff, tsp-bundle-check, mock --tsp 전용
  /^typescript$/,
  /^@oa-sdk\/ast-sync$/, // 진입점이 TypeScript 컴파일러 전체를 불러온다: audit:shape 전용
]

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_ENTRY = path.join(SRC_DIR, 'cli/index.ts')

interface StaticImportGraph {
  /** 정적으로 도달하는 패키지 지정자 → 처음 도달한 import 경로 */
  packages: Map<string, string[]>
  localModules: number
}

function resolveLocalModule(fromFile: string, specifier: string): string | undefined {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), path.join(base, 'index.ts')]
  return candidates.find((candidate) => fs.existsSync(candidate))
}

/**
 * 런타임에 남는 정적 import/export만 따라간다. `import type`/`export type`만 지워지고,
 * verbatimModuleSyntax에서는 `import { type A } from 'x'`도 `import {} from 'x'`로 남아 모듈을 불러온다.
 * 동적 `import()`는 해당 코드가 실행될 때만 로드되므로 제외한다.
 */
function runtimeImportSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const specifiers: string[] = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || !statement.moduleSpecifier) continue
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text)
    }
  }
  return specifiers
}

function collectStaticImportGraph(entry: string): StaticImportGraph {
  const parentOf = new Map<string, string | null>([[entry, null]])
  const packages = new Map<string, string[]>()
  const queue = [entry]
  const chainTo = (file: string): string[] => {
    const chain: string[] = []
    for (let current: string | null | undefined = file; current; current = parentOf.get(current)) {
      chain.unshift(path.relative(SRC_DIR, current))
    }
    return chain
  }

  while (queue.length > 0) {
    const file = queue.shift()!
    for (const specifier of runtimeImportSpecifiers(file)) {
      if (specifier.startsWith('.')) {
        const target = resolveLocalModule(file, specifier)
        if (target && !parentOf.has(target)) {
          parentOf.set(target, file)
          queue.push(target)
        }
      } else if (!specifier.startsWith('node:') && !packages.has(specifier)) {
        packages.set(specifier, chainTo(file))
      }
    }
  }
  return { packages, localModules: parentOf.size }
}

function heavyDependenciesReachedFrom(entry: string): string[] {
  const { packages } = collectStaticImportGraph(entry)
  return [...packages]
    .filter(([specifier]) => COMMAND_SCOPED_HEAVY_DEPENDENCIES.some((pattern) => pattern.test(specifier)))
    .map(([specifier, chain]) => `${specifier} <= ${chain.join(' > ')}`)
}

describe('oa-gen startup module graph', () => {
  it('does not statically load command-scoped heavy dependencies when the CLI starts', () => {
    const graph = collectStaticImportGraph(CLI_ENTRY)
    // 탐색이 실제로 커맨드 모듈과 공통 의존성까지 내려갔는지 확인한다(빈 그래프로 통과하지 않도록).
    expect(graph.localModules).toBeGreaterThan(50)
    expect(graph.packages.has('@oa-sdk/parser')).toBe(true)

    expect(heavyDependenciesReachedFrom(CLI_ENTRY)).toEqual([])
  })

  it('still detects those dependencies in the modules that commands load on demand', () => {
    const onDemandModules = [
      'cli/lib/typespec-ast-diff.ts',
      'cli/lib/typespec-ref-resolver.ts',
      'cli/lib/typespec-bundle-check.ts',
      'cli/lib/typespec-mock-compiler.ts',
      'cli/lib/audit-shape-files.ts',
    ]
    for (const modulePath of onDemandModules) {
      expect(heavyDependenciesReachedFrom(path.join(SRC_DIR, modulePath)), modulePath).not.toEqual([])
    }
  })
})
