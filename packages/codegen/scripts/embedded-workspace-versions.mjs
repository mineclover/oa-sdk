import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Package-to-version tables embedded in the JavaScript under `packageRoot` as JSON string
 * literals (the build-time `__OA_SDK_WORKSPACE_VERSIONS__` constant, see workspace-versions.mjs)
 * that name any of `packageNames`.
 *
 * The files are parsed, so a table is found whatever quotes and escapes the bundler wrote it
 * with. Used by the codegen pack smoke and by the release exporter, which read the table from
 * the packed artifact so that they check what actually ships.
 */
export function embeddedVersionTables(packageRoot, packageNames) {
  const tables = []
  for (const file of listFiles(packageRoot).filter(path => path.endsWith('.js'))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
    const visit = node => {
      if (ts.isStringLiteralLike(node) && node.text.startsWith('{')) {
        const table = parseVersionTable(node.text)
        if (table && [...packageNames].some(name => name in table)) tables.push(table)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return tables
}

function parseVersionTable(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.values(value).every(version => typeof version === 'string') ? value : undefined
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}
