/**
 * TypeSpec authored-bundle probe.
 *
 * This starts from a TypeSpec project plus an OA SDK compatibility sidecar,
 * compiles through the TypeSpec OpenAPI emitter, restores sidecar metadata,
 * validates the restored OpenAPI, and optionally diffs against an expected
 * OpenAPI artifact.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { stringifyOpenApiYaml } from '../packages/codegen/src/cli/lib/openapi-collect.js'
import {
  applyTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
} from '../packages/codegen/src/cli/lib/typespec-sidecar.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  extractEndpoints,
  formatMarkdown,
  type DiffResult,
} from '../packages/codegen/src/cli/lib/openapi-breaking-diff.js'
import { validateDocument } from '../packages/parser/src/validate.js'

type Args = {
  project: string
  sidecar: string
  expected?: string
  output?: string
  report?: string
  keep: boolean
  failOnBreaking: boolean
}

type DiffSummary = {
  added: number
  removed: number
  modified: number
  breaking: number
  nonBreaking: number
}

type TypeSpecBundleCheckReport = {
  schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1'
  paths: {
    project: string
    sidecar: string
    emittedOpenapi: string
    restoredOpenapi: string
    expectedOpenapi?: string
    workspace: string
  }
  counts: {
    emittedOperations: number
    restoredOperations: number
    expectedOperations?: number
    compatibilitySidecar: {
      entries: number
      parameterExamples: number
      responseMediaExamples: number
      securitySchemes: number
    }
    restore: {
      entries: number
      applied: number
      missingTargets: number
    }
  }
  validation: {
    emitted: {
      valid: boolean
      summary: string
    }
    restored: {
      valid: boolean
      summary: string
    }
    expected?: {
      valid: boolean
      summary: string
    }
  }
  diff?: {
    emitted: DiffSummary
    restored: DiffSummary
  }
  gates: {
    compatibilitySidecar: 'pass' | 'fail'
    restoredValidation: 'pass' | 'fail'
    expectedDiff?: 'pass' | 'fail'
  }
}

const root = resolve(process.cwd())
const defaultFixture = 'docs/internal/typespec-roundtrip/fixtures/authored-bundle'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const projectPath = resolve(root, args.project)
  const sidecarPath = resolve(root, args.sidecar)
  const expectedPath = args.expected ? resolve(root, args.expected) : undefined
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-bundle-'))
  const outputDir = join(workspace, 'tsp-output')
  const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
  const restoredPath = args.output ? resolve(root, args.output) : join(workspace, 'openapi.restored.yaml')

  try {
    await execa('pnpm', ['exec', 'tsp', 'compile', projectPath, '--output-dir', outputDir], {
      cwd: root,
      stdio: 'inherit',
    })

    if (!existsSync(emittedPath)) {
      throw new Error(`TypeSpec compile did not emit ${emittedPath}`)
    }

    const { document: emittedDocument } = loadSpecWithPath(emittedPath)
    const emittedValidation = validateDocument(emittedDocument, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })

    const sidecar = parseTypeSpecCompatibilitySidecar(loadJson(sidecarPath))
    const restored = applyTypeSpecCompatibilitySidecar(emittedDocument, sidecar)
    mkdirSync(dirname(restoredPath), { recursive: true })
    writeFileSync(restoredPath, stringifyOpenApiYaml(restored.document))
    const restoredValidation = validateDocument(restored.document, {
      basePath: restoredPath,
      requireOpenApi32: true,
    })

    const expected = expectedPath ? loadExpected(expectedPath) : undefined
    const emittedDiff = expected ? diffEndpoints(expected.document, emittedDocument) : undefined
    const restoredDiff = expected ? diffEndpoints(expected.document, restored.document) : undefined
    const report = createReport({
      projectPath,
      sidecarPath,
      emittedPath,
      restoredPath,
      expectedPath,
      workspace,
      sidecar,
      restore: restored.report,
      emittedDocument,
      restoredDocument: restored.document,
      emittedValidation,
      restoredValidation,
      expected,
      emittedDiff,
      restoredDiff,
    })

    if (args.report) {
      const reportPath = resolve(root, args.report)
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }

    printSummary(report, restoredDiff)

    if (
      report.gates.compatibilitySidecar === 'fail'
      || report.gates.restoredValidation === 'fail'
      || (args.failOnBreaking && report.gates.expectedDiff === 'fail')
    ) {
      process.exit(1)
    }
  } finally {
    if (!args.keep) rmSync(workspace, { recursive: true, force: true })
  }
}

function loadExpected(path: string): {
  document: Record<string, unknown>
  validation: { valid: boolean; summary: string }
} {
  const { document } = loadSpecWithPath(path)
  return {
    document,
    validation: validateDocument(document, {
      basePath: path,
      requireOpenApi32: true,
    }),
  }
}

function createReport(input: {
  projectPath: string
  sidecarPath: string
  emittedPath: string
  restoredPath: string
  expectedPath?: string
  workspace: string
  sidecar: ReturnType<typeof parseTypeSpecCompatibilitySidecar>
  restore: ReturnType<typeof applyTypeSpecCompatibilitySidecar>['report']
  emittedDocument: Record<string, unknown>
  restoredDocument: Record<string, unknown>
  emittedValidation: { valid: boolean; summary: string }
  restoredValidation: { valid: boolean; summary: string }
  expected?: { document: Record<string, unknown>; validation: { valid: boolean; summary: string } }
  emittedDiff?: DiffResult
  restoredDiff?: DiffResult
}): TypeSpecBundleCheckReport {
  const restoredBreaking = input.restoredDiff ? classifyBreakingChanges(input.restoredDiff).length : 0
  return {
    schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1',
    paths: {
      project: input.projectPath,
      sidecar: input.sidecarPath,
      emittedOpenapi: input.emittedPath,
      restoredOpenapi: input.restoredPath,
      ...(input.expectedPath ? { expectedOpenapi: input.expectedPath } : {}),
      workspace: input.workspace,
    },
    counts: {
      emittedOperations: extractEndpoints(input.emittedDocument).size,
      restoredOperations: extractEndpoints(input.restoredDocument).size,
      ...(input.expected ? { expectedOperations: extractEndpoints(input.expected.document).size } : {}),
      compatibilitySidecar: input.sidecar.counts,
      restore: input.restore.counts,
    },
    validation: {
      emitted: input.emittedValidation,
      restored: input.restoredValidation,
      ...(input.expected ? { expected: input.expected.validation } : {}),
    },
    ...(input.emittedDiff && input.restoredDiff
      ? {
          diff: {
            emitted: summarizeDiff(input.emittedDiff),
            restored: summarizeDiff(input.restoredDiff),
          },
        }
      : {}),
    gates: {
      compatibilitySidecar: input.restore.counts.missingTargets === 0 ? 'pass' : 'fail',
      restoredValidation: input.restoredValidation.valid ? 'pass' : 'fail',
      ...(input.restoredDiff ? { expectedDiff: restoredBreaking === 0 ? 'pass' : 'fail' } : {}),
    },
  }
}

function summarizeDiff(diff: DiffResult): DiffSummary {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    breaking: classifyBreakingChanges(diff).length,
    nonBreaking: classifyNonBreakingChanges(diff).length,
  }
}

function printSummary(report: TypeSpecBundleCheckReport, restoredDiff: DiffResult | undefined): void {
  console.log('')
  console.log('TypeSpec authored bundle check')
  console.log(`  project: ${relative(root, report.paths.project)}`)
  console.log(`  sidecar: ${relative(root, report.paths.sidecar)}`)
  console.log(`  emitted: ${relative(root, report.paths.emittedOpenapi)}`)
  console.log(`  restored: ${relative(root, report.paths.restoredOpenapi)}`)
  if (report.paths.expectedOpenapi) console.log(`  expected: ${relative(root, report.paths.expectedOpenapi)}`)
  console.log(`  compatibility sidecar: ${report.counts.compatibilitySidecar.entries} entries, restore ${report.gates.compatibilitySidecar}`)
  console.log(`  restore targets: ${report.counts.restore.applied} applied, ${report.counts.restore.missingTargets} missing`)
  console.log(`  emitted validation: ${report.validation.emitted.summary}`)
  console.log(`  restored validation: ${report.validation.restored.summary}`)
  if (report.validation.expected) console.log(`  expected validation: ${report.validation.expected.summary}`)
  if (report.diff) {
    console.log(`  emitted breaking diff: ${report.diff.emitted.breaking > 0 ? 'yes' : 'no'}`)
    console.log(`  restored breaking diff: ${report.diff.restored.breaking > 0 ? 'yes' : 'no'}`)
  }
  console.log('')
  if (restoredDiff) console.log(formatMarkdown(restoredDiff))
}

function parseArgs(rawArgs: string[]): Args {
  const project = readOption(rawArgs, '--project') ?? defaultFixture
  const sidecar = readOption(rawArgs, '--sidecar') ?? `${project}/oa-sdk.typespec-compat-sidecar.json`
  const expected = readOption(rawArgs, '--expected') ?? `${project}/expected.openapi.yaml`
  return {
    project,
    sidecar,
    expected,
    output: readOption(rawArgs, '--output'),
    report: readOption(rawArgs, '--report'),
    keep: rawArgs.includes('--keep'),
    failOnBreaking: rawArgs.includes('--fail-on-breaking'),
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

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

await main()
