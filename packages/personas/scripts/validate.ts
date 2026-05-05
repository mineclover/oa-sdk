/**
 * CLI: pnpm validate
 *
 * Loads registry + traits + all domain matrices + merged OpenAPI spec,
 * runs v0.1 validation, prints a structured report.
 *
 * Spec path defaults to ../schemas/src/.merged.yaml (relative to this package).
 * Override via PERSONAS_MERGED_SPEC env or --spec=<path>.
 *
 * Exit codes:
 *   0 — no errors (warnings allowed)
 *   1 — at least one error
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import {
  defaultPackageRoot,
  listDomains,
  loadAllDomains,
  loadAllProfiles,
  loadAllTraits,
  loadOperationsFromMergedSpec,
  loadRegistry,
  validate,
} from '../src/index.js'
import type { MinimalOpenApiDoc } from '../src/index.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function parseSpecPath(): string {
  return arg('--spec=') ?? process.env['PERSONAS_MERGED_SPEC'] ?? resolve(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')
}

function parseBoundPath(): string {
  return arg('--bound=') ?? process.env['PERSONAS_BOUND_SPEC'] ?? resolve(__dir, '..', '..', 'schemas', 'src', '.merged.persona.yaml')
}

function main(): void {
  const root = defaultPackageRoot()
  const registry = loadRegistry(root)
  const traits = loadAllTraits(registry, root)
  const domains = loadAllDomains(root)

  const specPath = parseSpecPath()
  const knownOperations = loadOperationsFromMergedSpec(specPath)

  const boundPath = parseBoundPath()
  const boundSpec: MinimalOpenApiDoc | null = existsSync(boundPath)
    ? (parse(readFileSync(boundPath, 'utf8')) as MinimalOpenApiDoc)
    : null

  console.log(`📌 Personas v${registry.version}`)
  console.log(`   Domains: ${listDomains(root).join(', ')}`)
  console.log(`   Spec:    ${specPath}${knownOperations === null ? ' (NOT FOUND)' : ` (${knownOperations.size} operationIds)`}`)
  console.log(`   Bound:   ${boundPath}${boundSpec === null ? ' (skipped — run pnpm bind to enable drift check)' : ' (drift check active)'}`)
  console.log('')

  const profiles = loadAllProfiles(root)
  const report = validate({ registry, traits, domains, knownOperations, boundSpec, profiles })

  for (const issue of report.issues) {
    const icon = issue.severity === 'error' ? '❌' : '⚠️ '
    const tag = [issue.domain, issue.personaId, issue.bucket && `${issue.bucket}.${issue.dimension ?? ''}`]
      .filter(Boolean)
      .join(' › ')
    console.log(`${icon} ${tag}: ${issue.message}`)
  }

  console.log('')
  console.log(`📊 ${report.personaCount} personas`)
  console.log(`   ${report.implementedCount} implemented · ${report.proposedCount} proposed`)
  console.log(`   ${report.issues.filter(i => i.severity === 'error').length} errors · ${report.issues.filter(i => i.severity === 'warn').length} warnings`)

  process.exit(report.ok ? 0 : 1)
}

main()
