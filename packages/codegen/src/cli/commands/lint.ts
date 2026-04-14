import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { formatLintLocation } from '../lib/diagnostics.js'
import { str } from '../lib/args.js'

export const lint: Command = {
  name: 'lint',
  description: 'OAS 3.2 스펙 린트',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
  },
  async run(args) {
    const { lintDocument } = await import('@oa-sdk/parser')
    const { document: doc, path: resolvedSpecPath } = loadSpecWithPath(str(args, 'spec'))
    const results = lintDocument(doc, { basePath: resolvedSpecPath })

    for (const r of results) {
      const icon = r.severity === 'error' ? '❌' : r.severity === 'warning' ? '⚠️' : 'ℹ️'
      console.log(`  ${icon} [${r.rule}] ${r.message}`)
      console.log(`    at ${formatLintLocation(r)}`)
    }

    const errors = results.filter(r => r.severity === 'error')
    const warnings = results.filter(r => r.severity === 'warning')
    const infos = results.filter(r => r.severity === 'info')
    console.log(`\n${errors.length} errors, ${warnings.length} warnings, ${infos.length} infos`)

    if (errors.length > 0) process.exit(1)
  },
}
