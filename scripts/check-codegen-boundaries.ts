import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

type Boundary = {
  name: string
  directory: string
  forbiddenImportSpecifiers: (specifier: string) => boolean
}

const isGovernanceImportSpecifier = (specifier: string): boolean =>
  /(?:^|\/)cli(?:\/|\.js$|$)/.test(specifier)

const root = resolve(process.cwd())
const sourceRoot = join(root, 'packages/codegen/src')
const boundaries: Boundary[] = [
  {
    name: 'typegen',
    directory: join(sourceRoot, 'typegen'),
    forbiddenImportSpecifiers: isGovernanceImportSpecifier,
  },
  {
    name: 'drizzle',
    directory: join(sourceRoot, 'drizzle'),
    forbiddenImportSpecifiers: isGovernanceImportSpecifier,
  },
]

const issues: string[] = []
for (const boundary of boundaries) {
  if (!isDirectory(boundary.directory)) {
    issues.push(`${boundary.name}: missing boundary directory ${relative(root, boundary.directory)}`)
    continue
  }

  for (const file of collectTypeScriptFiles(boundary.directory)) {
    const source = readFileSync(file, 'utf8')
    const forbiddenSpecifiers = collectImportSpecifiers(source)
      .filter(boundary.forbiddenImportSpecifiers)
    if (forbiddenSpecifiers.length > 0) {
      issues.push(`${boundary.name}: forbidden governance import(s) ${forbiddenSpecifiers.join(', ')} in ${relative(root, file)}`)
    }
  }
}

const requiredDirectories = [
  'typegen',
  'drizzle',
  'cli/commands',
  'cli/lib',
  'spec-lens',
]
for (const directory of requiredDirectories) {
  if (!isDirectory(join(sourceRoot, directory))) {
    issues.push(`codegen boundary is missing: ${directory}`)
  }
}

if (issues.length > 0) {
  console.error('Codegen boundary check failed:')
  for (const issue of issues) console.error(`- ${issue}`)
  process.exit(1)
}

console.log('Codegen boundaries are in sync: generation, adapters, governance CLI, and spec-lens integration.')

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...collectTypeScriptFiles(path))
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) files.push(path)
  }
  return files
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) specifiers.push(specifier)
    }
  }
  return [...new Set(specifiers)]
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}
