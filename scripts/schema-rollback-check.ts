/**
 * Prove the staged TypeSpec migration can fall back to the current
 * OpenAPI/Definition Builder production path.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { preservingDirectory } from './lib/directory-snapshot.js'

/**
 * Where the schema build writes its generated spec artifacts: the committed
 * `.merged.3.1.yaml` and `.merged.3.1.meta.json`, and the ignored
 * `.merged.yaml` and `.builder/` outputs that later gates read.
 */
export const SCHEMA_ARTIFACT_DIRECTORY = resolve(import.meta.dirname, '../packages/schemas/src')

export type SchemaRollbackStep = { label: string; args: string[] }

/** The gates the rollback check runs, with or without a TypeSpec report validated earlier. */
export function schemaRollbackSteps(typespecReport: string | undefined): SchemaRollbackStep[] {
  return [
    ...(typespecReport ? [] : [{
      label: 'TypeSpec production candidate gate',
      args: ['schema:typespec-check'],
    }]),
    {
      label: 'OpenAPI/Definition Builder rollback gate',
      args: ['schema:validate:openapi'],
    },
  ]
}

/**
 * Runs the rollback `steps` and then restores `artifactDirectory` byte for
 * byte, whether they pass or not.
 *
 * The OpenAPI/Definition Builder gate rebuilds the spec with the rollback
 * pipeline, which writes its own `.merged.yaml` and downgrades it over the
 * committed `.merged.3.1.*` files. Its output differs from the TypeSpec
 * production build those files hold, so without the restore a check would
 * leave tracked files modified and hand later gates the rollback build.
 * Nothing else may edit `artifactDirectory` while the check runs.
 */
export async function runSchemaRollbackCheck(
  steps: readonly SchemaRollbackStep[],
  runStep: (step: SchemaRollbackStep) => Promise<void>,
  artifactDirectory: string = SCHEMA_ARTIFACT_DIRECTORY,
): Promise<void> {
  await preservingDirectory(artifactDirectory, async () => {
    for (const [index, step] of steps.entries()) {
      console.log('')
      console.log(`Schema rollback check ${index + 1}/${steps.length}: ${step.label}`)
      await runStep(step)
    }
  })
}

async function main(): Promise<void> {
  const typespecReport = parseSchemaRollbackArgs(process.argv.slice(2))
  if (typespecReport) validateReusedTypeSpecReport(typespecReport)
  await runSchemaRollbackCheck(schemaRollbackSteps(typespecReport), step => run('pnpm', step.args))

  console.log('')
  console.log(
    `Schema rollback check passed${typespecReport ? ' (validated prior TypeSpec report)' : ''}; ` +
      `restored ${SCHEMA_ARTIFACT_DIRECTORY} to its state before the check`,
  )
}

export function parseSchemaRollbackArgs(values: string[]): string | undefined {
  let report: string | undefined
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value !== '--typespec-report') {
      throw new Error(`Unknown schema rollback option: ${value}`)
    }
    const next = values[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error('--typespec-report requires a file path')
    }
    report = resolve(next)
    index += 1
  }
  return report
}

export function validateReusedTypeSpecReport(reportPath: string): void {
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
    schemaVersion?: unknown
    validation?: {
      emitted?: { valid?: unknown }
      restored?: { valid?: unknown }
      expected?: { valid?: unknown }
    }
    gates?: Record<string, unknown>
    provenance?: { valid?: unknown }
  }
  if (report.schemaVersion !== 'oa-sdk.typespec-bundle-check-report.v1') {
    throw new Error(`Invalid TypeSpec report schema: ${reportPath}`)
  }
  if (report.validation?.emitted?.valid !== true || report.validation.restored?.valid !== true) {
    throw new Error(`TypeSpec report contains invalid emitted/restored documents: ${reportPath}`)
  }
  if (report.validation.expected && report.validation.expected.valid !== true) {
    throw new Error(`TypeSpec report contains an invalid expected document: ${reportPath}`)
  }
  const gates = report.gates
  if (
    gates?.compatibilitySidecar !== 'pass' ||
    gates.emittedValidation !== 'pass' ||
    gates.restoredValidation !== 'pass' ||
    (gates.expectedValidation !== undefined && gates.expectedValidation !== 'pass') ||
    gates.provenance !== 'pass' ||
    (gates.expectedDiff !== undefined && gates.expectedDiff !== 'pass') ||
    report.provenance?.valid !== true
  ) {
    throw new Error(`TypeSpec report does not satisfy every production gate: ${reportPath}`)
  }
  console.log(`Reusing validated TypeSpec report: ${reportPath}`)
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('close', code => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`))
    })
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
