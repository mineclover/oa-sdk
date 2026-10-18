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
 *
 * This module is also the one record of which output and which `oa-gen`
 * command needs which companion, so that `oa-gen init` recommends the same
 * packages that the commands of its scaffold load.
 */
import type { ArtifactKind, OaConfig } from '../../config.js'
import { BUILT_AGAINST_VERSIONS, builtAgainstRange } from './built-against-versions.js'
import { CliExitError } from './errors.js'
import type { CommandContext } from './types.js'

/**
 * The entry point `oa-gen` loads from each companion package: its root.
 *
 * Each must load in an install that has the companion and its dependencies but
 * none of its optional peer dependencies, which package managers leave out
 * unless the project installs them, and neither the install commands `oa-gen`
 * prints nor `oa-gen init` add. The release policy holds every package root to
 * that: only the export subpaths it declares under `optionalPeerEntryPoints`
 * may import an optional peer. For `@oa-sdk/mock-server` these are
 * `./adapters/msw` and `./browser`, which import `msw`; its root, which
 * `oa-gen mock` loads, does not export the MSW adapter.
 */
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
 * True only when `error` reports that `packageName` itself cannot be resolved,
 * whether it was imported by its bare name or by a subpath export such as
 * `@oa-sdk/mock-server/adapters/node-http`, so that the answer does not depend
 * on which entry point of the package a companion importer loads.
 *
 * Node reports a missing package as `Cannot find package '<name>'` (ESM, the
 * package name even for a subpath import) or `Cannot find module '<specifier>'`
 * (CommonJS); Bun uses the latter form for ESM. Matching the quoted bare name,
 * or a quoted specifier that starts with it and a slash, keeps other resolution
 * failures out: Node names the missing file path when the package is installed
 * without its build output, and names the other package when one of the
 * package's own dependencies is missing. Those are broken installs, not absent
 * packages, and must surface unchanged.
 */
export function isMissingPackageError(error: unknown, packageName: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
  if (typeof message !== 'string') return false
  return message.includes(`Cannot find package '${packageName}'`)
    || message.includes(`Cannot find module '${packageName}'`)
    || message.includes(`Cannot find module '${packageName}/`)
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

// ---------------------------------------------------------------------------
// Install commands

/**
 * Install command for `packages`, in the dialect of the package manager that
 * launched `oa-gen` (read from `npm_config_user_agent`), falling back to npm.
 * Omitting `userAgent` or passing `undefined` both read the environment at call
 * time; package managers export that variable to every script they run.
 * Packages are added as dev dependencies, next to `@oa-sdk/codegen` itself,
 * because `oa-gen` loads them at generation time. Each package carries the
 * range this build supports when it is known; the specifier is quoted because
 * `^` is special to some shells (cmd.exe, zsh with EXTENDED_GLOB).
 */
export function companionInstallCommand(
  packages: readonly string[],
  userAgent: string | undefined = process.env['npm_config_user_agent'],
  versions: Readonly<Record<string, string>> = BUILT_AGAINST_VERSIONS,
): string {
  const list = [...new Set(packages)].map((name) => {
    const range = builtAgainstRange(name, versions)
    return range === undefined ? name : `"${name}@${range}"`
  }).join(' ')
  switch (userAgent?.split('/', 1)[0]) {
    case 'pnpm': return `pnpm add -D ${list}`
    case 'yarn': return `yarn add -D ${list}`
    case 'bun': return `bun add -d ${list}`
    default: return `npm install --save-dev ${list}`
  }
}

// ---------------------------------------------------------------------------
// What needs which companion

/** An output of `oa-gen generate` that a companion package produces, with the artifact kinds it writes. */
export interface CompanionOutput {
  label: string
  kinds: readonly ArtifactKind[]
}

/** Outputs of `oa-gen generate` that companion packages produce. */
export const GENERATE_COMPANION_OUTPUTS = {
  contracts: { label: 'handler contracts', kinds: ['contract', 'router'] },
  client: { label: 'client SDK', kinds: ['client'] },
  tanstack: { label: 'TanStack Query options', kinds: ['keys', 'queries'] },
  crdt: { label: 'CRDT modules', kinds: ['crdt-contract', 'crdt-router', 'crdt-client', 'crdt-hooks'] },
} as const satisfies Record<string, CompanionOutput>

/** An output that could not be produced because its companion package is absent. */
export interface MissingCompanionOutput {
  /** Human-readable output name, e.g. "handler contracts". */
  output: string
  packageName: CompanionPackageName
  /** What requested the output explicitly, e.g. a config switch or a command name. */
  requestedBy?: string
}

/** An output the configuration turns on, together with the switch that does so. */
export interface ExplicitCompanionOutput extends MissingCompanionOutput {
  configSwitch: string
}

/** Configuration switches that turn on a companion-produced `oa-gen generate` output. */
const COMPANION_CONFIG_SWITCHES = [
  {
    configSwitch: 'core.contracts.pureHandlers',
    output: GENERATE_COMPANION_OUTPUTS.contracts,
    packageName: '@oa-sdk/router',
    value: (config: Pick<OaConfig, 'core'>) => config.core?.contracts?.pureHandlers,
  },
  {
    configSwitch: 'core.client.enabled',
    output: GENERATE_COMPANION_OUTPUTS.client,
    packageName: '@oa-sdk/client',
    value: (config: Pick<OaConfig, 'core'>) => config.core?.client?.enabled,
  },
] as const satisfies ReadonlyArray<{
  configSwitch: string
  output: CompanionOutput
  packageName: CompanionPackageName
  value: (config: Pick<OaConfig, 'core'>) => boolean | undefined
}>

/**
 * Outputs that a configuration requests explicitly.
 *
 * A switch set to `true` in the configuration file is an explicit request,
 * whoever wrote it: the user, or `oa-gen init`, which recommends the matching
 * companion packages for every switch it writes. Pass the configuration as
 * written, before archetype defaults are merged in. Everything else the
 * pipeline produces through a companion package is only implied: switches left
 * at their default, TanStack Query options (no switch), and CRDT modules
 * (driven by spec extensions).
 */
export function explicitCompanionOutputs(config: Pick<OaConfig, 'core'>): ExplicitCompanionOutput[] {
  return COMPANION_CONFIG_SWITCHES
    .filter(entry => entry.value(config) === true)
    .map(entry => ({
      output: entry.output.label,
      packageName: entry.packageName,
      configSwitch: entry.configSwitch,
      requestedBy: `${entry.configSwitch}: true`,
    }))
}

/**
 * `oa-gen` commands that exist to produce a single companion's output, with
 * that companion. They cannot run at all without it, unlike `oa-gen generate`,
 * whose needs depend on the configuration (see `explicitCompanionOutputs`).
 */
export const COMMAND_COMPANIONS = {
  mock: '@oa-sdk/mock-server',
  'generate:client': '@oa-sdk/client',
  'pack:client': '@oa-sdk/client',
  'generate:tanstack': '@oa-sdk/client',
} as const satisfies Readonly<Record<string, CompanionPackageName>>

export type CompanionCommand = keyof typeof COMMAND_COMPANIONS

/** The companion package `command` cannot run without, if it is one of `COMMAND_COMPANIONS`. */
export function commandCompanion(command: string): CompanionPackageName | undefined {
  return Object.hasOwn(COMMAND_COMPANIONS, command)
    ? COMMAND_COMPANIONS[command as CompanionCommand]
    : undefined
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
 * Loads the companion package `command` cannot run without. When it is not
 * installed, prints the install command and exits with status 1.
 */
export async function requireCompanion<C extends CompanionCommand>(
  command: C,
  request: { output: string; importer?: CompanionImporter | undefined },
): Promise<CompanionModules[(typeof COMMAND_COMPANIONS)[C]]> {
  const packageName = COMMAND_COMPANIONS[command]
  const loaded = await new CompanionLoader(request.importer).load(packageName)
  if (loaded === undefined) {
    console.error(formatMissingCompanionError(command, [{
      output: request.output,
      packageName,
      requestedBy: `oa-gen ${command}`,
    }]))
    throw new CliExitError(1)
  }
  return loaded
}
