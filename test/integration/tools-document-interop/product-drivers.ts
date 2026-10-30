import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'

export type ExternalInteropDriverId =
  | 'soffice'
  | 'google-sheets'
  | 'notion'
  | 'playwright'

export interface ExternalInteropDriverStatus {
  readonly id: ExternalInteropDriverId
  readonly lane: 'external-e2e'
  readonly available: boolean
  readonly reason: string
  readonly requiresCredentials: boolean
  readonly requiresNetwork: boolean
  readonly requiresInstalledProduct: boolean
  readonly command?: string
  readonly module?: string
  readonly credentialEnv?: readonly string[]
}

export interface ExternalInteropDriverManifest {
  readonly schemaVersion: 'tools-document-interop/drivers/v1'
  readonly cwd: string
  readonly defaultCiSafe: true
  readonly drivers: readonly ExternalInteropDriverStatus[]
}

export interface ProductDriverDetectionOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly locateExecutable?: (command: string) => string | undefined
  readonly resolveModule?: (specifier: string) => string | undefined
}

function defaultLocateExecutable(command: string): string | undefined {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  try {
    const output = execFileSync(locator, [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = output.split(/\r?\n/).map(value => value.trim()).find(Boolean)
    return first || undefined
  } catch {
    return undefined
  }
}

function defaultResolveModule(specifier: string, cwd: string): string | undefined {
  try {
    return createRequire(resolvePath(cwd, 'package.json')).resolve(specifier)
  } catch {
    return undefined
  }
}

function hasValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === 'string' && env[key]!.trim().length > 0
}

function configuredCredentialKeys(env: NodeJS.ProcessEnv, keys: readonly string[]): string[] {
  return keys.filter(key => hasValue(env, key))
}

function resolveSoffice(
  env: NodeJS.ProcessEnv,
  locateExecutable: (command: string) => string | undefined,
): string | undefined {
  const explicit = env.SOFFICE_BIN?.trim()
  if (explicit) return existsSync(explicit) ? explicit : undefined
  return locateExecutable('soffice') ?? locateExecutable('libreoffice')
}

function createSofficeStatus(
  env: NodeJS.ProcessEnv,
  locateExecutable: (command: string) => string | undefined,
): ExternalInteropDriverStatus {
  const explicit = env.SOFFICE_BIN?.trim()
  const command = resolveSoffice(env, locateExecutable)
  return {
    id: 'soffice',
    lane: 'external-e2e',
    available: Boolean(command),
    reason: command
      ? `Found Office conversion executable at ${command}`
      : explicit
        ? `SOFFICE_BIN does not point to an executable: ${explicit}`
        : 'Install soffice/libreoffice or set SOFFICE_BIN to enable this lane',
    requiresCredentials: false,
    requiresNetwork: false,
    requiresInstalledProduct: true,
    ...(command ? { command } : {}),
  }
}

function createGoogleStatus(
  env: NodeJS.ProcessEnv,
  resolveModule: (specifier: string) => string | undefined,
): ExternalInteropDriverStatus {
  const credentialEnv = configuredCredentialKeys(env, [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_OAUTH_ACCESS_TOKEN',
    'GOOGLE_SHEETS_INTEROP_TOKEN',
  ])
  const module = resolveModule('googleapis')
  const credentialsReady = credentialEnv.length > 0
  const available = Boolean(module && credentialsReady)
  const reason = !module
    ? 'Install googleapis in the external harness'
    : !credentialsReady
      ? 'Set a Google credential environment variable for the external lane'
      : 'googleapis and a credential marker are available; network access remains required'
  return {
    id: 'google-sheets',
    lane: 'external-e2e',
    available,
    reason,
    requiresCredentials: true,
    requiresNetwork: true,
    requiresInstalledProduct: false,
    module: 'googleapis',
    credentialEnv,
  }
}

function createNotionStatus(
  env: NodeJS.ProcessEnv,
  resolveModule: (specifier: string) => string | undefined,
): ExternalInteropDriverStatus {
  const credentialEnv = configuredCredentialKeys(env, ['NOTION_TOKEN', 'NOTION_DATABASE_ID'])
  const module = resolveModule('@notionhq/client')
  const credentialsReady = credentialEnv.includes('NOTION_TOKEN') && credentialEnv.includes('NOTION_DATABASE_ID')
  const available = Boolean(module && credentialsReady)
  const reason = !module
    ? 'Install @notionhq/client in the external harness'
    : !credentialsReady
      ? 'Set NOTION_TOKEN and NOTION_DATABASE_ID for the external lane'
      : 'Notion client and database credential markers are available; network access remains required'
  return {
    id: 'notion',
    lane: 'external-e2e',
    available,
    reason,
    requiresCredentials: true,
    requiresNetwork: true,
    requiresInstalledProduct: false,
    module: '@notionhq/client',
    credentialEnv,
  }
}

function createPlaywrightStatus(
  resolveModule: (specifier: string) => string | undefined,
): ExternalInteropDriverStatus {
  const module = resolveModule('playwright-core')
  return {
    id: 'playwright',
    lane: 'external-e2e',
    available: Boolean(module),
    reason: module
      ? 'playwright-core is resolvable; a browser binary and product session are still required'
      : 'Install playwright-core in the external harness to enable UI export/import flows',
    requiresCredentials: true,
    requiresNetwork: true,
    requiresInstalledProduct: true,
    module: 'playwright-core',
  }
}

/**
 * Detects external interop prerequisites without contacting any external service.
 * A true `available` value only means that the required local executable/module and
 * credential markers exist; product operations remain the responsibility of the
 * external-e2e harness.
 */
export function detectExternalInteropDrivers(
  options: ProductDriverDetectionOptions = {},
): ExternalInteropDriverManifest {
  const cwd = resolvePath(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const locateExecutable = options.locateExecutable ?? defaultLocateExecutable
  const resolveModule = options.resolveModule ?? ((specifier: string) => defaultResolveModule(specifier, cwd))
  const drivers = [
    createSofficeStatus(env, locateExecutable),
    createGoogleStatus(env, resolveModule),
    createNotionStatus(env, resolveModule),
    createPlaywrightStatus(resolveModule),
  ] as const
  return {
    schemaVersion: 'tools-document-interop/drivers/v1',
    cwd,
    defaultCiSafe: true,
    drivers,
  }
}

export function assertExternalInteropDriversAvailable(
  manifest: ExternalInteropDriverManifest,
  required: readonly ExternalInteropDriverId[],
): void {
  const missing = required
    .map(id => manifest.drivers.find(driver => driver.id === id))
    .filter((driver): driver is ExternalInteropDriverStatus => !driver || !driver.available)
    .map(driver => driver ? `${driver.id}: ${driver.reason}` : 'unknown driver')
  if (missing.length > 0) {
    throw new Error(`External interop prerequisites are unavailable:\n${missing.map(item => `- ${item}`).join('\n')}`)
  }
}
