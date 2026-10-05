/**
 * The published @oa-sdk/tools build must not carry copies of other packages.
 *
 * tsup bundles every import it does not treat as external, and it treats only
 * `dependencies`, `peerDependencies` and `optionalDependencies` as external by
 * default. The release policy lets this Core Platform package reference
 * Downstream packages such as `@oa-sdk/chunk-stream-ui` and
 * `@oa-sdk/peer-transport` only through `devDependencies`, so such a package
 * stays out of the build only when the build script names it with
 * `--external`; otherwise dist ships a private copy of it, even of a package
 * that has never been published.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

interface Manifest {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface RuntimeImport {
  file: string
  specifier: string
  packageName: string
  dynamic: boolean
}

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const sourceDirectory = join(packageDirectory, 'src')
const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as Manifest

/** Scripts that run tsup on the published entry point. */
const BUNDLING_SCRIPTS = ['build', 'dev'] as const
const RUNTIME_SECTIONS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx|mts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : []
  })
}

/** Package a bare specifier resolves to: `@scope/name` or `name`, without a subpath. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/')
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || builtinModules.includes(packageNameOf(specifier))
}

/** True when an import or re-export leaves nothing in the emitted JavaScript. */
function isTypeOnly(clause: ts.ImportClause | ts.NamedExportBindings | undefined, declarationIsTypeOnly: boolean): boolean {
  if (declarationIsTypeOnly) return true
  if (clause === undefined) return false
  if (ts.isImportClause(clause)) {
    if (clause.isTypeOnly) return true
    if (clause.name !== undefined) return false
    const bindings = clause.namedBindings
    return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0
      && bindings.elements.every((element) => element.isTypeOnly)
  }
  return ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly)
}

/** Bare, non-builtin modules the emitted JavaScript of `file` loads, statically or with `import()`. */
function runtimeImports(file: string): RuntimeImport[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: RuntimeImport[] = []
  const record = (specifier: string, dynamic: boolean): void => {
    if (!isBareSpecifier(specifier) || isBuiltin(specifier)) return
    found.push({ file: relative(packageDirectory, file), specifier, packageName: packageNameOf(specifier), dynamic })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnly(node.importClause, false)) record(node.moduleSpecifier.text, false)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!isTypeOnly(node.exportClause, node.isTypeOnly)) record(node.moduleSpecifier.text, false)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument !== undefined && ts.isStringLiteralLike(argument)) record(argument.text, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Packages a tsup command line marks with `--external <name>` or `--external=<name>`. */
function commandLineExternals(script: string): Set<string> {
  return new Set([...script.matchAll(/--external(?:=|\s+)(\S+)/g)].map((match) => match[1]!))
}

const imports = sourceFiles(sourceDirectory).flatMap(runtimeImports)
const declaredRuntime = new Set(RUNTIME_SECTIONS.flatMap((section) => Object.keys(manifest[section] ?? {})))

describe('@oa-sdk/tools package boundary', () => {
  it('finds the runtime imports of the source tree', () => {
    expect(imports.map((entry) => entry.packageName)).toEqual(expect.arrayContaining(['hono', 'ajv']))
  })

  for (const scriptName of BUNDLING_SCRIPTS) {
    it(`keeps every package the source loads out of the bundle built by the "${scriptName}" script`, () => {
      const script = manifest.scripts?.[scriptName]
      expect(script, `scripts.${scriptName}`).toMatch(/\btsup\b/)
      const externals = commandLineExternals(script!)
      const bundled = imports
        .filter((entry) => !declaredRuntime.has(entry.packageName) && !externals.has(entry.packageName))
        .map((entry) => `${entry.file} imports ${entry.specifier}`)
      expect(bundled, 'packages tsup would copy into dist').toEqual([])
    })
  }

  it('loads packages it does not depend on only with import(), so a missing one fails only that path', () => {
    const undeclared = imports.filter((entry) => !declaredRuntime.has(entry.packageName))
    expect(undeclared.map((entry) => entry.packageName)).toEqual(
      expect.arrayContaining(['@oa-sdk/chunk-stream-ui', '@oa-sdk/peer-transport']),
    )
    const staticImports = undeclared
      .filter((entry) => !entry.dynamic)
      .map((entry) => `${entry.file} statically imports ${entry.specifier}`)
    expect(staticImports).toEqual([])
    for (const { packageName } of undeclared) {
      expect(manifest.devDependencies?.[packageName], `devDependencies.${packageName}`).toMatch(/^workspace:/)
    }
  })
})
