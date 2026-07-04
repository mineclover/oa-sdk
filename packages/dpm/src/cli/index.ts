#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { parse } from 'yaml'

import { createPostgresCatalogSnapshot } from '../catalog/postgres.js'
import type { CatalogSnapshot, PostgresCatalogSnapshotInput } from '../catalog/types.js'
import { compileDpmPlan } from '../compiler/compile.js'
import { createDpmDryRunReport } from '../dry-run/report.js'
import { parseRegistrySnapshotYaml } from '../registry/snapshot.js'
import type { RegistrySnapshot } from '../registry/types.js'
import { validateDpmManifest } from '../validator/manifest.js'

export type DpmCliCommand = 'validate' | 'compile' | 'dry-run'

export type DpmCliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type ParsedArgs = {
  command: DpmCliCommand
  manifestPath: string
  catalogPath: string
  registryPath: string
  estimatedRowsPath?: string
}

export async function runDpmCli(argv: readonly string[]): Promise<DpmCliResult> {
  try {
    const args = parseArgs(argv)
    const inputs = readCliInputs(args)

    if (args.command === 'validate') {
      const result = validateDpmManifest({
        manifest: inputs.manifest,
        catalog: inputs.catalog,
        registry: inputs.registry,
        phase: 'validate',
      })
      return jsonResult(args.command, result.summary.errors > 0 ? 1 : 0, result)
    }

    const compiled = compileDpmPlan({
      manifest: inputs.manifest,
      catalog: inputs.catalog,
      registry: inputs.registry,
      phase: args.command === 'compile' ? 'compile' : 'dry_run',
    })
    if (!compiled.ok) {
      return jsonResult(args.command, 1, compiled)
    }
    if (args.command === 'compile') {
      return jsonResult(args.command, 0, compiled)
    }

    return jsonResult(args.command, 0, createDpmDryRunReport({
      plan: compiled.plan,
      ...(inputs.estimatedRows ? { estimatedRows: inputs.estimatedRows } : {}),
    }))
  } catch (error) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command, ...flags] = argv
  if (command !== 'validate' && command !== 'compile' && command !== 'dry-run') {
    throw new Error('Usage: oa-dpm <validate|compile|dry-run> --manifest <path> --catalog <path> --registry <path>')
  }

  const values = new Map<string, string>()
  for (let index = 0; index < flags.length; index += 2) {
    const key = flags[index]
    const value = flags[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`)
    }
    values.set(key, value)
  }

  const manifestPath = requireFlag(values, '--manifest')
  const catalogPath = requireFlag(values, '--catalog')
  const registryPath = requireFlag(values, '--registry')
  const estimatedRowsPath = values.get('--estimated-rows')

  return {
    command,
    manifestPath,
    catalogPath,
    registryPath,
    ...(estimatedRowsPath ? { estimatedRowsPath } : {}),
  }
}

function readCliInputs(args: ParsedArgs): {
  manifest: unknown
  catalog: CatalogSnapshot
  registry: RegistrySnapshot
  estimatedRows?: Record<string, number>
} {
  const estimatedRows = args.estimatedRowsPath ? readEstimatedRows(args.estimatedRowsPath) : undefined
  return {
    manifest: readStructuredFile(args.manifestPath),
    catalog: readCatalogSnapshot(args.catalogPath),
    registry: parseRegistrySnapshotYaml(readFileSync(args.registryPath, 'utf8')),
    ...(estimatedRows ? { estimatedRows } : {}),
  }
}

function readCatalogSnapshot(path: string): CatalogSnapshot {
  const raw = readStructuredFile(path) as Record<string, unknown>
  if (raw.kind === 'dpm.catalog.snapshot.v1') {
    return raw as CatalogSnapshot
  }
  return createPostgresCatalogSnapshot(raw as PostgresCatalogSnapshotInput)
}

function readEstimatedRows(path: string): Record<string, number> {
  const raw = readStructuredFile(path)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('--estimated-rows must point to an object file')
  }
  const rows: Record<string, number> = {}
  for (const [table, count] of Object.entries(raw)) {
    if (typeof count !== 'number') {
      throw new Error(`estimated row count for ${table} must be a number`)
    }
    rows[table] = count
  }
  return rows
}

function readStructuredFile(path: string): unknown {
  return parse(readFileSync(path, 'utf8')) as unknown
}

function requireFlag(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name)
  if (!value) throw new Error(`Missing required ${name}`)
  return value
}

function jsonResult(command: DpmCliCommand, exitCode: number, result: unknown): DpmCliResult {
  return {
    exitCode,
    stdout: `${JSON.stringify({ command, result }, null, 2)}\n`,
    stderr: '',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDpmCli(process.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
