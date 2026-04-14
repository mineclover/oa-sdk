/**
 * spec-diff.ts — 두 OpenAPI 스펙 간 endpoint 변경 요약
 *
 * 실행:
 *   tsx scripts/spec-diff.ts <base.yaml> <head.yaml>
 *   tsx scripts/spec-diff.ts --git           # git base(main) vs working copy
 *
 * 출력: Markdown 형식 (CI step summary에 바로 사용 가능)
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execaSync } from 'execa'
import { parse } from 'yaml'

// ── Types ───────────────────────────────────────────────────

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

interface Endpoint {
  path: string
  method: HttpMethod
  operationId?: string
  summary?: string
  parameters?: string[]
  responses?: string[]
}

interface DiffResult {
  added: Endpoint[]
  removed: Endpoint[]
  modified: { base: Endpoint; head: Endpoint; changes: string[] }[]
}

// ── Extract ─────────────────────────────────────────────────

function extractEndpoints(spec: Record<string, unknown>): Map<string, Endpoint> {
  const map = new Map<string, Endpoint>()
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>

  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') continue
    for (const method of HTTP_METHODS) {
      const op = item[method] as Record<string, unknown> | undefined
      if (!op) continue
      const key = `${method.toUpperCase()} ${path}`
      map.set(key, {
        path,
        method,
        operationId: op.operationId as string | undefined,
        summary: op.summary as string | undefined,
        parameters: ((op.parameters ?? []) as Array<Record<string, unknown>>)
          .map(p => `${p.in}:${p.name}`)
          .sort(),
        responses: Object.keys((op.responses ?? {}) as Record<string, unknown>).sort(),
      })
    }
  }
  return map
}

// ── Diff ────────────────────────────────────────────────────

function diffEndpoints(baseSpec: Record<string, unknown>, headSpec: Record<string, unknown>): DiffResult {
  const baseMap = extractEndpoints(baseSpec)
  const headMap = extractEndpoints(headSpec)

  const added: Endpoint[] = []
  const removed: Endpoint[] = []
  const modified: DiffResult['modified'] = []

  for (const [key, ep] of headMap) {
    if (!baseMap.has(key)) {
      added.push(ep)
    }
  }

  for (const [key, ep] of baseMap) {
    if (!headMap.has(key)) {
      removed.push(ep)
    }
  }

  for (const [key, baseEp] of baseMap) {
    const headEp = headMap.get(key)
    if (!headEp) continue

    const changes: string[] = []

    if (baseEp.operationId !== headEp.operationId) {
      changes.push(`operationId: \`${baseEp.operationId}\` → \`${headEp.operationId}\``)
    }
    if (baseEp.summary !== headEp.summary) {
      changes.push(`summary changed`)
    }
    if (JSON.stringify(baseEp.parameters) !== JSON.stringify(headEp.parameters)) {
      const addedParams = headEp.parameters!.filter(p => !baseEp.parameters!.includes(p))
      const removedParams = baseEp.parameters!.filter(p => !headEp.parameters!.includes(p))
      if (addedParams.length) changes.push(`params added: ${addedParams.join(', ')}`)
      if (removedParams.length) changes.push(`params removed: ${removedParams.join(', ')}`)
    }
    if (JSON.stringify(baseEp.responses) !== JSON.stringify(headEp.responses)) {
      const addedResp = headEp.responses!.filter(r => !baseEp.responses!.includes(r))
      const removedResp = baseEp.responses!.filter(r => !headEp.responses!.includes(r))
      if (addedResp.length) changes.push(`responses added: ${addedResp.join(', ')}`)
      if (removedResp.length) changes.push(`responses removed: ${removedResp.join(', ')}`)
    }

    if (changes.length > 0) {
      modified.push({ base: baseEp, head: headEp, changes })
    }
  }

  return { added, removed, modified }
}

// ── Format ──────────────────────────────────────────────────

function formatMarkdown(diff: DiffResult): string {
  const { added, removed, modified } = diff

  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    return '### API Spec Diff\n\nNo endpoint changes detected.'
  }

  const lines: string[] = ['### API Spec Diff\n']

  const summary = [
    added.length && `**+${added.length}** added`,
    removed.length && `**-${removed.length}** removed`,
    modified.length && `**~${modified.length}** modified`,
  ].filter(Boolean)
  lines.push(summary.join(' / ') + '\n')

  if (added.length) {
    lines.push('#### Added')
    for (const ep of added) {
      lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.summary ?? ep.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (removed.length) {
    lines.push('#### Removed')
    for (const ep of removed) {
      lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` — ${ep.summary ?? ep.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (modified.length) {
    lines.push('#### Modified')
    for (const { head, changes } of modified) {
      lines.push(`- \`${head.method.toUpperCase()} ${head.path}\``)
      for (const c of changes) {
        lines.push(`  - ${c}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────

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

function main() {
  const args = process.argv.slice(2)
  const root = findRepoRoot()
  const SPEC_REL = 'packages/schemas/src/.merged.3.1.yaml'
  const specAbs = join(root, SPEC_REL)

  let baseYaml: string
  let headYaml: string

  if (args[0] === '--git') {
    const baseBranch = args[1] ?? 'origin/main'
    const result = gitShow(baseBranch, SPEC_REL, root)
    if (result === null) {
      console.log('### API Spec Diff\n\nBase spec not found in git — skipping diff (new file?).')
      process.exit(0)
    }
    baseYaml = result
    if (!existsSync(specAbs)) {
      console.error(`Head spec not found: ${specAbs}`)
      process.exit(1)
    }
    headYaml = readFileSync(specAbs, 'utf-8')
  } else if (args.length >= 2) {
    for (const f of [args[0], args[1]]) {
      if (!existsSync(f)) {
        console.error(`File not found: ${f}`)
        process.exit(1)
      }
    }
    baseYaml = readFileSync(args[0], 'utf-8')
    headYaml = readFileSync(args[1], 'utf-8')
  } else {
    console.error('Usage: tsx scripts/spec-diff.ts <base.yaml> <head.yaml>')
    console.error('       tsx scripts/spec-diff.ts --git [base-branch]')
    process.exit(1)
  }

  const baseSpec = parse(baseYaml) as Record<string, unknown>
  const headSpec = parse(headYaml) as Record<string, unknown>
  const diff = diffEndpoints(baseSpec, headSpec)

  console.log(formatMarkdown(diff))
}

main()
