/** Read the declared TypeScript export surface without building or executing packages. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

export interface ExportInfo {
  names: Set<string>
  origins: Map<string, string>
  reExportFiles: string[]
}

function resolveLocalExport(filePath: string, specifier: string): string {
  const target = resolve(dirname(filePath), specifier)
  const stem = target.replace(/\.(?:[cm]?js|jsx)$/, '')
  const candidates = [stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.cts', join(stem, 'index.ts'), target]
  const found = candidates.find(candidate => existsSync(candidate) && /\.(?:[cm]?ts|tsx)$/.test(candidate))
  if (!found) throw new Error(`Cannot resolve export ${specifier} from ${filePath}`)
  return found
}

export function extractExportsFromFile(filePath: string, visited = new Set<string>()): ExportInfo {
  filePath = resolve(filePath)
  const result: ExportInfo = { names: new Set(), origins: new Map(), reExportFiles: [] }
  if (visited.has(filePath)) return result
  visited.add(filePath)
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true)
  const errors = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (errors.length) throw new Error(`Cannot parse exports in ${filePath}: ${ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n')}`)
  const add = (name: string, origin = filePath) => {
    result.names.add(name)
    result.origins.set(name, origin)
  }
  const binding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) add(name.text)
    else for (const element of name.elements) if (ts.isBindingElement(element)) binding(element.name)
  }
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined
      const local = specifier?.startsWith('.') ? resolveLocalExport(filePath, specifier) : undefined
      if (local) result.reExportFiles.push(local)
      if (node.exportClause) {
        if (ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) add(element.name.text, local ?? filePath)
        } else add(node.exportClause.name.text, local ?? filePath)
      } else if (local) {
        const child = extractExportsFromFile(local, visited)
        for (const name of child.names) if (name !== 'default') add(name, child.origins.get(name))
        result.reExportFiles.push(...child.reExportFiles)
      } else {
        // A dependency wildcard needs an explicit surface contract, not silent omission.
        throw new Error(`Unsupported dependency wildcard export ${specifier} in ${filePath}; use named exports`)
      }
      continue
    }
    if (ts.isExportAssignment(node)) { add('default'); continue }
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (!modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) { add('default'); continue }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) binding(declaration.name)
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
      if (node.name) add(node.name.text)
    }
  }
  return result
}

/** Package headers are exact identities: chunk-stream must never absorb chunk-stream-ui. */
export function extractDocNames(content: string): Map<string, Set<string>> {
  const packages = new Map<string, Set<string>>()
  let current: string | undefined
  let internal = false
  let fenced = false
  let exportColumn = 0
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    if (line.startsWith('#')) {
      exportColumn = 0
      current = line.match(/@oa-sdk\/([\w-]+(?:\/[\w./-]+)?)/)?.[1]
      internal = /내부|미노출|internal|재구현|금지/i.test(line)
      if (current && !packages.has(current)) packages.set(current, new Set())
    }
    if (!current || internal || !line.startsWith('|')) continue
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim())
    const headerIndex = cells.findIndex(cell => ['Export', '함수', '함수/타입', '타입', '주요 타입'].includes(cell))
    if (headerIndex !== -1) { exportColumn = headerIndex; continue }
    const exportsCell = cells[exportColumn] ?? ''
    for (const match of exportsCell.matchAll(/`([$\w]+)(?:<[^>]*>)?(?:\(\))?`/g)) {
      packages.get(current)!.add(match[1]!)
    }
  }
  return packages
}

export function compareExportNames(code: ReadonlySet<string>, documented: ReadonlySet<string>) {
  return {
    missing: [...code].filter(name => !documented.has(name)).sort(),
    orphaned: [...documented].filter(name => !code.has(name)).sort(),
  }
}

/** Current symbol packages publish src/index.ts as the ESM dist/index barrel. */
export function assertRootExport(rootExport: unknown): void {
  if (!rootExport || typeof rootExport !== 'object' || Array.isArray(rootExport)) throw new Error('Missing or unsupported root export mapping')
  const conditions = rootExport as Record<string, unknown>
  if (conditions.types !== './dist/index.d.ts' || (conditions.import ?? conditions.default) !== './dist/index.js') {
    throw new Error('Root export must map to ./dist/index.js and ./dist/index.d.ts')
  }
  for (const [condition, target] of Object.entries(conditions)) {
    if (target !== (condition === 'types' ? './dist/index.d.ts' : './dist/index.js')) {
      throw new Error(`Unsupported root export condition ${condition}: add an explicit source mapping`)
    }
  }
}

/** Release policy is the package inventory; DPM retains its existing maintenance gate. */
export function apiIndexPackages(root: string): string[] {
  const policy = JSON.parse(readFileSync(join(root, 'docs/internal/release-policy.json'), 'utf8'))
  if (!Array.isArray(policy.releaseTracked) || !policy.releaseTracked.length || !Array.isArray(policy.distributionCandidates)) {
    throw new Error('API index requires a non-empty releaseTracked policy and distributionCandidates')
  }
  return [...new Set<string>([...policy.releaseTracked, ...policy.distributionCandidates, '@oa-sdk/dpm'])].map(name => {
    if (!/^@oa-sdk\/[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid API index package ${name}`)
    return name.slice('@oa-sdk/'.length)
  }).sort()
}
