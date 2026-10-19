/**
 * Type-checks generated plugin output the way a consumer project would compile it.
 *
 * The files are written to a temporary ESM package (`"type": "module"`) and compiled with the
 * TypeScript compiler API under strict NodeNext settings. Third-party imports of the generated
 * code (`@tanstack/react-query`, `hono`, ...) resolve to the copies installed in the workspace's
 * pnpm store through `node_modules` symlinks; `@oa-sdk/client` resolves to its source entry, so
 * the check does not depend on a built `dist`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const helperDir = dirname(fileURLToPath(import.meta.url))

function findWorkspaceRoot(start: string): string {
  let dir = start
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`pnpm-workspace.yaml not found above ${start}`)
    dir = parent
  }
  return dir
}

export const workspaceRoot = findWorkspaceRoot(helperDir)

function compareVersions(left: string, right: string): number {
  const a = left.split(/[.+_-]/).map(part => Number.parseInt(part, 10) || 0)
  const b = right.split(/[.+_-]/).map(part => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Locates an installed package directory in the workspace: a direct `node_modules` entry, or
 * the highest version in the pnpm virtual store.
 */
export function resolveWorkspacePackageDir(packageName: string): string {
  const direct = join(workspaceRoot, 'node_modules', packageName)
  if (existsSync(join(direct, 'package.json'))) return direct

  const storeDir = join(workspaceRoot, 'node_modules', '.pnpm')
  const prefix = `${packageName.replace('/', '+')}@`
  const candidates = existsSync(storeDir)
    ? readdirSync(storeDir).filter(entry => entry.startsWith(prefix))
    : []
  candidates.sort((left, right) => compareVersions(right.slice(prefix.length), left.slice(prefix.length)))
  for (const entry of candidates) {
    const packageDir = join(storeDir, entry, 'node_modules', packageName)
    if (existsSync(join(packageDir, 'package.json'))) return packageDir
  }
  throw new Error(`Package "${packageName}" is not installed in the workspace (looked in ${storeDir})`)
}

export interface TypecheckGeneratedOptions {
  /** Generated (and consumer) files keyed by POSIX path relative to the package root */
  files: Readonly<Record<string, string>>
  /** Third-party packages the files import, linked into the temporary package's node_modules */
  packages?: readonly string[] | undefined
  /** Compiler options merged over the strict defaults */
  compilerOptions?: ts.CompilerOptions | undefined
}

/**
 * Writes the files to a temporary ESM package, compiles them under strict NodeNext settings and passes
 * the program, with the absolute path of every compiled file keyed by its `files` path, to `inspect`.
 */
function withGeneratedProgram<T>(
  options: TypecheckGeneratedOptions,
  inspect: (program: ts.Program, rootFiles: ReadonlyMap<string, string>, directory: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), 'oa-sdk-generated-typecheck-'))
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'generated-typecheck', type: 'module' }))
    for (const packageName of options.packages ?? []) {
      const linkPath = join(directory, 'node_modules', packageName)
      mkdirSync(dirname(linkPath), { recursive: true })
      symlinkSync(resolveWorkspacePackageDir(packageName), linkPath, 'junction')
    }

    const rootFiles = new Map<string, string>()
    for (const [relativePath, content] of Object.entries(options.files)) {
      const filePath = join(directory, relativePath)
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
      if (/\.[cm]?tsx?$/.test(relativePath)) rootFiles.set(relativePath, filePath)
    }

    const program = ts.createProgram([...rootFiles.values()], {
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: [],
      paths: { '@oa-sdk/client': [resolve(workspaceRoot, 'packages/client/src/index.ts')] },
      ...options.compilerOptions,
    })
    return inspect(program, rootFiles, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Compiles the given files and returns formatted diagnostics (`file(line,col): TSxxxx message`)
 * reported for those files. An empty array means the files type-check.
 */
export function typecheckGeneratedFiles(options: TypecheckGeneratedOptions): string[] {
  return withGeneratedProgram(options, (program, rootFiles, directory) => {
    const diagnostics: string[] = []
    for (const filePath of rootFiles.values()) {
      const sourceFile = program.getSourceFile(filePath)
      if (!sourceFile) {
        diagnostics.push(`${filePath}: source file was not loaded`)
        continue
      }
      for (const diagnostic of ts.getPreEmitDiagnostics(program, sourceFile)) {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        const position = diagnostic.file && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined
        const location = position ? `(${position.line + 1},${position.character + 1})` : ''
        diagnostics.push(`${filePath.slice(directory.length + 1)}${location}: TS${diagnostic.code} ${message}`)
      }
    }
    return diagnostics
  })
}

/** Module-scope value names of one generated module, as the TypeScript checker resolves them. */
export interface ModuleScopeValueNames {
  /**
   * Globals the module's code refers to: identifiers (in any position, `typeof fetch` included) that the
   * checker binds to a global value symbol, such as `fetch`, `Object`, `undefined` or `globalThis`.
   * A module-scope declaration with one of these names would shadow the global in the whole module.
   */
  globals: string[]
  /** Value bindings the module declares (or imports as values) at module scope. */
  declarations: string[]
}

/**
 * Lists the module-scope value names of the generated module `file` (a key of `files`), resolved by the
 * TypeScript checker over the compiled files. Both lists are sorted and free of duplicates.
 */
export function collectModuleScopeValueNames(options: TypecheckGeneratedOptions & { file: string }): ModuleScopeValueNames {
  return withGeneratedProgram(options, (program, rootFiles) => {
    const filePath = rootFiles.get(options.file)
    const sourceFile = filePath ? program.getSourceFile(filePath) : undefined
    if (!sourceFile) throw new Error(`${options.file} is not one of the compiled files`)
    const checker = program.getTypeChecker()

    // Every value symbol visible at module scope: the module's own bindings and the globals.
    const declarations = new Set<string>()
    const globalSymbols = new Map<string, ts.Symbol>()
    for (const symbol of checker.getSymbolsInScope(sourceFile, ts.SymbolFlags.Value)) {
      if (symbol.declarations?.some(declaration => declaration.getSourceFile() === sourceFile)) declarations.add(symbol.name)
      else globalSymbols.set(symbol.name, symbol)
    }

    const globals = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node)
        if (symbol && globalSymbols.get(symbol.name) === symbol) globals.add(symbol.name)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)

    return { globals: [...globals].sort(), declarations: [...declarations].sort() }
  })
}

/** Generated file shape shared by pipeline results and plugin contexts. */
export interface GeneratedFileLike {
  path: string
  content: string
  isVirtual?: boolean | undefined
}

/** Maps emitted (non-virtual) generated files to the `files` record of {@link typecheckGeneratedFiles}. */
export function toFileRecord(files: readonly GeneratedFileLike[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const file of files) {
    if (!file.isVirtual) record[file.path] = file.content
  }
  return record
}
