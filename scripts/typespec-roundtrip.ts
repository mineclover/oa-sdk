/**
 * TypeSpec roundtrip probe for the current OA SDK OpenAPI declaration.
 *
 * The script intentionally reports current semantic differences instead of
 * hiding them. It fails on export/compile/validation errors. Breaking OpenAPI
 * diff is reported and only fails when --fail-on-breaking is passed.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import { stringify } from 'yaml'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { stringifyOpenApiYaml } from '../packages/codegen/src/cli/lib/openapi-collect.js'
import { exportOpenApiToTypeSpec } from '../packages/codegen/src/cli/lib/tsp-export.js'
import {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
} from '../packages/codegen/src/cli/lib/typespec-sidecar.js'
import {
  diffEndpoints,
  formatMarkdown,
  hasBreakingChanges,
} from '../packages/codegen/src/cli/lib/openapi-breaking-diff.js'
import { createTypeSpecRoundtripReport } from '../packages/codegen/src/cli/lib/typespec-roundtrip-report.js'
import { validateDocument } from '../packages/parser/src/validate.js'

type Args = {
  spec: string
  namespace: string
  keep: boolean
  failOnBreaking: boolean
  report?: string
}

const root = resolve(process.cwd())

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const specPath = resolve(root, args.spec)
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-roundtrip-'))
  const outputDir = join(workspace, 'tsp-output')
  const tspPath = join(workspace, 'main.tsp')
  const tspConfigPath = join(workspace, 'tspconfig.yaml')
  const reportPath = join(workspace, 'tsp-export-report.json')
  const sidecarPath = join(workspace, 'oa-sdk-typespec-sidecar.json')
  const restoredPath = join(workspace, 'openapi.restored.yaml')

  try {
    linkWorkspaceNodeModules(workspace)
    const { document } = loadSpecWithPath(specPath)
    const exported = exportOpenApiToTypeSpec(document, { namespace: args.namespace })
    const sidecar = createTypeSpecCompatibilitySidecar(document)
    writeFileSync(tspPath, exported.source)
    writeFileSync(reportPath, `${JSON.stringify(exported.report, null, 2)}\n`)
    writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`)
    writeFileSync(tspConfigPath, createTspConfig())

    await execa('pnpm', ['exec', 'tsp', 'compile', workspace, '--output-dir', outputDir], {
      cwd: root,
      stdio: 'inherit',
    })

    const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
    if (!existsSync(emittedPath)) {
      throw new Error(`TypeSpec compile did not emit ${emittedPath}`)
    }

    const { document: emittedDocument } = loadSpecWithPath(emittedPath)
    const validation = validateDocument(emittedDocument, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })
    if (!validation.valid) {
      console.error(validation.summary)
      process.exit(1)
    }

    const restored = applyTypeSpecCompatibilitySidecar(emittedDocument, sidecar)
    writeFileSync(restoredPath, stringifyOpenApiYaml(restored.document))
    const restoredValidation = validateDocument(restored.document, {
      basePath: restoredPath,
      requireOpenApi32: true,
    })
    if (!restoredValidation.valid) {
      console.error(restoredValidation.summary)
      process.exit(1)
    }

    const diff = diffEndpoints(document, emittedDocument)
    const restoredDiff = diffEndpoints(document, restored.document)
    const reExtractedSidecar = createTypeSpecCompatibilitySidecar(restored.document)
    const sidecarStability = compareTypeSpecCompatibilitySidecars(sidecar, reExtractedSidecar)
    const breaking = hasBreakingChanges(diff)
    const restoredBreaking = hasBreakingChanges(restoredDiff)
    const roundtripReport = createTypeSpecRoundtripReport({
      namespace: exported.report.namespace,
      sourceOpenapiPath: specPath,
      emittedOpenapiPath: emittedPath,
      tspSourcePath: tspPath,
      workspacePath: workspace,
      sourceDocument: document,
      emittedDocument,
      exportReport: exported.report,
      diff,
      validation: {
        valid: validation.valid,
        summary: validation.summary,
      },
      compatibilitySidecar: {
        sidecarPath,
        restoredOpenapiPath: restoredPath,
        sidecar,
        reExtractedSidecar,
        restoreReport: restored.report,
        stabilityReport: sidecarStability,
        restoredDiff,
        validation: {
          valid: restoredValidation.valid,
          summary: restoredValidation.summary,
        },
      },
    })
    if (args.report) {
      const resolvedReportPath = resolve(root, args.report)
      mkdirSync(dirname(resolvedReportPath), { recursive: true })
      writeFileSync(resolvedReportPath, `${JSON.stringify(roundtripReport, null, 2)}\n`)
    }

    console.log('')
    console.log('TypeSpec roundtrip probe')
    console.log(`  spec: ${relative(root, specPath)}`)
    console.log(`  namespace: ${exported.report.namespace}`)
    console.log(`  workspace: ${workspace}`)
    console.log(`  tsp: ${relative(workspace, tspPath)}`)
    console.log(`  emitted: ${relative(workspace, emittedPath)}`)
    console.log(`  sidecar: ${relative(workspace, sidecarPath)}`)
    console.log(`  restored: ${relative(workspace, restoredPath)}`)
    if (args.report) console.log(`  report: ${relative(root, resolve(root, args.report))}`)
    console.log(`  export diagnostics: ${roundtripReport.counts.exportDiagnostics}`)
    const acceptedDiagnostics = countAcceptedDiagnostics(roundtripReport.diagnostics)
    const unacceptedDiagnostics = countUnacceptedDiagnostics(roundtripReport.diagnostics)
    console.log(`  export diagnostics gate: ${roundtripReport.gates.exportDiagnostics} (${acceptedDiagnostics} accepted, ${unacceptedDiagnostics} unaccepted)`)
    console.log(`  compatibility sidecar: ${sidecar.counts.entries} entries, restore ${roundtripReport.gates.compatibilitySidecar}`)
    console.log(`  sidecar re-extract: ${sidecarStability.counts.expectedSatisfied}/${sidecarStability.counts.expectedEntries} expected, ${sidecarStability.counts.actualCovered}/${sidecarStability.counts.actualEntries} actual covered`)
    console.log(`  operations: ${roundtripReport.counts.operations.source} -> ${roundtripReport.counts.operations.emitted}`)
    console.log(`  component schemas: ${roundtripReport.counts.componentSchemas.source} -> ${roundtripReport.counts.componentSchemas.emitted}`)
    console.log(`  validation: ${validation.summary}`)
    console.log(`  restored validation: ${restoredValidation.summary}`)
    console.log(`  breaking diff: ${breaking ? 'yes' : 'no'}`)
    console.log(`  restored breaking diff: ${restoredBreaking ? 'yes' : 'no'}`)
    console.log('')
    console.log(formatMarkdown(diff))

    if ((breaking || restoredBreaking || roundtripReport.gates.compatibilitySidecar === 'fail') && args.failOnBreaking) {
      process.exit(1)
    }
  } finally {
    if (!args.keep) rmSync(workspace, { recursive: true, force: true })
  }
}

function countAcceptedDiagnostics(diagnostics: Array<{ policy: { accepted: boolean } }>): number {
  return diagnostics.filter(diagnostic => diagnostic.policy.accepted).length
}

function countUnacceptedDiagnostics(diagnostics: Array<{ policy: { accepted: boolean } }>): number {
  return diagnostics.filter(diagnostic => !diagnostic.policy.accepted).length
}

function linkWorkspaceNodeModules(workspace: string): void {
  const rootNodeModules = join(root, 'node_modules')
  const target = join(workspace, 'node_modules')
  if (!existsSync(rootNodeModules) || existsSync(target)) return
  symlinkSync(rootNodeModules, target, 'dir')
}

function createTspConfig(): string {
  return stringify({
    kind: 'project',
    entrypoint: 'main.tsp',
    emit: ['@typespec/openapi3'],
    options: {
      '@typespec/openapi3': {
        'openapi-versions': ['3.2.0'],
      },
    },
  })
}

function parseArgs(rawArgs: string[]): Args {
  const report = readOption(rawArgs, '--report')
  return {
    spec: readOption(rawArgs, '--spec') ?? 'packages/schemas/src/.merged.yaml',
    namespace: readOption(rawArgs, '--namespace') ?? 'OaSdkApi',
    keep: rawArgs.includes('--keep'),
    failOnBreaking: rawArgs.includes('--fail-on-breaking'),
    ...(report ? { report } : {}),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

await main()
