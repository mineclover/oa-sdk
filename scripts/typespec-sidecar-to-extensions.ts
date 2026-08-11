/**
 * Convert supported OA SDK TypeSpec compatibility sidecar entries into
 * TypeSpec @extension snippets and leave unsupported entries in a residual
 * sidecar.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  convertTypeSpecSidecarToExtensions,
  formatTypeSpecOpenApiExtensionSchemaVersions,
  isTypeSpecOpenApiExtensionSchemaVersion,
  parseTypeSpecCompatibilitySidecar,
  type TypeSpecSidecarToExtensionsOptions,
} from '../packages/codegen/src/schema-governance.js'

type Args = {
  sidecar?: string
  output?: string
  remainingSidecar?: string
  report?: string
  extensionSchemaVersion?: TypeSpecSidecarToExtensionsOptions['extensionSchemaVersion']
}

const args = parseArgs(process.argv.slice(2))
const root = process.cwd()

if (!args.sidecar) {
  printUsage()
  process.exit(1)
}

const sidecarPath = resolve(root, args.sidecar)
if (!existsSync(sidecarPath)) {
  throw new Error(`sidecar does not exist: ${relative(root, sidecarPath)}`)
}

const sidecar = parseTypeSpecCompatibilitySidecar(JSON.parse(readFileSync(sidecarPath, 'utf8')) as unknown)
const result = convertTypeSpecSidecarToExtensions(sidecar, {
  ...(args.extensionSchemaVersion ? { extensionSchemaVersion: args.extensionSchemaVersion } : {}),
})

if (args.output) {
  const outputPath = resolve(root, args.output)
  writeText(outputPath, result.snippets)
} else {
  process.stdout.write(result.snippets)
}

if (args.remainingSidecar) {
  const remainingPath = resolve(root, args.remainingSidecar)
  writeJson(remainingPath, result.remainingSidecar)
}

if (args.report) {
  const reportPath = resolve(root, args.report)
  writeJson(reportPath, result.report)
}

console.error('')
console.error('TypeSpec sidecar-to-extension migration')
console.error(`  source: ${relative(root, sidecarPath)}`)
console.error(`  extension schema: ${result.report.extensionSchemaVersion}`)
console.error(`  converted entries: ${result.report.counts.convertedEntries}`)
console.error(`  remaining entries: ${result.report.counts.remainingEntries}`)
if (args.output) console.error(`  snippets: ${args.output}`)
if (args.remainingSidecar) console.error(`  remaining sidecar: ${args.remainingSidecar}`)
if (args.report) console.error(`  report: ${args.report}`)

function parseArgs(rawArgs: string[]): Args {
  const inputArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  if (inputArgs.includes('--help') || inputArgs.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  const args: Args = {}
  for (let index = 0; index < inputArgs.length; index += 1) {
    const arg = inputArgs[index]
    if (arg === '--sidecar') {
      args.sidecar = readValue(inputArgs, index, arg)
      index += 1
      continue
    }
    if (arg === '--output' || arg === '-o') {
      args.output = readValue(inputArgs, index, arg)
      index += 1
      continue
    }
    if (arg === '--remaining-sidecar') {
      args.remainingSidecar = readValue(inputArgs, index, arg)
      index += 1
      continue
    }
    if (arg === '--report') {
      args.report = readValue(inputArgs, index, arg)
      index += 1
      continue
    }
    if (arg === '--extension-schema-version') {
      const value = readValue(inputArgs, index, arg)
      if (!isTypeSpecOpenApiExtensionSchemaVersion(value)) {
        throw new Error(
          `--extension-schema-version must be ${formatTypeSpecOpenApiExtensionSchemaVersions()}`,
        )
      }
      args.extensionSchemaVersion = value
      index += 1
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }
  return args
}

function readValue(rawArgs: string[], index: number, option: string): string {
  const value = rawArgs[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`)
  return value
}

function writeText(filePath: string, value: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, value)
}

function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function printUsage(): void {
  console.error(`Usage:
  pnpm typespec:sidecar-to-extensions -- --sidecar <oa-sdk.typespec-compat-sidecar.json> [options]

Options:
  --output, -o <path>                 Write TypeSpec @extension snippets.
  --remaining-sidecar <path>          Write entries that still need sidecar ownership.
  --report <path>                     Write conversion report JSON.
  --extension-schema-version <value>  ${formatTypeSpecOpenApiExtensionSchemaVersions()}.
`)
}
