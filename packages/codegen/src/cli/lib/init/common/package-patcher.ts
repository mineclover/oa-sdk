import type {
  PackagePatchOptions,
  PackagePatchResult,
  PatchAction,
} from '../types.js'

/**
 * Detects the indentation unit used in JSON content (2-space, 4-space, or tab).
 */
export function detectIndentation(content: string): string {
  // Check tab
  if (/^(\t+)"/m.test(content) || /\{\t+"/.test(content)) {
    return '\t'
  }
  // Check leading spaces on lines with keys
  const match = content.match(/^([ ]+)"/m)
  if (match && match[1]) {
    return match[1]
  }
  return '  '
}

/**
 * Safely parses, merges, and updates package.json scripts and dependencies
 * without clobbering formatting, indentation, line endings, or existing commands.
 */
export function patchPackageJson(
  originalContent: string,
  options: PackagePatchOptions = {},
): PackagePatchResult {
  const { scripts = {}, dependencies = {}, devDependencies = {}, force = false } = options

  const indentation = detectIndentation(originalContent)
  const lineEnding: '\n' | '\r\n' = originalContent.includes('\r\n') ? '\r\n' : '\n'
  const hasTrailingNewline = originalContent.endsWith('\n') || originalContent.endsWith('\r\n')

  let parsed: any
  try {
    parsed = JSON.parse(originalContent)
  } catch (err: any) {
    throw new Error(`Invalid package.json syntax: ${err.message}`)
  }

  // 1. Scripts merge
  const scriptActions: PatchAction[] = []
  if (Object.keys(scripts).length > 0) {
    if (!parsed.scripts) parsed.scripts = {}
    for (const [key, val] of Object.entries(scripts)) {
      const existing = parsed.scripts[key]
      if (existing === undefined) {
        parsed.scripts[key] = val
        scriptActions.push({ key, after: val, action: 'added' })
      } else if (existing === val) {
        scriptActions.push({ key, before: existing, after: val, action: 'unchanged' })
      } else if (force) {
        parsed.scripts[key] = val
        scriptActions.push({
          key,
          before: existing,
          after: val,
          action: 'updated',
          reason: 'forced overwrite',
        })
      } else {
        scriptActions.push({
          key,
          before: existing,
          after: val,
          action: 'skipped',
          reason: 'exists without --force',
        })
      }
    }
  }

  // 2. Dependencies merge
  const depActions: PatchAction[] = []
  if (Object.keys(dependencies).length > 0) {
    if (!parsed.dependencies) parsed.dependencies = {}
    for (const [key, val] of Object.entries(dependencies)) {
      const existing = parsed.dependencies[key]
      if (existing === undefined) {
        parsed.dependencies[key] = val
        depActions.push({ key, after: val, action: 'added' })
      } else if (existing === val) {
        depActions.push({ key, before: existing, after: val, action: 'unchanged' })
      } else if (force) {
        parsed.dependencies[key] = val
        depActions.push({
          key,
          before: existing,
          after: val,
          action: 'updated',
          reason: 'forced overwrite',
        })
      } else {
        depActions.push({
          key,
          before: existing,
          after: val,
          action: 'skipped',
          reason: 'existing version retained',
        })
      }
    }
  }

  // 3. DevDependencies merge
  const devDepActions: PatchAction[] = []
  if (Object.keys(devDependencies).length > 0) {
    if (!parsed.devDependencies) parsed.devDependencies = {}
    for (const [key, val] of Object.entries(devDependencies)) {
      const existing = parsed.devDependencies[key]
      if (existing === undefined) {
        parsed.devDependencies[key] = val
        devDepActions.push({ key, after: val, action: 'added' })
      } else if (existing === val) {
        devDepActions.push({ key, before: existing, after: val, action: 'unchanged' })
      } else if (force) {
        parsed.devDependencies[key] = val
        devDepActions.push({
          key,
          before: existing,
          after: val,
          action: 'updated',
          reason: 'forced overwrite',
        })
      } else {
        devDepActions.push({
          key,
          before: existing,
          after: val,
          action: 'skipped',
          reason: 'existing version retained',
        })
      }
    }
  }

  let patched = JSON.stringify(parsed, null, indentation)
  if (lineEnding === '\r\n') {
    patched = patched.replace(/\r?\n/g, '\r\n')
  }
  if (hasTrailingNewline && !patched.endsWith(lineEnding)) {
    patched += lineEnding
  }

  const modified =
    scriptActions.some(a => a.action === 'added' || a.action === 'updated') ||
    depActions.some(a => a.action === 'added' || a.action === 'updated') ||
    devDepActions.some(a => a.action === 'added' || a.action === 'updated')

  return {
    patchedContent: patched,
    modified,
    scripts: scriptActions,
    dependencies: depActions,
    devDependencies: devDepActions,
    indentation,
    lineEnding,
  }
}
