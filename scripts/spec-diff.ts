/**
 * spec-diff.ts — 두 OpenAPI 스펙 간 endpoint 변경 요약 및 breaking gate
 *
 * 실행:
 *   tsx scripts/spec-diff.ts <base.yaml> <head.yaml>
 *   tsx scripts/spec-diff.ts <base.yaml> <head.yaml> --fail-on-breaking
 *   tsx scripts/spec-diff.ts --git           # git base(main) vs working copy
 *
 * 출력: Markdown 형식 (CI step summary에 바로 사용 가능)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execaSync } from 'execa'
import { parse } from 'yaml'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from '../packages/codegen/src/schema-governance.js'

export {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
}
export type {
  ChangeSeverity,
  ContractDiffChange,
  DiffResult,
  Endpoint,
  EndpointParameter,
  HttpMethod,
} from '../packages/codegen/src/schema-governance.js'

function findRepoRoot(): string {
  return execaSync('git', ['rev-parse', '--show-toplevel']).stdout.trim()
}

function gitShow(ref: string, filePath: string, cwd: string): string | null {
  try {
    return execaSync('git', ['show', `${ref}:${filePath}`], { cwd }).stdout
  } catch {
    return null
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const failOnBreaking = args.includes('--fail-on-breaking')
  const normalizedArgs = args.filter(arg => arg !== '--fail-on-breaking' && arg !== '--')
  const root = findRepoRoot()
  const specRel = 'packages/schemas/src/.merged.3.1.yaml'
  const specAbs = join(root, specRel)

  let baseYaml: string
  let headYaml: string

  if (normalizedArgs.includes('--help') || normalizedArgs.includes('-h')) {
    console.log('Usage: tsx scripts/spec-diff.ts <base.yaml> <head.yaml> [--fail-on-breaking]')
    console.log('       tsx scripts/spec-diff.ts --git [base-branch] [--fail-on-breaking]')
    process.exit(0)
  }

  if (normalizedArgs[0] === '--git') {
    const baseBranch = normalizedArgs[1] ?? 'origin/main'
    const result = gitShow(baseBranch, specRel, root)
    if (result === null) {
      console.log('### API Spec Diff\n\nBase spec not found in git - skipping diff (new file?).')
      process.exit(0)
    }
    baseYaml = result
    if (!existsSync(specAbs)) {
      console.error(`Head spec not found: ${specAbs}`)
      process.exit(1)
    }
    headYaml = readFileSync(specAbs, 'utf-8')
  } else if (normalizedArgs.length >= 2) {
    const basePath = normalizedArgs[0]!
    const headPath = normalizedArgs[1]!
    for (const filePath of [basePath, headPath]) {
      if (!existsSync(filePath)) {
        console.error(`File not found: ${filePath}`)
        process.exit(1)
      }
    }
    baseYaml = readFileSync(basePath, 'utf-8')
    headYaml = readFileSync(headPath, 'utf-8')
  } else {
    console.error('Usage: tsx scripts/spec-diff.ts <base.yaml> <head.yaml> [--fail-on-breaking]')
    console.error('       tsx scripts/spec-diff.ts --git [base-branch] [--fail-on-breaking]')
    process.exit(1)
  }

  const baseSpec = parse(baseYaml) as Record<string, unknown>
  const headSpec = parse(headYaml) as Record<string, unknown>
  const diff = diffEndpoints(baseSpec, headSpec)

  console.log(formatMarkdown(diff))
  if (failOnBreaking && hasBreakingChanges(diff)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
