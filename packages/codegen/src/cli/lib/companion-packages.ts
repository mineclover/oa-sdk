/**
 * Companion packages of `@oa-sdk/codegen`.
 *
 * `oa-gen` delegates some outputs to sibling packages instead of bundling them:
 * handler contracts and CRDT routers come from `@oa-sdk/router`, the client SDK,
 * TanStack Query options and CRDT clients come from `@oa-sdk/client`, and the
 * instant mock server comes from `@oa-sdk/mock-server`. They are Downstream
 * Integration packages, and the release policy lets a Core Platform package such
 * as codegen reference them only through `devDependencies`, so a published
 * install contains them only when the consumer installs them next to codegen.
 * Every load goes through this module so that "the package is not installed" is
 * told apart from "the package is installed but failed to load", and so that
 * the former is reported with the command that installs it.
 */
import { CliExitError } from './errors.js'
import type { CommandContext } from './types.js'

export interface CompanionModules {
  '@oa-sdk/client': typeof import('@oa-sdk/client')
  '@oa-sdk/router': typeof import('@oa-sdk/router')
  '@oa-sdk/mock-server': typeof import('@oa-sdk/mock-server')
}

export type CompanionPackageName = keyof CompanionModules

/** Loads one companion package. Tests inject their own to simulate a published install. */
export type CompanionImporter = <N extends CompanionPackageName>(name: N) => Promise<CompanionModules[N]>

/** Command context whose caller may replace how companion packages are imported. */
export interface CompanionCommandContext extends CommandContext {
  importCompanion?: CompanionImporter
}

// One literal specifier per package keeps each an explicit external import of the bundle.
const companionImporters: { readonly [N in CompanionPackageName]: () => Promise<CompanionModules[N]> } = {
  '@oa-sdk/client': () => import('@oa-sdk/client'),
  '@oa-sdk/router': () => import('@oa-sdk/router'),
  '@oa-sdk/mock-server': () => import('@oa-sdk/mock-server'),
}

/** Every companion package `oa-gen` may load. */
export const COMPANION_PACKAGES = Object.keys(companionImporters) as CompanionPackageName[]

export const importCompanion: CompanionImporter = (name) => companionImporters[name]()

/** Returns the importer a command should use: the injected one, or the real dynamic import. */
export function companionImporterFrom(context: CommandContext | undefined): CompanionImporter {
  return (context as CompanionCommandContext | undefined)?.importCompanion ?? importCompanion
}

/**
 * True only when `error` reports that `packageName` itself cannot be resolved.
 *
 * Node reports a missing package as `Cannot find package '<name>'` (ESM) or
 * `Cannot find module '<name>'` (CommonJS); Bun uses the latter form for ESM.
 * Matching the quoted bare name keeps other resolution failures out: Node
 * names the missing file path when the package is installed without its build
 * output, and names the other package when one of the package's own
 * dependencies is missing. Those are broken installs, not absent packages, and
 * must surface unchanged.
 */
export function isMissingPackageError(error: unknown, packageName: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
  if (typeof message !== 'string') return false
  return message.includes(`Cannot find package '${packageName}'`)
    || message.includes(`Cannot find module '${packageName}'`)
}

/**
 * Loads companion packages once each.
 *
 * `load` resolves to the module, or to `undefined` when the package is not
 * installed. Any other load failure rejects with the original error.
 */
export class CompanionLoader {
  private readonly loads = new Map<CompanionPackageName, Promise<unknown>>()

  constructor(private readonly importer: CompanionImporter = importCompanion) {}

  load<N extends CompanionPackageName>(name: N): Promise<CompanionModules[N] | undefined> {
    let pending = this.loads.get(name)
    if (!pending) {
      pending = this.importer(name).catch((error: unknown) => {
        if (isMissingPackageError(error, name)) return undefined
        throw error
      })
      this.loads.set(name, pending)
    }
    return pending as Promise<CompanionModules[N] | undefined>
  }
}

/** An output that could not be produced because its companion package is absent. */
export interface MissingCompanionOutput {
  /** Human-readable output name, e.g. "handler contracts". */
  output: string
  packageName: CompanionPackageName
  /** What requested the output explicitly, e.g. a config switch or a command name. */
  requestedBy?: string
}

/**
 * Install command for `packages`, in the dialect of the package manager that
 * launched `oa-gen` (read from `npm_config_user_agent`), falling back to npm.
 * Packages are added as dev dependencies, next to `@oa-sdk/codegen` itself,
 * because `oa-gen` loads them at generation time.
 */
export function companionInstallCommand(
  packages: readonly string[],
  userAgent: string | undefined = process.env['npm_config_user_agent'],
): string {
  const list = [...new Set(packages)].join(' ')
  switch (userAgent?.split('/', 1)[0]) {
    case 'pnpm': return `pnpm add -D ${list}`
    case 'yarn': return `yarn add -D ${list}`
    case 'bun': return `bun add -d ${list}`
    default: return `npm install --save-dev ${list}`
  }
}

/** Packages named by `entries`, in first-seen order. */
export function missingCompanionPackages(entries: readonly MissingCompanionOutput[]): CompanionPackageName[] {
  return [...new Set(entries.map(entry => entry.packageName))]
}

/** Error text for explicitly requested outputs whose companion package is absent. */
export function formatMissingCompanionError(command: string, entries: readonly MissingCompanionOutput[]): string {
  const packages = missingCompanionPackages(entries)
  const lines = [entries.length === 1
    ? `[oa-gen ${command}] A requested output needs a companion package that is not installed:`
    : `[oa-gen ${command}] Requested outputs need companion packages that are not installed:`]
  for (const entry of entries) {
    const requestedBy = entry.requestedBy ? ` (requested by ${entry.requestedBy})` : ''
    lines.push(`  - ${entry.output}${requestedBy} requires ${entry.packageName}`)
  }
  lines.push(`Install ${packages.length === 1 ? 'it' : 'them'} next to @oa-sdk/codegen:`)
  lines.push(`  ${companionInstallCommand(packages)}`)
  return lines.join('\n')
}

/**
 * Loads a package the running command cannot work without. When it is not
 * installed, prints the install command and exits with status 1.
 */
export async function requireCompanion<N extends CompanionPackageName>(
  name: N,
  request: { command: string; output: string; importer?: CompanionImporter },
): Promise<CompanionModules[N]> {
  const loaded = await new CompanionLoader(request.importer).load(name)
  if (loaded === undefined) {
    console.error(formatMissingCompanionError(request.command, [{
      output: request.output,
      packageName: name,
      requestedBy: `oa-gen ${request.command}`,
    }]))
    throw new CliExitError(1)
  }
  return loaded
}
