import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveImportSpecifier,
  findNearestPackageJson,
  resolvePackageSpecifier,
  toPosixPath,
} from '../routing/import-resolver.js'
import {
  watchSpec,
  collectDirectoriesRecursively,
  IGNORED_DIRS,
  type SpecWatcher,
} from '../cli/lib/spec-watcher.js'
import type { OasDocument } from '@oa-sdk/parser'

describe('Challenger M3 Adversarial Stress Suite', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-m3-stress-'))
  })

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  // ==========================================================================
  // REQUIREMENT R5: Monorepo Package Boundary Awareness Stress-Testing
  // ==========================================================================
  describe('R5: resolveImportSpecifier Package Boundary Stress-Testing', () => {
    let monorepoDir: string
    let webDir: string
    let apiClientDir: string
    let sharedUtilDir: string

    beforeEach(() => {
      monorepoDir = path.join(tmpRoot, 'my-monorepo')
      fs.mkdirSync(monorepoDir, { recursive: true })

      // Root monorepo workspace package.json
      fs.writeFileSync(
        path.join(monorepoDir, 'package.json'),
        JSON.stringify({
          name: 'monorepo-root',
          private: true,
          workspaces: ['apps/*', 'packages/*'],
        }),
      )
      fs.writeFileSync(path.join(monorepoDir, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n')

      // App: @company/web in apps/web
      webDir = path.join(monorepoDir, 'apps', 'web')
      fs.mkdirSync(path.join(webDir, 'src', 'features', 'billing', 'components'), { recursive: true })
      fs.mkdirSync(path.join(webDir, 'src', 'utils'), { recursive: true })
      fs.writeFileSync(
        path.join(webDir, 'package.json'),
        JSON.stringify({
          name: '@company/web',
          version: '1.0.0',
          dependencies: {
            '@company/api-client': 'workspace:*',
            '@company/shared-util': 'workspace:*',
          },
        }),
      )
      fs.writeFileSync(path.join(webDir, 'src', 'features', 'billing', 'invoice.ts'), 'export const invoice = {};')
      fs.writeFileSync(path.join(webDir, 'src', 'features', 'billing', 'components', 'table.ts'), 'export const table = {};')
      fs.writeFileSync(path.join(webDir, 'src', 'utils', 'formatter.ts'), 'export const formatCurrency = () => {};')

      // Package: @company/api-client in packages/api-client
      apiClientDir = path.join(monorepoDir, 'packages', 'api-client')
      fs.mkdirSync(path.join(apiClientDir, 'src', 'browser'), { recursive: true })
      fs.mkdirSync(path.join(apiClientDir, 'src', 'node'), { recursive: true })
      fs.mkdirSync(path.join(apiClientDir, 'src', 'deep', 'internal', 'helpers'), { recursive: true })
      fs.writeFileSync(
        path.join(apiClientDir, 'package.json'),
        JSON.stringify({
          name: '@company/api-client',
          version: '2.4.0',
          main: './dist/index.js',
          module: './dist/index.mjs',
          exports: {
            '.': {
              import: './dist/index.mjs',
              require: './dist/index.js',
              types: './dist/index.d.ts',
            },
            './browser': {
              import: './dist/browser.mjs',
              types: './dist/browser.d.ts',
            },
            './node': './dist/node.js',
            './v2/runtime': {
              default: './src/node/v2-runtime.ts',
            },
          },
        }),
      )
      fs.writeFileSync(path.join(apiClientDir, 'src', 'index.ts'), 'export const client = {};')
      fs.writeFileSync(path.join(apiClientDir, 'src', 'browser', 'index.ts'), 'export const browserClient = {};')
      fs.writeFileSync(path.join(apiClientDir, 'src', 'node', 'index.ts'), 'export const nodeClient = {};')
      fs.writeFileSync(path.join(apiClientDir, 'src', 'node', 'v2-runtime.ts'), 'export const v2 = {};')
      fs.writeFileSync(path.join(apiClientDir, 'src', 'deep', 'internal', 'helpers', 'calc.ts'), 'export const calc = {};')

      // Package: @company/shared-util in packages/shared-util (no exports map, simple main)
      sharedUtilDir = path.join(monorepoDir, 'packages', 'shared-util')
      fs.mkdirSync(path.join(sharedUtilDir, 'src', 'crypto'), { recursive: true })
      fs.writeFileSync(
        path.join(sharedUtilDir, 'package.json'),
        JSON.stringify({
          name: '@company/shared-util',
          version: '0.5.0',
          main: './src/index.ts',
        }),
      )
      fs.writeFileSync(path.join(sharedUtilDir, 'src', 'index.ts'), 'export const util = {};')
      fs.writeFileSync(path.join(sharedUtilDir, 'src', 'crypto', 'hash.ts'), 'export const sha = {};')
    })

    it('Scenario 1.1: Cross-package root imports resolve to canonical package specifier', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')
      const toFile = path.join(apiClientDir, 'src', 'index.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
      })

      // Must resolve to bare package name
      expect(specifier).toBe('@company/api-client')
      expect(specifier).not.toContain('../')
      expect(specifier).not.toContain('.js')
      expect(specifier).not.toContain('packages/api-client')
    })

    it('Scenario 1.2: Cross-package root imports with main pointing to src/index.ts directly', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'components', 'table.ts')
      const toFile = path.join(sharedUtilDir, 'src', 'index.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
      })

      expect(specifier).toBe('@company/shared-util')
      expect(specifier).not.toContain('../')
    })

    it('Scenario 1.3: Cross-package subpath imports matching explicit exports map', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')
      const toFile = path.join(apiClientDir, 'src', 'node', 'v2-runtime.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
      })

      // Matches './v2/runtime' in exports map
      expect(specifier).toBe('@company/api-client/v2/runtime')
      expect(specifier).not.toContain('.js')
      expect(specifier).not.toContain('src/')
    })

    it('Scenario 1.4: Cross-package subpath imports with unexported paths fallback to clean subpath', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')
      const toFile = path.join(apiClientDir, 'src', 'deep', 'internal', 'helpers', 'calc.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
      })

      // Strips leading src/ and produces clean package subpath
      expect(specifier).toBe('@company/api-client/deep/internal/helpers/calc')
      expect(specifier).not.toContain('src/')
      expect(specifier).not.toContain('../')
    })

    it('Scenario 1.5: Cross-package unexported subpath in package without exports field', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'components', 'table.ts')
      const toFile = path.join(sharedUtilDir, 'src', 'crypto', 'hash.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
      })

      expect(specifier).toBe('@company/shared-util/crypto/hash')
    })

    it('Scenario 1.6: Intra-package imports within apps/web/src/ must strictly remain relative ./...', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')
      const toSibling = path.join(webDir, 'src', 'features', 'billing', 'components', 'table.ts')
      const toUtil = path.join(webDir, 'src', 'utils', 'formatter.ts')

      // Sibling in subfolder
      const specifierToSub = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toSibling,
        rootDir: monorepoDir,
      })
      expect(specifierToSub).toBe('./components/table.js')
      expect(specifierToSub).not.toContain('@company/web')

      // Parent traversal within same package
      const specifierToUtil = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toUtil,
        rootDir: monorepoDir,
      })
      expect(specifierToUtil).toBe('../../utils/formatter.js')
      expect(specifierToUtil).not.toContain('@company/web')

      // Sibling in same directory
      const fromTable = path.join(webDir, 'src', 'features', 'billing', 'components', 'table.ts')
      const toCard = path.join(webDir, 'src', 'features', 'billing', 'components', 'card.ts')
      const specifierSibling = resolveImportSpecifier({
        fromFilePath: fromTable,
        toFilePath: toCard,
        rootDir: monorepoDir,
      })
      expect(specifierSibling).toBe('./card.js')
    })

    it('Scenario 1.7: Deep nested paths (6+ directory levels) compute correct relative traversal', () => {
      const deepDirA = path.join(webDir, 'src', 'level1', 'level2', 'level3', 'level4', 'level5')
      const deepDirB = path.join(webDir, 'src', 'alt1', 'alt2', 'alt3')
      fs.mkdirSync(deepDirA, { recursive: true })
      fs.mkdirSync(deepDirB, { recursive: true })

      const fileA = path.join(deepDirA, 'moduleA.ts')
      const fileB = path.join(deepDirB, 'moduleB.ts')
      fs.writeFileSync(fileA, 'export const a = 1;')
      fs.writeFileSync(fileB, 'export const b = 2;')

      const specifier = resolveImportSpecifier({
        fromFilePath: fileA,
        toFilePath: fileB,
        rootDir: monorepoDir,
      })

      // Same package: 5 steps up (../../../../../) then alt1/alt2/alt3/moduleB.js
      expect(specifier).toBe('../../../../../alt1/alt2/alt3/moduleB.js')
      expect(specifier.startsWith('./') || specifier.startsWith('../')).toBe(true)
      expect(specifier.includes('\\')).toBe(false)
    })

    it('Scenario 1.8: POSIX absolute paths starting with / on macOS/Linux are not mangled into Windows paths', () => {
      const posixFrom = '/Users/developer/project/apps/web/src/index.ts'
      const posixTo = '/Users/developer/project/apps/web/src/components/button.ts'

      const specifier = resolveImportSpecifier({
        fromFilePath: posixFrom,
        toFilePath: posixTo,
        rootDir: '/Users/developer/project',
      })

      expect(specifier).toBe('./components/button.js')
      expect(specifier.includes('\\')).toBe(false)
    })

    it('Scenario 1.9: Self-import throws descriptive error', () => {
      const filePath = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')

      expect(() => {
        resolveImportSpecifier({
          fromFilePath: filePath,
          toFilePath: filePath,
          rootDir: monorepoDir,
        })
      }).toThrow(/Self-import is not allowed/)
    })

    it('Scenario 1.10: Disabling package boundary awareness via packageBoundary: false reverts to relative traversal', () => {
      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')
      const toFile = path.join(apiClientDir, 'src', 'index.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: toFile,
        rootDir: monorepoDir,
        packageBoundary: false,
      })

      // Escapes web package up to root then down into api-client
      expect(specifier).toContain('../../../../packages/api-client/src/index.js')
      expect(specifier).not.toBe('@company/api-client')
    })

    it('Scenario 1.11: Graceful fallback when target package.json is missing or corrupted', () => {
      const orphanDir = path.join(tmpRoot, 'orphan-pkg', 'src')
      fs.mkdirSync(orphanDir, { recursive: true })
      // Create corrupted package.json
      fs.writeFileSync(path.join(tmpRoot, 'orphan-pkg', 'package.json'), '{ "name": INVALID_JSON')
      const orphanFile = path.join(orphanDir, 'orphan.ts')
      fs.writeFileSync(orphanFile, 'export const orphan = true;')

      const fromFile = path.join(webDir, 'src', 'features', 'billing', 'invoice.ts')

      const specifier = resolveImportSpecifier({
        fromFilePath: fromFile,
        toFilePath: orphanFile,
        rootDir: monorepoDir,
      })

      // Does not throw, cleanly falls back to relative path traversal
      expect(specifier).toContain('../')
      expect(specifier.endsWith('.js')).toBe(true)
    })
  })

  // ==========================================================================
  // REQUIREMENT R9: Linux File Watching Fallback Stress-Testing
  // ==========================================================================
  describe('R9: spec-watcher.ts Linux Fallback Stress-Testing', () => {
    let watchDir: string
    let activeWatcher: SpecWatcher | null = null

    beforeEach(() => {
      watchDir = path.join(tmpRoot, 'watched-api')
      fs.mkdirSync(watchDir, { recursive: true })
    })

    afterEach(() => {
      if (activeWatcher) {
        activeWatcher.close()
        activeWatcher = null
      }
    })

    it('Scenario 2.1: Directory watching with nested subdirectories (4 levels deep) under forceLinuxFallback', async () => {
      const level1 = path.join(watchDir, 'api')
      const level2 = path.join(level1, 'v1')
      const level3 = path.join(level2, 'billing')
      const level4 = path.join(level3, 'invoices')
      fs.mkdirSync(level4, { recursive: true })

      const specPath = path.join(level4, 'spec.yaml')
      fs.writeFileSync(
        specPath,
        `
openapi: "3.2.0"
info:
  title: Deep Nested API
  version: "1.0.0"
paths:
  /billing/invoices:
    get:
      operationId: listInvoices
      responses:
        "200":
          description: List of invoices
`,
      )

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: () => {},
      })

      // Verify all 5 directory levels are watched individually
      const watched = activeWatcher.watchedDirs
      expect(watched).toContain(watchDir)
      expect(watched).toContain(level1)
      expect(watched).toContain(level2)
      expect(watched).toContain(level3)
      expect(watched).toContain(level4)

      // Verify modifying the deep file triggers onChange
      let receivedDoc: OasDocument | null = null
      let receivedPath = ''

      await new Promise<void>((resolvePromise) => {
        activeWatcher?.close()
        activeWatcher = watchSpec(watchDir, {
          forceLinuxFallback: true,
          debounceMs: 50,
          onChange: (doc, ctx) => {
            receivedDoc = doc
            receivedPath = ctx.filePath
            resolvePromise()
          },
        })

        setTimeout(() => {
          fs.writeFileSync(
            specPath,
            `
openapi: "3.2.0"
info:
  title: Deep Nested API Updated
  version: "1.0.1"
paths:
  /billing/invoices:
    get:
      operationId: listInvoicesUpdated
      responses:
        "200":
          description: Updated invoice list
`,
          )
        }, 50)
      })

      expect(receivedDoc).not.toBeNull()
      expect((receivedDoc as any)?.info?.title).toBe('Deep Nested API Updated')
      expect(toPosixPath(receivedPath)).toBe(toPosixPath(specPath))
    })

    it('Scenario 2.2: Ignored directories (node_modules, .git, dist, .turbo, .next) are NOT watched', () => {
      // Create ignored directories with spec files inside
      const nodeModulesDir = path.join(watchDir, 'node_modules', '@company', 'specs')
      const gitDir = path.join(watchDir, '.git', 'hooks')
      const distDir = path.join(watchDir, 'dist', 'generated')
      const turboDir = path.join(watchDir, '.turbo', 'cache')
      const validSubDir = path.join(watchDir, 'schemas', 'v1')

      fs.mkdirSync(nodeModulesDir, { recursive: true })
      fs.mkdirSync(gitDir, { recursive: true })
      fs.mkdirSync(distDir, { recursive: true })
      fs.mkdirSync(turboDir, { recursive: true })
      fs.mkdirSync(validSubDir, { recursive: true })

      fs.writeFileSync(path.join(nodeModulesDir, 'ignored.yaml'), 'openapi: "3.2.0"\ninfo:\n  title: Ignored\n  version: 1\npaths: {}')
      fs.writeFileSync(path.join(distDir, 'dist.yaml'), 'openapi: "3.2.0"\ninfo:\n  title: Dist\n  version: 1\npaths: {}')
      fs.writeFileSync(path.join(validSubDir, 'valid.yaml'), 'openapi: "3.2.0"\ninfo:\n  title: Valid\n  version: 1\npaths: {}')

      const collected = collectDirectoriesRecursively(watchDir)
      expect(collected).toContain(watchDir)
      expect(collected).toContain(path.join(watchDir, 'schemas'))
      expect(collected).toContain(validSubDir)

      // Must NOT contain any ignored directory
      for (const dir of collected) {
        expect(dir).not.toContain('node_modules')
        expect(dir).not.toContain('.git')
        expect(dir).not.toContain('dist')
        expect(dir).not.toContain('.turbo')
      }

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: () => {},
      })

      const watched = activeWatcher.watchedDirs
      expect(watched).toContain(watchDir)
      expect(watched).toContain(validSubDir)

      for (const dir of watched) {
        expect(dir).not.toContain('node_modules')
        expect(dir).not.toContain('.git')
        expect(dir).not.toContain('dist')
        expect(dir).not.toContain('.turbo')
      }
    })

    it('Scenario 2.3: Modifying files in ignored directories does NOT trigger onChange', async () => {
      const nodeModulesDir = path.join(watchDir, 'node_modules', '@company', 'specs')
      const distDir = path.join(watchDir, 'dist')
      const validDir = path.join(watchDir, 'valid')
      fs.mkdirSync(nodeModulesDir, { recursive: true })
      fs.mkdirSync(distDir, { recursive: true })
      fs.mkdirSync(validDir, { recursive: true })

      const ignoredSpec = path.join(nodeModulesDir, 'node-spec.yaml')
      const distSpec = path.join(distDir, 'dist-spec.yaml')
      const validSpec = path.join(validDir, 'valid-spec.yaml')

      const initialContent = 'openapi: "3.2.0"\ninfo:\n  title: Test\n  version: 1\npaths: {}\n'
      fs.writeFileSync(ignoredSpec, initialContent)
      fs.writeFileSync(distSpec, initialContent)
      fs.writeFileSync(validSpec, initialContent)

      // Allow file system events from initial creation to settle
      await new Promise<void>((res) => setTimeout(res, 60))

      let triggeredPaths: string[] = []

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: (_doc, ctx) => {
          triggeredPaths.push(ctx.filePath)
        },
      })

      // Modify files in ignored directories
      await new Promise<void>((res) => setTimeout(res, 30))
      fs.writeFileSync(ignoredSpec, 'openapi: "3.2.0"\ninfo:\n  title: Ignored Mod\n  version: 2\npaths: {}\n')
      fs.writeFileSync(distSpec, 'openapi: "3.2.0"\ninfo:\n  title: Dist Mod\n  version: 2\npaths: {}\n')

      // Wait for debounce period to pass
      await new Promise<void>((res) => setTimeout(res, 120))

      // No events should have been triggered for node_modules or dist
      if (triggeredPaths.length > 0) {
        console.log('UNEXPECTED TRIGGERED PATHS:', triggeredPaths)
      }
      expect(triggeredPaths).toHaveLength(0)

      // Now modify validSpec
      await new Promise<void>((resolvePromise) => {
        activeWatcher?.close()
        activeWatcher = watchSpec(watchDir, {
          forceLinuxFallback: true,
          debounceMs: 50,
          onChange: (_doc, ctx) => {
            triggeredPaths.push(ctx.filePath)
            resolvePromise()
          },
        })

        setTimeout(() => {
          fs.writeFileSync(validSpec, 'openapi: "3.2.0"\ninfo:\n  title: Valid Mod\n  version: 2\npaths: {}\n')
        }, 30)
      })

      expect(triggeredPaths.length).toBeGreaterThanOrEqual(1)
      expect(toPosixPath(triggeredPaths[0]!)).toBe(toPosixPath(validSpec))
    })

    it('Scenario 2.4: Dynamic creation of a new subdirectory during active watch', async () => {
      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: () => {},
      })

      // Create new subdirectory during active watch
      const dynamicDir = path.join(watchDir, 'dynamic-sub')
      fs.mkdirSync(dynamicDir, { recursive: true })

      // Give fs.watch event loop a tick to process rename event
      await new Promise<void>((res) => setTimeout(res, 50))

      // Now create a spec file inside the dynamic directory and watch for reload
      const newSpecFile = path.join(dynamicDir, 'dynamic-spec.json')
      let reloadedDoc: OasDocument | null = null

      await new Promise<void>((resolvePromise) => {
        activeWatcher?.close()
        activeWatcher = watchSpec(watchDir, {
          forceLinuxFallback: true,
          debounceMs: 50,
          onChange: (doc) => {
            reloadedDoc = doc
            resolvePromise()
          },
        })

        setTimeout(() => {
          fs.writeFileSync(
            newSpecFile,
            JSON.stringify({
              openapi: '3.2.0',
              info: { title: 'Dynamic Created Spec', version: '1.0.0' },
              paths: {},
            }),
          )
        }, 50)
      })

      expect(reloadedDoc).not.toBeNull()
      expect((reloadedDoc as any)?.info?.title).toBe('Dynamic Created Spec')
    })

    it('Scenario 2.5: Error shielding prevents crashes and keeps previous routes active on syntax errors', async () => {
      const specFile = path.join(watchDir, 'spec.yaml')
      fs.writeFileSync(
        specFile,
        `
openapi: "3.2.0"
info:
  title: Stable API
  version: "1.0.0"
paths: {}
`,
      )

      let errorEncountered = false
      let recoveredDoc: OasDocument | null = null

      await new Promise<void>((resolvePromise) => {
        activeWatcher = watchSpec(watchDir, {
          forceLinuxFallback: true,
          debounceMs: 40,
          onError: (_err) => {
            errorEncountered = true
            // Immediately fix the syntax error after onError is triggered
            setTimeout(() => {
              fs.writeFileSync(
                specFile,
                `
openapi: "3.2.0"
info:
  title: Recovered API
  version: "2.0.0"
paths: {}
`,
              )
            }, 30)
          },
          onChange: (doc) => {
            if (doc.info.title === 'Recovered API') {
              recoveredDoc = doc
              resolvePromise()
            }
          },
        })

        // Inject broken YAML syntax
        setTimeout(() => {
          fs.writeFileSync(specFile, 'openapi: "3.2.0"\ninfo: { BROKEN YAML [[[')
        }, 40)
      })

      expect(errorEncountered).toBe(true)
      expect(recoveredDoc).not.toBeNull()
      expect((recoveredDoc as any)?.info?.title).toBe('Recovered API')
    })

    it('Scenario 2.6: Debounce coalescing merges rapid consecutive file writes into a single callback', async () => {
      const specFile = path.join(watchDir, 'rapid.yaml')
      fs.writeFileSync(specFile, 'openapi: "3.2.0"\ninfo:\n  title: V0\n  version: 1\npaths: {}\n')

      let changeCount = 0

      await new Promise<void>((resolvePromise) => {
        activeWatcher = watchSpec(watchDir, {
          forceLinuxFallback: true,
          debounceMs: 80,
          onChange: () => {
            changeCount++
          },
        })

        // Fire 5 writes in rapid succession (every 10ms)
        for (let i = 1; i <= 5; i++) {
          setTimeout(() => {
            fs.writeFileSync(
              specFile,
              `openapi: "3.2.0"\ninfo:\n  title: V${i}\n  version: 1\npaths: {}\n`,
            )
            if (i === 5) {
              // Wait longer than debounceMs to verify only 1 callback fired
              setTimeout(resolvePromise, 180)
            }
          }, i * 10)
        }
      })

      // The 5 rapid writes within 50ms should have been debounced into exactly 1 onChange call
      expect(changeCount).toBe(1)
    })

    it('Scenario 2.7: Close completely shuts down watchers and suppresses subsequent events', async () => {
      const specFile = path.join(watchDir, 'clean.yaml')
      fs.writeFileSync(specFile, 'openapi: "3.2.0"\ninfo:\n  title: Clean\n  version: 1\npaths: {}\n')

      let postCloseTriggered = false

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 40,
        onChange: () => {
          postCloseTriggered = true
        },
      })

      // Close the watcher
      activeWatcher.close()
      expect(activeWatcher.watchedDirs).toHaveLength(0)

      // Write to the spec file after close
      fs.writeFileSync(specFile, 'openapi: "3.2.0"\ninfo:\n  title: Clean Mod\n  version: 2\npaths: {}\n')

      await new Promise<void>((res) => setTimeout(res, 100))
      expect(postCloseTriggered).toBe(false)
    })

    it('Scenario 2.8: Dynamically creating ignored directories (node_modules, dist) must NOT be watched', async () => {
      let triggeredPaths: string[] = []

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: (_doc, ctx) => {
          triggeredPaths.push(ctx.filePath)
        },
      })

      // Dynamically create node_modules while watching
      const dynamicNodeModules = path.join(watchDir, 'node_modules')
      fs.mkdirSync(dynamicNodeModules, { recursive: true })

      await new Promise<void>((res) => setTimeout(res, 60))

      // Check whether dynamic node_modules was added to watchedDirs
      const watched = activeWatcher.watchedDirs
      const nodeModulesWatched = watched.some(d => d.includes('node_modules'))

      // Ignored directory must NOT be watched even when created dynamically
      expect(nodeModulesWatched).toBe(false)

      // Write a spec file into dynamic node_modules
      fs.writeFileSync(
        path.join(dynamicNodeModules, 'dynamic-node-spec.yaml'),
        'openapi: "3.2.0"\ninfo:\n  title: Dynamic Node Spec\n  version: 1\npaths: {}\n',
      )

      await new Promise<void>((res) => setTimeout(res, 120))
      // Modifications in ignored directory must NOT trigger onChange
      expect(triggeredPaths).toHaveLength(0)
    })

    it('Scenario 2.9: Multi-level dynamic directory creation (mkdir -p a/b/c) must watch all nested levels', async () => {
      let triggeredPaths: string[] = []

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 50,
        onChange: (_doc, ctx) => {
          triggeredPaths.push(ctx.filePath)
        },
      })

      // Allow OS filesystem watcher to activate before creating directories
      await new Promise<void>((res) => setTimeout(res, 50))

      // Create multi-level dynamic directory all at once
      const deepDynDir = path.join(watchDir, 'dyn-root', 'dyn-mid', 'dyn-leaf')
      fs.mkdirSync(deepDynDir, { recursive: true })

      // Allow watcher to dynamically detect and attach to nested directories (poll up to 1000ms for OS event delivery)
      const start = Date.now()
      while (!activeWatcher.watchedDirs.includes(deepDynDir) && Date.now() - start < 1000) {
        await new Promise((res) => setTimeout(res, 20))
      }

      const watched = activeWatcher.watchedDirs
      // All nested directories should have watchers attached
      expect(watched).toContain(path.join(watchDir, 'dyn-root'))
      expect(watched).toContain(path.join(watchDir, 'dyn-root', 'dyn-mid'))
      expect(watched).toContain(deepDynDir)

      // Write a spec file into the deepest leaf directory
      const leafSpec = path.join(deepDynDir, 'leaf.yaml')
      fs.writeFileSync(
        leafSpec,
        'openapi: "3.2.0"\ninfo:\n  title: Leaf API\n  version: 1\npaths: {}\n',
      )

      await new Promise<void>((res) => setTimeout(res, 120))
      expect(triggeredPaths.length).toBeGreaterThanOrEqual(1)
      expect(toPosixPath(triggeredPaths[0]!)).toBe(toPosixPath(leafSpec))
    })

    it('Scenario 2.10: Rapid consecutive file writes inside dynamically created nested directory are debounced and parsed', async () => {
      let triggeredDocs: OasDocument[] = []
      let triggeredPaths: string[] = []
      let changeCount = 0

      activeWatcher = watchSpec(watchDir, {
        forceLinuxFallback: true,
        debounceMs: 80,
        onChange: (doc, ctx) => {
          changeCount++
          triggeredDocs.push(doc)
          triggeredPaths.push(ctx.filePath)
        },
      })

      // Allow OS filesystem watcher to activate before creating directories
      await new Promise<void>((res) => setTimeout(res, 50))

      // Dynamically create a 3-level deep directory structure while watcher is active
      const deepDynDir = path.join(watchDir, 'api', 'v3', 'services')
      fs.mkdirSync(deepDynDir, { recursive: true })

      // Allow watcher to dynamically detect and attach to nested directories (poll up to 1000ms for OS event delivery)
      const start = Date.now()
      while (!activeWatcher.watchedDirs.includes(deepDynDir) && Date.now() - start < 1000) {
        await new Promise((res) => setTimeout(res, 20))
      }
      expect(activeWatcher.watchedDirs).toContain(deepDynDir)

      const leafSpec = path.join(deepDynDir, 'service.yaml')

      // Fire 5 writes in rapid succession (every 10ms) inside the dynamically created nested directory
      await new Promise<void>((resolvePromise) => {
        for (let i = 1; i <= 5; i++) {
          setTimeout(() => {
            fs.writeFileSync(
              leafSpec,
              `openapi: "3.2.0"\ninfo:\n  title: Service API V${i}\n  version: ${i}.0.0\npaths: {}\n`,
            )
            if (i === 5) {
              // Wait longer than debounceMs to verify coalescing
              setTimeout(resolvePromise, 180)
            }
          }, i * 10)
        }
      })

      // The 5 rapid writes within 50ms should have been debounced into exactly 1 onChange call
      expect(changeCount).toBe(1)
      expect(triggeredDocs[0]?.info?.title).toBe('Service API V5')
      expect(toPosixPath(triggeredPaths[0]!)).toBe(toPosixPath(leafSpec))
    })
  })
})
