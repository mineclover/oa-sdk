#!/usr/bin/env node
/**
 * Local Breaking Diff Inspector
 * Allows developers to run PR-grade breaking change checks locally before push.
 *
 * Usage:
 *   pnpm check:local-diff
 *   pnpm check:local-diff --base packages/schemas/typespec/approved.openapi.yaml --head packages/schemas/src/.merged.yaml
 *   pnpm check:local-diff --output diff-report.md
 */

import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadSpecDocumentAsync } from '../packages/codegen/src/cli/lib/load-spec.js'
import { bundleExternalRefs } from '../packages/codegen/src/cli/lib/bundle-external-refs.js'
import {
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
  classifyBreakingChanges,
} from '../packages/codegen/src/cli/lib/openapi-breaking-diff.js'

async function main() {
  const args = process.argv.slice(2)
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined
  }

  const projectRoot = process.cwd()
  const baseFile = getArg('--base') ?? resolve(projectRoot, 'packages/schemas/typespec/approved.openapi.yaml')
  const headFile = getArg('--head') ?? resolve(projectRoot, 'packages/schemas/src/.merged.yaml')
  const outputFile = getArg('--output')
  const allowBreaking = args.includes('--allow-breaking')

  if (!existsSync(baseFile)) {
    console.error(`❌ Base spec not found: ${baseFile}`)
    process.exit(1)
  }
  if (!existsSync(headFile)) {
    console.error(`❌ Head spec not found: ${headFile}`)
    process.exit(1)
  }

  console.log(`🔍 Inspecting local OpenAPI breaking diffs...`)
  console.log(`   Base: ${baseFile}`)
  console.log(`   Head: ${headFile}`)

  const base = await loadSpecDocumentAsync(baseFile, projectRoot)
  const head = await loadSpecDocumentAsync(headFile, projectRoot)

  const diffResult = diffEndpoints(
    bundleExternalRefs(base.document, base.path),
    bundleExternalRefs(head.document, head.path),
  )

  const markdownReport = formatMarkdown(diffResult)
  const breaking = hasBreakingChanges(diffResult)
  const breakingDetails = classifyBreakingChanges(diffResult)

  console.log('\n' + markdownReport + '\n')

  if (outputFile) {
    writeFileSync(resolve(projectRoot, outputFile), markdownReport, 'utf-8')
    console.log(`📝 Diff report saved to: ${outputFile}`)
  }

  if (breaking) {
    console.error(`🚨 BREAKING CHANGES DETECTED (${breakingDetails.length} breaking changes):`)
    for (const b of breakingDetails) {
      console.error(`   - [${b.code}] ${b.endpoint}: ${b.detail}`)
    }

    if (!allowBreaking) {
      console.error(`\n❌ Failed due to breaking changes. Fix the contract or use --allow-breaking to override.`)
      process.exit(1)
    } else {
      console.warn(`\n⚠️ Breaking changes detected but ignored via --allow-breaking.`)
    }
  } else {
    console.log(`✅ No breaking changes detected. Clean contract compatibility verified!`)
  }
}

main().catch((err) => {
  console.error('Fatal error during local diff check:', err)
  process.exit(1)
})
