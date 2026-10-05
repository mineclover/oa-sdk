import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import ts from 'typescript'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateClientCommand, packClientCommand } from '../../cli/commands/generate-client.js'
import { generateTanstackCommand } from '../../cli/commands/generate-tanstack.js'
import { generate } from '../../cli/commands/generate.js'
import { mock, type MockCommandContext } from '../../cli/commands/mock.js'
import { CliExitError } from '../../cli/lib/errors.js'
import { builtAgainstRange } from '../../cli/lib/built-against-versions.js'
import {
  COMMAND_COMPANIONS,
  COMPANION_PACKAGES,
  CompanionLoader,
  commandCompanion,
  explicitCompanionOutputs,
  importCompanion,
  isMissingPackageError,
  companionInstallCommand,
  requireCompanion,
  type CompanionCommand,
  type CompanionCommandContext,
  type CompanionImporter,
} from '../../cli/lib/companion-packages.js'
import { importerWithout, packageNotFoundError } from '../helpers/companion-packages.js'

type ResolutionFailure = { code: unknown; message: string }

const PACKAGE_DIRECTORY = path.resolve(__dirname, '../../..')
const COMPANION_LOADER_SOURCE = path.join(PACKAGE_DIRECTORY, 'src/cli/lib/companion-packages.ts')

/** Package name of a bare specifier: `@scope/name/sub/path` → `@scope/name`. */
const packageNameOf = (specifier: string): string =>
  specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')

/**
 * The specifiers the companion loader imports, read from its source. Each
 * importer is a literal `import()`, which the build keeps as an external import
 * of the bundle, so these are the specifiers a published `oa-gen` resolves.
 */
function companionLoaderSpecifiers(): Map<string, string> {
  const source = ts.createSourceFile(
    COMPANION_LOADER_SOURCE,
    fs.readFileSync(COMPANION_LOADER_SOURCE, 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  const specifiers = new Map<string, string>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments
      if (specifier && ts.isStringLiteralLike(specifier)) specifiers.set(packageNameOf(specifier.text), specifier.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

/**
 * Imports `specifiers` with a real Node process run in `directory`, and returns
 * the failure of each one that did not load.
 */
function importInNode(directory: string, specifiers: readonly string[]): Record<string, ResolutionFailure> {
  const script = `
    const failures = {}
    for (const specifier of ${JSON.stringify(specifiers)}) {
      try { await import(specifier) } catch (error) { failures[specifier] = { code: error.code, message: error.message } }
    }
    process.stdout.write(JSON.stringify(failures))
  `
  // NODE_PATH (set by package-manager runners) would let resolution escape the throwaway install.
  const { NODE_PATH: _nodePath, NODE_OPTIONS: _nodeOptions, ...env } = process.env
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: directory,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  })
  return JSON.parse(output) as Record<string, ResolutionFailure>
}

/**
 * Lays out a published install of `packageNames` in `installDirectory`: each
 * package holds only the files it publishes, next to its dependencies and its
 * required peer dependencies. Optional peer dependencies are left out, as
 * package managers leave them out unless the project installs them. Returns
 * the optional peers that were left out.
 */
function installWithoutOptionalPeers(installDirectory: string, packageNames: readonly string[]): string[] {
  const modules = path.join(installDirectory, 'node_modules')
  const sources = packageNames.map((name) => {
    const source = fs.realpathSync(path.join(PACKAGE_DIRECTORY, 'node_modules', name))
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as {
      files?: string[]
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    const target = path.join(modules, name)
    fs.mkdirSync(target, { recursive: true })
    fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'))
    for (const entry of manifest.files ?? []) {
      fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true })
    }
    return { source, manifest }
  })

  const leftOut = new Set<string>()
  for (const { source, manifest } of sources) {
    const optionalPeers = Object.keys(manifest.peerDependencies ?? {})
      .filter(peer => manifest.peerDependenciesMeta?.[peer]?.optional === true)
    const required = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}).filter(peer => !optionalPeers.includes(peer)),
    ]
    for (const dependency of required) {
      const link = path.join(modules, dependency)
      if (fs.existsSync(link)) continue
      fs.mkdirSync(path.dirname(link), { recursive: true })
      // The workspace links every declared dependency of a package next to it.
      fs.symlinkSync(fs.realpathSync(path.join(source, 'node_modules', dependency)), link, 'dir')
    }
    for (const peer of optionalPeers) leftOut.add(peer)
  }
  return [...leftOut].filter(peer => !fs.existsSync(path.join(modules, peer)))
}

/**
 * Resolves specifiers with a real Node process inside a throwaway install that
 * has an absent package, a package without build output, and a package whose
 * own dependency is absent.
 */
function captureNodeResolutionFailures(): Record<string, ResolutionFailure> {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-companion-install-'))
  try {
    const unbuilt = path.join(installDir, 'node_modules/@oa-sdk/client')
    fs.mkdirSync(unbuilt, { recursive: true })
    fs.writeFileSync(path.join(unbuilt, 'package.json'), JSON.stringify({
      name: '@oa-sdk/client', type: 'module', exports: { '.': './dist/index.js' },
    }))

    const brokenDependency = path.join(installDir, 'node_modules/@oa-sdk/router')
    fs.mkdirSync(path.join(brokenDependency, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(brokenDependency, 'package.json'), JSON.stringify({
      name: '@oa-sdk/router', type: 'module', exports: { '.': './dist/index.js' },
    }))
    fs.writeFileSync(path.join(brokenDependency, 'dist/index.js'), "export * from '@oa-sdk/parser'\n")

    // The absent package is also imported through the entry point the companion loader uses.
    const absent = [...new Set(['@oa-sdk/mock-server', companionLoaderSpecifiers().get('@oa-sdk/mock-server')!])]
    const script = `
      import { createRequire } from 'node:module'
      const failures = {}
      for (const specifier of [...${JSON.stringify(absent)}, '@oa-sdk/client', '@oa-sdk/router']) {
        try { await import(specifier) } catch (error) { failures[specifier] = { code: error.code, message: error.message } }
      }
      for (const specifier of ${JSON.stringify(absent)}) {
        try { createRequire(process.cwd() + '/')(specifier) } catch (error) {
          failures['require:' + specifier] = { code: error.code, message: error.message }
        }
      }
      process.stdout.write(JSON.stringify(failures))
    `
    // NODE_PATH (set by package-manager runners) would let require() escape the throwaway install.
    const { NODE_PATH: _nodePath, NODE_OPTIONS: _nodeOptions, ...env } = process.env
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: installDir,
      encoding: 'utf8',
      env,
      timeout: 30_000,
    })
    return JSON.parse(output) as Record<string, ResolutionFailure>
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true })
  }
}

const asError = (failure: ResolutionFailure | undefined): Error => {
  expect(failure, 'Node reported no resolution failure').toBeDefined()
  return Object.assign(new Error(failure!.message), { code: failure!.code })
}

describe('isMissingPackageError against real Node resolution failures', () => {
  let failures: Record<string, ResolutionFailure>

  beforeAll(() => {
    failures = captureNodeResolutionFailures()
  })

  it('recognises an absent package for ESM import and CommonJS require', () => {
    expect(isMissingPackageError(asError(failures['@oa-sdk/mock-server']), '@oa-sdk/mock-server')).toBe(true)
    expect(isMissingPackageError(asError(failures['require:@oa-sdk/mock-server']), '@oa-sdk/mock-server')).toBe(true)
  })

  it('recognises an absent package imported through the entry point the companion loader uses', () => {
    const entry = companionLoaderSpecifiers().get('@oa-sdk/mock-server')!
    expect(isMissingPackageError(asError(failures[entry]), '@oa-sdk/mock-server')).toBe(true)
    expect(isMissingPackageError(asError(failures[`require:${entry}`]), '@oa-sdk/mock-server')).toBe(true)
  })

  it('does not treat an installed package without build output as absent', () => {
    const error = asError(failures['@oa-sdk/client'])
    expect(error.message).toContain('@oa-sdk/client')
    expect(isMissingPackageError(error, '@oa-sdk/client')).toBe(false)
  })

  it('attributes a missing dependency of an installed package to that dependency', () => {
    const error = asError(failures['@oa-sdk/router'])
    expect(isMissingPackageError(error, '@oa-sdk/router')).toBe(false)
    expect(isMissingPackageError(error, '@oa-sdk/parser')).toBe(true)
  })

  it('matches the simulated error used by the published-install tests', () => {
    const real = failures['@oa-sdk/mock-server']!
    const simulated = packageNotFoundError('@oa-sdk/mock-server') as Error & { code?: unknown }
    expect(simulated.code).toBe(real.code)
    const prefix = (message: string) => message.slice(0, message.indexOf(' imported from '))
    expect(prefix(simulated.message)).toBe(prefix(real.message))
  })
})

describe('isMissingPackageError', () => {
  it('requires the exact package name', () => {
    expect(isMissingPackageError(packageNotFoundError('@oa-sdk/client-extra'), '@oa-sdk/client')).toBe(false)
    expect(isMissingPackageError(packageNotFoundError('@oa-sdk/client'), '@oa-sdk/client')).toBe(true)
  })

  // Bun reports an absent package imported by a subpath with the whole specifier:
  // Cannot find module '@oa-sdk/mock-server/adapters/node-http' from '/consumer/cli.js'
  it('accepts a subpath of the package and no other package', () => {
    const notFound = (specifier: string) => Object.assign(
      new Error(`Cannot find module '${specifier}' from '/consumer/node_modules/@oa-sdk/codegen/dist/cli/index.js'`),
      { code: 'ERR_MODULE_NOT_FOUND' },
    )
    expect(isMissingPackageError(notFound('@oa-sdk/mock-server/adapters/node-http'), '@oa-sdk/mock-server')).toBe(true)
    expect(isMissingPackageError(notFound('@oa-sdk/mock-server-extra/adapters/node-http'), '@oa-sdk/mock-server')).toBe(false)
    expect(isMissingPackageError(notFound('/consumer/node_modules/@oa-sdk/mock-server/dist/adapters/node-http.js'), '@oa-sdk/mock-server')).toBe(false)
  })

  it('ignores errors that are not resolution failures', () => {
    expect(isMissingPackageError(new SyntaxError("Cannot find package '@oa-sdk/client'"), '@oa-sdk/client')).toBe(false)
    expect(isMissingPackageError(undefined, '@oa-sdk/client')).toBe(false)
    expect(isMissingPackageError('ERR_MODULE_NOT_FOUND', '@oa-sdk/client')).toBe(false)
  })
})

describe('companion entry points in a published install', () => {
  it('cover every companion package with one entry point', () => {
    expect([...companionLoaderSpecifiers().keys()].sort()).toEqual([...COMPANION_PACKAGES].sort())
  })

  // npm, pnpm and Yarn install an optional peer dependency only when the project asks for it, and
  // neither the install commands oa-gen prints nor `oa-gen init` add one, so every entry point
  // oa-gen loads must load without them.
  it('load without the optional peer dependencies of their package', () => {
    const installDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-companion-optional-peers-'))
    try {
      const leftOut = installWithoutOptionalPeers(installDirectory, COMPANION_PACKAGES)
      // The layout is faithful only if the optional peers left out cannot be resolved from it.
      expect(Object.keys(importInNode(installDirectory, leftOut)).sort()).toEqual([...leftOut].sort())
      expect(importInNode(installDirectory, [...companionLoaderSpecifiers().values()])).toEqual({})
    } finally {
      fs.rmSync(installDirectory, { recursive: true, force: true })
    }
  })
})

describe('CompanionLoader', () => {
  it('loads an installed companion once and reports an absent one as undefined', async () => {
    const importer = vi.fn(importerWithout('@oa-sdk/router')) as unknown as CompanionImporter
    const loader = new CompanionLoader(importer)

    const client = await loader.load('@oa-sdk/client')
    expect(typeof client?.generateClient).toBe('function')
    expect(await loader.load('@oa-sdk/client')).toBe(client)
    expect(await loader.load('@oa-sdk/router')).toBeUndefined()
    expect(await loader.load('@oa-sdk/router')).toBeUndefined()
    expect(importer).toHaveBeenCalledTimes(2)
  })

  it('rethrows load failures of an installed companion', async () => {
    const broken = new Error('router failed to initialise')
    const loader = new CompanionLoader((name) => name === '@oa-sdk/router'
      ? Promise.reject(broken)
      : importCompanion(name))
    await expect(loader.load('@oa-sdk/router')).rejects.toBe(broken)
  })
})

describe('companionInstallCommand', () => {
  it('follows the package manager that launched oa-gen', () => {
    const packages = ['@oa-sdk/router', '@oa-sdk/client', '@oa-sdk/router']
    const unknownVersions = {}
    expect(companionInstallCommand(packages, 'pnpm/10.30.3 npm/? node/v24.19.0 darwin arm64', unknownVersions))
      .toBe('pnpm add -D @oa-sdk/router @oa-sdk/client')
    expect(companionInstallCommand(packages, 'yarn/4.9.1 npm/? node/v24.19.0 linux x64', unknownVersions))
      .toBe('yarn add -D @oa-sdk/router @oa-sdk/client')
    expect(companionInstallCommand(packages, 'bun/1.3.9 npm/? node/v24.3.0 darwin arm64', unknownVersions))
      .toBe('bun add -d @oa-sdk/router @oa-sdk/client')
    expect(companionInstallCommand(packages, 'npm/11.6.2 node/v24.19.0 darwin arm64 workspaces/false', unknownVersions))
      .toBe('npm install --save-dev @oa-sdk/router @oa-sdk/client')
  })

  // An omitted user agent is read from the environment, which the package manager running
  // these tests sets too, so each case sets it explicitly.
  it('reads the launching package manager from the environment and falls back to npm without one', () => {
    const packages = ['@oa-sdk/router']
    try {
      vi.stubEnv('npm_config_user_agent', 'yarn/4.9.1 npm/? node/v24.19.0 linux x64')
      expect(companionInstallCommand(packages, undefined, {})).toBe('yarn add -D @oa-sdk/router')
      vi.stubEnv('npm_config_user_agent', undefined)
      expect(companionInstallCommand(packages, undefined, {})).toBe('npm install --save-dev @oa-sdk/router')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('pins each package with a known version to the range compatible with it', () => {
    const versions = { '@oa-sdk/router': '0.4.2', '@oa-sdk/client': '1.0.0-beta.3' }
    expect(companionInstallCommand(['@oa-sdk/router', '@oa-sdk/client', '@oa-sdk/mock-server'], 'pnpm/10.30.3', versions))
      .toBe('pnpm add -D "@oa-sdk/router@^0.4.2" "@oa-sdk/client@^1.0.0-beta.3" @oa-sdk/mock-server')
  })

  it('pins the companions to the versions this build was built against by default', () => {
    const range = builtAgainstRange('@oa-sdk/client')
    expect(range).toBeDefined()
    expect(companionInstallCommand(['@oa-sdk/client'], 'npm/11.6.2'))
      .toBe(`npm install --save-dev "@oa-sdk/client@${range}"`)
  })
})

describe('what needs which companion', () => {
  it('treats only switches set to true in the configuration as explicit requests', () => {
    expect(explicitCompanionOutputs({})).toEqual([])
    expect(explicitCompanionOutputs({ core: { contracts: { pureHandlers: false }, client: {} } })).toEqual([])
    expect(explicitCompanionOutputs({ core: { contracts: { pureHandlers: true }, client: { enabled: true } } })).toEqual([
      {
        output: 'handler contracts',
        packageName: '@oa-sdk/router',
        configSwitch: 'core.contracts.pureHandlers',
        requestedBy: 'core.contracts.pureHandlers: true',
      },
      {
        output: 'client SDK',
        packageName: '@oa-sdk/client',
        configSwitch: 'core.client.enabled',
        requestedBy: 'core.client.enabled: true',
      },
    ])
  })

  it('names the companion of each single-purpose command and of no other command', () => {
    expect(commandCompanion('mock')).toBe('@oa-sdk/mock-server')
    expect(commandCompanion('generate:client')).toBe('@oa-sdk/client')
    expect(commandCompanion('pack:client')).toBe('@oa-sdk/client')
    expect(commandCompanion('generate:tanstack')).toBe('@oa-sdk/client')
    expect(commandCompanion('generate')).toBeUndefined()
    expect(commandCompanion('validate')).toBeUndefined()
    expect(commandCompanion('toString')).toBeUndefined()
  })
})

describe('commands that cannot run without their companion package', () => {
  let tmpDir: string
  let specPath: string
  let errors: string[]

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-companion-command-'))
    specPath = path.join(tmpDir, 'api.json')
    fs.writeFileSync(specPath, JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Companion Command API', version: '1.0.0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'Items' } } },
        },
      },
    }))
    errors = []
    vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
      errors.push(parts.map(String).join(' '))
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const expectMissingCompanionExit = async (run: Promise<void>, packageName: string, command: string) => {
    const failure = await run.then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(CliExitError)
    expect((failure as CliExitError).exitCode).toBe(1)
    const output = errors.join('\n')
    expect(output).toContain(`[oa-gen ${command}]`)
    expect(output).toContain(`requires ${packageName}`)
    expect(output).toContain(companionInstallCommand([packageName]))
  }

  it('oa-gen mock exits with the install command instead of starting a server', async () => {
    const onServerReady = vi.fn()
    const context: MockCommandContext = {
      cwd: tmpDir,
      projectRoot: tmpDir,
      importCompanion: importerWithout('@oa-sdk/mock-server'),
      onServerReady,
    }
    await expectMissingCompanionExit(mock.run({ spec: specPath, port: '0' }, context), '@oa-sdk/mock-server', 'mock')
    expect(onServerReady).not.toHaveBeenCalled()
  })

  const withoutClient = (): CompanionCommandContext => ({
    cwd: tmpDir,
    projectRoot: tmpDir,
    importCompanion: importerWithout('@oa-sdk/client'),
  })

  it('oa-gen generate:client exits with the install command and writes nothing', async () => {
    const outputPath = path.join(tmpDir, 'client.ts')
    await expectMissingCompanionExit(
      generateClientCommand.run({ spec: specPath, output: outputPath }, withoutClient()),
      '@oa-sdk/client',
      'generate:client',
    )
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('oa-gen pack:client exits with the install command and builds no package', async () => {
    const outDir = path.join(tmpDir, 'api-client')
    await expectMissingCompanionExit(
      packClientCommand.run({ spec: specPath, output: outDir }, withoutClient()),
      '@oa-sdk/client',
      'pack:client',
    )
    expect(fs.existsSync(outDir)).toBe(false)
  })

  it('oa-gen generate:tanstack and its deprecated generate --tanstack alias exit with the install command', async () => {
    const context = withoutClient()
    await expectMissingCompanionExit(
      generateTanstackCommand.run({ spec: specPath, output: path.join(tmpDir, 'queries') }, context),
      '@oa-sdk/client',
      'generate:tanstack',
    )
    errors.length = 0
    await expectMissingCompanionExit(
      generate.run({ tanstack: true, spec: specPath, output: path.join(tmpDir, 'queries') }, context),
      '@oa-sdk/client',
      'generate:tanstack',
    )
    expect(fs.existsSync(path.join(tmpDir, 'queries'))).toBe(false)
  })

  it('requireCompanion returns the module of the command\'s companion when it is installed', async () => {
    for (const command of Object.keys(COMMAND_COMPANIONS) as CompanionCommand[]) {
      const loaded = await requireCompanion(command, { output: 'the output' })
      expect(loaded, command).toBe(await importCompanion(COMMAND_COMPANIONS[command]))
    }
    expect(errors).toEqual([])
  })
})
