#!/usr/bin/env node

import { relative, resolve } from 'node:path'
import {
  runTypeRegistryGovernance,
  type RunTypeRegistryGovernanceOptions,
  type TypeRegistryDiff,
} from './type-registry-governance-lib.js'

type CliArgs = {
  policyPath: string
  outputDirectory?: string
  baselinePath?: string
  databasePath?: string
  writeBaseline: boolean
  writeOutputs: boolean
  help: boolean
}

const root = resolve(import.meta.dirname, '..')

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
  } else {
    const options: RunTypeRegistryGovernanceOptions = {
      root,
      policyPath: args.policyPath,
      writeBaseline: args.writeBaseline,
      writeOutputs: args.writeOutputs,
      ...(args.outputDirectory === undefined ? {} : { outputDirectory: args.outputDirectory }),
      ...(args.baselinePath === undefined ? {} : { baselinePath: args.baselinePath }),
      ...(args.databasePath === undefined ? {} : { databasePath: args.databasePath }),
    }
    const result = runTypeRegistryGovernance(options)
    const baselineExisted = result.report.baselineHash !== undefined
    printSummary(result, baselineExisted)

    const drift = diffCount(result.report.diff)
    if (result.report.violations.length > 0) process.exitCode = 1
    if (!args.writeBaseline && !baselineExisted) {
      console.error('Type Registry baseline is missing; review the report, then run with --write.')
      process.exitCode = 1
    } else if (!args.writeBaseline && drift > 0) {
      console.error('Type Registry baseline drift requires review; run with --write only after the change is approved.')
      process.exitCode = 1
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    policyPath: 'docs/internal/type-registry-policy.json',
    writeBaseline: false,
    writeOutputs: true,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--write') args.writeBaseline = true
    else if (argument === '--no-output') args.writeOutputs = false
    else if (argument === '--help' || argument === '-h') args.help = true
    else if (argument === '--policy') args.policyPath = requiredValue(argv, ++index, argument)
    else if (argument === '--output-dir') args.outputDirectory = requiredValue(argv, ++index, argument)
    else if (argument === '--baseline') args.baselinePath = requiredValue(argv, ++index, argument)
    else if (argument === '--db') args.databasePath = requiredValue(argv, ++index, argument)
    else throw new Error(`Unknown argument: ${String(argument)}`)
  }
  return args
}

function requiredValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

function printSummary(
  result: ReturnType<typeof runTypeRegistryGovernance>,
  baselineExisted: boolean,
): void {
  const { report } = result
  console.log('Type Registry governance')
  console.log(`  sources: ${report.scan.sourceFileCount} in ${report.scan.packageCount} packages`)
  console.log(`  declarations: ${report.scan.declarationCount}`)
  console.log(`  boundaries: ${report.scan.boundaryCount}`)
  console.log(`  snapshot: ${report.snapshotHash}`)
  console.log(`  baseline: ${baselineExisted ? report.baselineHash ?? 'loaded' : 'missing'}`)
  console.log(`  outputs: ${relative(root, result.outputDirectory)}`)
  for (const budget of report.budgets) {
    console.log(`  ${budget.rule}: ${budget.actual}/${budget.maximum} (${budget.allowed} allowlisted)`)
  }
  console.log(`  diff: ${formatDiff(report.diff)}`)
  console.log(`  violations: ${report.violations.length}`)
  for (const violation of report.violations) console.error(`  - [${violation.rule}] ${violation.message}`)
  if (result.report.allowlist.unused.length > 0) {
    console.log(`  unused allowlist: ${result.report.allowlist.unused.join(', ')}`)
  }
}

function formatDiff(diff: TypeRegistryDiff): string {
  return [
    `added=${diff.added.length}`,
    `removed=${diff.removed.length}`,
    `syntax=${diff.syntaxChanged.length}`,
    `shape=${diff.shapeChanged.length}`,
    `semantic=${diff.semanticChanged.length}`,
    `surface=${diff.publicSurfaceChanged.length}`,
    `policy=${diff.policyChanged ? 'changed' : 'same'}`,
  ].join(', ')
}

function diffCount(diff: TypeRegistryDiff): number {
  return diff.added.length
    + diff.removed.length
    + diff.syntaxChanged.length
    + diff.shapeChanged.length
    + diff.semanticChanged.length
    + diff.publicSurfaceChanged.length
    + (diff.policyChanged ? 1 : 0)
}

function printHelp(): void {
  console.log(`Usage: pnpm type-registry:check [options]

Deterministically scans workspace TypeScript authorities and package export maps,
indexes the result in SQLite, writes local canonical evidence, and gates drift.

Options:
  --write             Atomically replace the reviewed baseline after all gates pass
  --policy <path>     Policy JSON (default: docs/internal/type-registry-policy.json)
  --baseline <path>   Reviewed snapshot path
  --output-dir <path> Local snapshot/report directory
  --db <path>         Reuse a SQLite v2 index; default is an isolated temporary DB
  --no-output         Do not write local snapshot/report evidence
  -h, --help          Show this help
`)
}
