/**
 * Enforce the API contract SemVer rule against the PR base snapshot.
 *
 * A breaking OpenAPI change is permitted only with the ContractVersion bump
 * required by docs/guides/typespec-authoring-conventions.md. This complements
 * the human-readable spec:diff summary with a CI policy gate.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  diffEndpoints,
  evaluateContractVersionPolicy,
  formatMarkdown,
} from '../packages/codegen/src/schema-governance.js'

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))
const snapshotPath = 'packages/schemas/typespec/approved.openapi.yaml'
const versionPath = 'packages/schemas/typespec/version.tsp'

const baseSnapshot = args.base
  ? readFile(args.base)
  : readGitFile(requiredOption(args.baseRef, '--base-ref'), snapshotPath)
const baseVersionSource = args.baseVersion
  ? readFile(args.baseVersion)
  : readGitFile(requiredOption(args.baseRef, '--base-ref'), versionPath)
const headSnapshot = readFile(args.head ?? snapshotPath)
const headVersionSource = readFile(args.headVersion ?? versionPath)

const baseVersion = readContractVersion(baseVersionSource, args.baseVersion ?? `${args.baseRef}:${versionPath}`)
const headVersion = readContractVersion(headVersionSource, args.headVersion ?? versionPath)
const baseSpec = parseOpenApi(baseSnapshot, args.base ?? `${args.baseRef}:${snapshotPath}`)
const headSpec = parseOpenApi(headSnapshot, args.head ?? snapshotPath)
const diff = diffEndpoints(baseSpec, headSpec)
const policy = evaluateContractVersionPolicy({ baseVersion, headVersion, diff })

console.log(formatMarkdown(diff))
console.log('')
console.log('### API Contract Version Policy')
console.log(`- base ContractVersion: \`${baseVersion}\``)
console.log(`- head ContractVersion: \`${headVersion}\``)
console.log(`- breaking changes: ${policy.breakingChangeCount}`)
console.log(`- result: ${policy.pass ? 'pass' : 'fail'} — ${policy.reason}`)

if (!policy.pass) process.exitCode = 1

function parseArgs(raw: string[]) {
  if (raw.includes('--help') || raw.includes('-h')) {
    console.log(`Usage:
  pnpm schema:check-contract-version -- --base-ref <git-ref>
  pnpm schema:check-contract-version -- --base <snapshot.yaml> --base-version <version.tsp> [--head <snapshot.yaml>] [--head-version <version.tsp>]
`)
    process.exit(0)
  }
  return {
    baseRef: readOption(raw, '--base-ref'),
    base: readOption(raw, '--base'),
    baseVersion: readOption(raw, '--base-version'),
    head: readOption(raw, '--head'),
    headVersion: readOption(raw, '--head-version'),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function requiredOption(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required unless --base and --base-version are both supplied`)
  return value
}

function readFile(path: string): string {
  const absolutePath = resolve(root, path)
  if (!existsSync(absolutePath)) throw new Error(`file not found: ${path}`)
  return readFileSync(absolutePath, 'utf8')
}

function readGitFile(ref: string, path: string): string {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' })
  } catch {
    throw new Error(`could not read ${path} from git ref ${ref}`)
  }
}

function readContractVersion(source: string, label: string): string {
  const match = /\bconst\s+ContractVersion\s*=\s*"([^"]+)"\s*;/.exec(source)
  if (!match) throw new Error(`ContractVersion declaration not found: ${label}`)
  return match[1]
}

function parseOpenApi(source: string, label: string): Record<string, unknown> {
  const document = parseYaml(source)
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`OpenAPI document is not an object: ${label}`)
  }
  return document as Record<string, unknown>
}
