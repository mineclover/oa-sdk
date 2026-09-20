/**
 * Repository documentation and configuration validation gates.
 *
 * Fully self-contained implementation for markdown links, CLI command/example
 * coverage, package entrypoints, and closed-by-default agent configuration.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path'

export type ValidationGateIssue = {
  gate: string
  file: string
  line: number
  message: string
  code?: string
}

export type ValidationGate = {
  name: string
  validate(): readonly ValidationGateIssue[]
}

export type DocumentedCliCommand = {
  name: string
  options: Readonly<Record<string, { short?: string }>>
}

export type MarkdownLinkGateOptions = {
  root: string
  files: readonly string[]
}

export type CliExampleGateOptions = MarkdownLinkGateOptions & {
  executable: string
  commands: readonly DocumentedCliCommand[]
}

export type CliReferenceGateOptions = {
  root: string
  file: string
  executable: string
  commands: readonly DocumentedCliCommand[]
}

export type PackageEntrypointGateOptions = {
  root: string
  file: string
}

export type AgentConfigGateOptions = {
  root: string
  homeDir?: string
  skillsConfigPath?: string
  pluginsConfigPath?: string
  checkPluginsConfig?: boolean
  checkPathExistence?: boolean
  checkGlobalPathExistence?: boolean
  forbiddenWildcards?: readonly (string | RegExp)[]
}

export type AgentConfigGateIssue = ValidationGateIssue

export type AgentConfigGate = ValidationGate

const skippedDirectories = new Set([
  '.agents',
  '.git',
  '.next',
  '.oa-cache',
  '.pnpm-store',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'references',
  '.worktrees',
])

const builtOaGenCli = ['node', 'packages/codegen/dist/cli/index.js'] as const
const universalGlobalOptions = new Set(['root', 'project-root'])

const DEFAULT_FORBIDDEN_AGENT_WILDCARDS: readonly (string | RegExp)[] = [
  '*',
  '**',
  '*.*',
  '*/*',
  '**/*',
  '.*',
  '.+',
  '.*?',
  '.+?',
  '^.*',
  '.*$',
  '^.*$',
  '^.+',
  '.+$',
  '^.+$',
  '.*.*',
  '(.*)',
  '(?:.*)',
]

/** Run independently reusable validation gates and retain their source labels. */
export function runValidationGates(gates: readonly ValidationGate[]): ValidationGateIssue[] {
  return gates.flatMap(gate => gate.validate())
}

/** List repository Markdown files while excluding generated and vendored trees. */
export function listMarkdownFiles(root: string): string[] {
  const files: string[] = []
  visit(root, files)
  return files.sort()

  function visit(directory: string, output: string[]): void {
    for (const entry of readdirSync(directory)) {
      if (skippedDirectories.has(entry)) continue
      const path = resolve(directory, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        visit(path, output)
      } else if (entry.endsWith('.md')) {
        output.push(path)
      }
    }
  }
}

/** Validate local Markdown links without making network requests. */
export function createMarkdownLocalLinkGate(options: MarkdownLinkGateOptions): ValidationGate {
  return {
    name: 'markdown-local-links',
    validate() {
      const issues: ValidationGateIssue[] = []
      for (const file of options.files) {
        const content = readFileSync(file, 'utf8')
        for (const match of content.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)) {
          const target = match[1]?.replace(/^<|>$/g, '')
          if (!target || isExternalLink(target) || target.startsWith('#')) continue
          const path = resolve(dirname(file), target.split('#', 1)[0]!)
          if (existsSync(path)) continue
          const referencesDir = resolve(options.root, 'references')
          if (path.startsWith(referencesDir)) continue
          issues.push({
            gate: 'markdown-local-links',
            file: relative(options.root, file),
            line: lineNumber(content, match.index ?? 0),
            message: `missing local link target: ${target}`,
          })
        }
      }
      return issues
    },
  }
}

/**
 * Validate oa-gen command names and flags in fenced shell examples against the
 * live command registry. It intentionally does not execute examples.
 */
export function createCliExampleGate(options: CliExampleGateOptions): ValidationGate {
  const commands = new Map(options.commands.map(command => [command.name, command]))
  return {
    name: 'cli-examples',
    validate() {
      const issues: ValidationGateIssue[] = []
      for (const file of options.files) {
        const content = readFileSync(file, 'utf8')
        const examples = readFencedShellCommands(content, options.executable)
        for (const example of examples) {
          const commandName = example.tokens[1]
          if (!commandName || commandName === '--help' || commandName === '-h') continue
          let command = commands.get(commandName)
          let argStartIndex = 2
          if (!command && example.tokens.length > 2) {
            const compoundName = `${example.tokens[1]} ${example.tokens[2]}`
            if (commands.has(compoundName)) {
              command = commands.get(compoundName)
              argStartIndex = 3
            }
          }
          if (!command) {
            issues.push(issue(options.root, file, example.line, `unknown ${options.executable} command: ${commandName}`))
            continue
          }

          const longOptions = new Set(Object.keys(command.options))
          const shortOptions = new Set(
            Object.values(command.options)
              .map(option => option.short)
              .filter((short): short is string => short !== undefined),
          )

          for (const token of example.tokens.slice(argStartIndex)) {
            if (token === '--help' || token === '-h') continue
            const option = optionName(token)
            if (!option) continue
            const known = option.kind === 'long'
              ? longOptions.has(option.value) || (options.executable === 'oa-gen' && universalGlobalOptions.has(option.value))
              : shortOptions.has(option.value)
            if (!known) {
              issues.push(issue(options.root, file, example.line, `unknown ${options.executable} option for ${commandName}: ${token}`))
            }
          }
        }
      }
      return issues
    },
  }
}

/**
 * Require one dedicated Markdown command-reference table to list every live
 * command exactly once. Examples validate invocation syntax; this gate closes
 * the separate gap where a valid command has no discoverable onboarding entry.
 */
export function createCliReferenceGate(options: CliReferenceGateOptions): ValidationGate {
  return {
    name: 'cli-reference-coverage',
    validate() {
      if (!existsSync(options.file)) {
        return [{
          gate: 'cli-reference-coverage',
          file: relative(options.root, options.file),
          line: 1,
          message: 'missing CLI command reference document',
        }]
      }

      const issues: ValidationGateIssue[] = []
      const content = readFileSync(options.file, 'utf8')
      const known = new Set(options.commands.map(command => command.name))
      const seen = new Map<string, number>()
      const pattern = new RegExp(
        '^\\|\\s*`' + escapeRegExp(options.executable) + '\\s+([a-z][a-z0-9:-]*(?:\\s+[a-z][a-z0-9:-]*)*)`\\s*\\|',
        'gm',
      )
      for (const match of content.matchAll(pattern)) {
        const name = match[1]!
        const line = lineNumber(content, match.index ?? 0)
        if (!known.has(name)) {
          issues.push({
            gate: 'cli-reference-coverage',
            file: relative(options.root, options.file),
            line,
            message: `unknown ${options.executable} command in reference: ${name}`,
          })
          continue
        }
        if (seen.has(name)) {
          issues.push({
            gate: 'cli-reference-coverage',
            file: relative(options.root, options.file),
            line,
            message: `duplicate ${options.executable} command in reference: ${name}`,
          })
          continue
        }
        seen.set(name, line)
      }
      for (const command of options.commands) {
        if (seen.has(command.name)) continue
        issues.push({
          gate: 'cli-reference-coverage',
          file: relative(options.root, options.file),
          line: 1,
          message: `missing ${options.executable} command in reference: ${command.name}`,
        })
      }
      return issues
    },
  }
}

/** Keep the library-entrypoint map complete as workspace packages are added. */
export function createPackageEntrypointGate(options: PackageEntrypointGateOptions): ValidationGate {
  return {
    name: 'package-entrypoint-coverage',
    validate() {
      if (!existsSync(options.file)) {
        return [{
          gate: 'package-entrypoint-coverage',
          file: relative(options.root, options.file),
          line: 1,
          message: 'missing library entrypoint document',
        }]
      }

      const issues: ValidationGateIssue[] = []
      const content = readFileSync(options.file, 'utf8')
      const known = readWorkspacePackageNames(options.root)
      const seen = new Map<string, number>()
      const pattern = /^\|\s*`(@oa-sdk\/[a-z0-9-]+)`\s*\|/gm
      for (const match of content.matchAll(pattern)) {
        const name = match[1]!
        const line = lineNumber(content, match.index ?? 0)
        if (!known.has(name)) {
          issues.push({
            gate: 'package-entrypoint-coverage',
            file: relative(options.root, options.file),
            line,
            message: `unknown workspace package in entrypoint map: ${name}`,
          })
          continue
        }
        if (seen.has(name)) {
          issues.push({
            gate: 'package-entrypoint-coverage',
            file: relative(options.root, options.file),
            line,
            message: `duplicate workspace package in entrypoint map: ${name}`,
          })
          continue
        }
        seen.set(name, line)
      }
      for (const name of known) {
        if (seen.has(name)) continue
        issues.push({
          gate: 'package-entrypoint-coverage',
          file: relative(options.root, options.file),
          line: 1,
          message: `missing workspace package in entrypoint map: ${name}`,
        })
      }
      return issues
    },
  }
}

/**
 * Validate closed-by-default agent skill and plugin governance.
 */
export function createAgentConfigGate(options: AgentConfigGateOptions): AgentConfigGate {
  const root = resolve(options.root)
  const homeDir = resolve(options.homeDir ?? process.env.HOME ?? homedir())
  const skillsPath = resolve(root, options.skillsConfigPath ?? join('.agents', 'skills.json'))
  const pluginsPath = resolve(root, options.pluginsConfigPath ?? join('.agents', 'plugins.json'))
  const checkPlugins = options.checkPluginsConfig
  const checkPathExistence = options.checkPathExistence !== false
  const forbiddenList: readonly (string | RegExp)[] = [
    ...DEFAULT_FORBIDDEN_AGENT_WILDCARDS,
    ...(options.forbiddenWildcards ?? []),
  ]

  return {
    name: 'agent-config',
    validate(): readonly AgentConfigGateIssue[] {
      const issues: AgentConfigGateIssue[] = []

      validateFile(skillsPath, true, issues)

      if (checkPlugins === true || (checkPlugins !== false && existsSync(pluginsPath))) {
        validateFile(pluginsPath, checkPlugins === true, issues)
      }

      return issues
    },
  }

  function validateFile(targetPath: string, isRequired: boolean, issues: AgentConfigGateIssue[]): void {
    const relFile = relative(root, targetPath)
    if (!existsSync(targetPath)) {
      if (isRequired) {
        issues.push({
          gate: 'agent-config',
          code: 'ERR_AGENT_CONFIG_MISSING',
          file: relFile,
          line: 1,
          message: `missing required agent configuration file: ${relFile}`,
        })
      }
      return
    }

    const content = readFileSync(targetPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (err) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_SYNTAX',
        file: relFile,
        line: 1,
        message: `invalid JSON syntax in agent configuration: ${(err as Error).message}`,
      })
      return
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_SCHEMA',
        file: relFile,
        line: 1,
        message: 'agent configuration must be a JSON object',
      })
      return
    }

    const config = parsed as Record<string, unknown>

    if (config.inherits !== undefined && !Array.isArray(config.inherits)) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_SCHEMA',
        file: relFile,
        line: lineNumberForProperty(content, 'inherits'),
        message: `inherits property must be an array in ${relFile}`,
      })
    }

    if (config.entries !== undefined && !Array.isArray(config.entries)) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_SCHEMA',
        file: relFile,
        line: lineNumberForProperty(content, 'entries'),
        message: `entries property must be an array in ${relFile}`,
      })
    }

    if (config.inherits === undefined && config.entries === undefined) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_SCHEMA',
        file: relFile,
        line: 1,
        message: `agent configuration must specify an "entries" or "inherits" array in ${relFile}`,
      })
    }

    const entriesToValidate: Array<{ item: unknown; isInherit: boolean }> = []
    if (Array.isArray(config.inherits)) {
      for (const item of config.inherits) entriesToValidate.push({ item, isInherit: true })
    }
    if (Array.isArray(config.entries)) {
      for (const item of config.entries) entriesToValidate.push({ item, isInherit: false })
    }

    for (const { item, isInherit } of entriesToValidate) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        issues.push({
          gate: 'agent-config',
          code: 'ERR_AGENT_CONFIG_SCHEMA',
          file: relFile,
          line: 1,
          message: 'agent configuration entry must be an object',
        })
        continue
      }

      const entry = item as Record<string, unknown>
      if (typeof entry.path !== 'string' || entry.path.trim().length === 0) {
        issues.push({
          gate: 'agent-config',
          code: 'ERR_AGENT_CONFIG_SCHEMA',
          file: relFile,
          line: 1,
          message: 'agent configuration entry missing required string path',
        })
        continue
      }

      const rawPath = entry.path.trim()
      const line = lineNumberForString(content, rawPath)

      const isHomeRelative = rawPath === '~' || rawPath.startsWith('~/') || rawPath.startsWith('~\\')
      const isWindowsAbsolute = win32.isAbsolute(rawPath)
      const isPosixAbsolute = posix.isAbsolute(rawPath)
      const isExplicitAbsolute = isWindowsAbsolute || isPosixAbsolute
      let resolvedEntryPath: string
      let isGlobal = false

      if (isHomeRelative) {
        isGlobal = true
        const subPath = rawPath === '~' ? '' : rawPath.slice(2).replace(/\\/g, '/')
        resolvedEntryPath = subPath ? resolve(homeDir, subPath) : homeDir
        const relHome = relative(homeDir, resolvedEntryPath)
        if (relHome.startsWith('..') || isAbsolute(relHome) || (!isAbsolute(resolvedEntryPath) && (win32.isAbsolute(resolvedEntryPath) || posix.isAbsolute(resolvedEntryPath)))) {
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_NON_HERMETIC',
            file: relFile,
            line,
            message: `non-hermetic relative path escaping home directory in agent configuration: "${rawPath}"`,
          })
        }
      } else if (isExplicitAbsolute) {
        resolvedEntryPath = resolve(rawPath)
        const rel = relative(root, resolvedEntryPath)
        const isOutside = rel.startsWith('..') || isAbsolute(rel) || (!isAbsolute(rawPath) && (isWindowsAbsolute || isPosixAbsolute))
        isGlobal = isOutside
        if (isGlobal) {
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_NON_HERMETIC',
            file: relFile,
            line,
            message: `non-hermetic global path in agent configuration: "${rawPath}" (use portable home-relative path "~/...")`,
          })
        } else {
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_NON_HERMETIC',
            file: relFile,
            line,
            message: `non-hermetic absolute path in agent configuration: "${rawPath}" (use workspace-relative path)`,
          })
        }
      } else {
        resolvedEntryPath = resolve(root, rawPath)
        const rel = relative(root, resolvedEntryPath)
        if (rel.startsWith('..') || isAbsolute(rel)) {
          isGlobal = true
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_NON_HERMETIC',
            file: relFile,
            line,
            message: `non-hermetic relative path escaping workspace in agent configuration: "${rawPath}"`,
          })
        }
      }

      if (isGlobal) {
        const includeOnly = entry.include_only
        if (!Array.isArray(includeOnly) || includeOnly.length === 0) {
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_CLOSED_BY_DEFAULT',
            file: relFile,
            line,
            message: `global path "${rawPath}" violates closed-by-default policy: missing or empty include_only whitelist`,
          })
        } else {
          validateIncludeOnlyPatterns(includeOnly, rawPath, content, relFile, forbiddenList, issues)
        }
      } else if (entry.include_only !== undefined) {
        if (!Array.isArray(entry.include_only)) {
          issues.push({
            gate: 'agent-config',
            code: 'ERR_AGENT_CONFIG_SCHEMA',
            file: relFile,
            line: lineNumberForProperty(content, 'include_only'),
            message: `include_only property must be an array for "${rawPath}"`,
          })
        } else {
          validateIncludeOnlyPatterns(entry.include_only, rawPath, content, relFile, forbiddenList, issues)
        }
      }

      const shouldCheckExistence = isGlobal
        ? options.checkGlobalPathExistence === true
        : checkPathExistence

      if (shouldCheckExistence && !existsSync(resolvedEntryPath)) {
        issues.push({
          gate: 'agent-config',
          code: 'ERR_AGENT_CONFIG_PATH_NOT_FOUND',
          file: relFile,
          line,
          message: `configured agent path does not exist: "${rawPath}"`,
        })
      } else if (existsSync(resolvedEntryPath)) {
        try {
          const stat = statSync(resolvedEntryPath)
          if (isInherit) {
            if (!stat.isFile() && !stat.isDirectory()) {
              issues.push({
                gate: 'agent-config',
                code: 'ERR_AGENT_CONFIG_PATH_TYPE',
                file: relFile,
                line,
                message: `configured inherit path is neither a file nor a directory: "${rawPath}"`,
              })
            }
          } else {
            if (!stat.isDirectory()) {
              issues.push({
                gate: 'agent-config',
                code: 'ERR_AGENT_CONFIG_PATH_TYPE',
                file: relFile,
                line,
                message: `configured entry path is not a directory: "${rawPath}"`,
              })
            }
          }
        } catch {
          // Ignore stat failure if existsSync succeeded
        }
      }
    }
  }
}

function validateIncludeOnlyPatterns(
  patterns: readonly unknown[],
  rawPath: string,
  content: string,
  relFile: string,
  forbiddenList: readonly (string | RegExp)[],
  issues: AgentConfigGateIssue[],
): void {
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.trim().length === 0) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_INVALID_PATTERN',
        file: relFile,
        line: lineNumberForString(content, String(pattern)),
        message: `invalid pattern in include_only whitelist for "${rawPath}"`,
      })
      continue
    }

    const trimmed = pattern.trim()

    if (isForbiddenWildcard(trimmed, forbiddenList)) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_FORBIDDEN_WILDCARD',
        file: relFile,
        line: lineNumberForString(content, pattern),
        message: `forbidden wildcard "${pattern}" in include_only whitelist for "${rawPath}": unrestricted cross-domain wildcards are not allowed`,
      })
      continue
    }

    try {
      new RegExp(trimmed)
    } catch (err) {
      issues.push({
        gate: 'agent-config',
        code: 'ERR_AGENT_CONFIG_INVALID_REGEX',
        file: relFile,
        line: lineNumberForString(content, pattern),
        message: `invalid regex pattern in include_only whitelist for "${rawPath}": ${(err as Error).message}`,
      })
    }
  }
}

function isForbiddenWildcard(pattern: string, forbiddenList: readonly (string | RegExp)[]): boolean {
  const trimmed = pattern.trim()
  for (const forbidden of forbiddenList) {
    if (typeof forbidden === 'string') {
      if (trimmed === forbidden) return true
    } else if (forbidden instanceof RegExp) {
      if (forbidden.test(trimmed)) return true
    }
  }
  if (/^[*?./\\]+$/.test(trimmed)) {
    return true
  }
  try {
    const rx = new RegExp(trimmed)
    if (rx.test('photoshop') && rx.test('svg-authoring') && rx.test('openwiki')) {
      return true
    }
  } catch {
    // Ignore invalid regex in wildcard heuristic
  }
  return false
}

function lineNumberForString(content: string, search: string): number {
  const index = content.indexOf(search)
  if (index === -1) return 1
  return lineNumber(content, index)
}

function lineNumberForProperty(content: string, prop: string): number {
  const match = content.match(new RegExp(`"${escapeRegExp(prop)}"\\s*:`))
  if (!match || match.index === undefined) return 1
  return lineNumber(content, match.index)
}

function readFencedShellCommands(
  content: string,
  executable: string,
): Array<{ tokens: string[]; line: number }> {
  const lines = content.split('\n')
  const examples: Array<{ tokens: string[]; line: number }> = []
  let inShellFence = false
  let commandLines: string[] = []
  let firstLine = 0

  const flushCommand = (): void => {
    if (commandLines.length === 0) return
    const tokens = shellTokens(commandLines.map(line => line.replace(/\\$/, '')).join(' '))
    for (const segment of splitShellSequence(tokens)) {
      const invocation = cliInvocationTokens(segment, executable)
      if (!invocation) continue
      examples.push({ tokens: invocation, line: firstLine })
    }
    commandLines = []
    firstLine = 0
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (/^```(?:bash|sh|shell|zsh)\s*$/i.test(line.trim())) {
      inShellFence = true
      continue
    }
    if (inShellFence && /^```\s*$/.test(line.trim())) {
      flushCommand()
      inShellFence = false
      continue
    }
    if (!inShellFence || line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (commandLines.length === 0) firstLine = index + 1
    commandLines.push(line.trim())
    if (!line.trimEnd().endsWith('\\')) flushCommand()
  }
  flushCommand()
  return examples
}

/** Normalize documented built oa-gen invocations to the public executable form. */
function cliInvocationTokens(segment: readonly string[], executable: string): string[] | undefined {
  const executableIndex = segment.indexOf(executable)
  if (executableIndex !== -1) return segment.slice(executableIndex)

  if (executable !== 'oa-gen') return undefined
  for (let index = 0; index < segment.length - 1; index += 1) {
    if (segment[index] !== builtOaGenCli[0] || segment[index + 1] !== builtOaGenCli[1]) continue
    return [executable, ...segment.slice(index + builtOaGenCli.length)]
  }
  return undefined
}

function shellTokens(command: string): string[] {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
}

function splitShellSequence(tokens: readonly string[]): string[][] {
  const segments: string[][] = []
  let segment: string[] = []
  for (const token of tokens) {
    if (token === '&&' || token === '||' || token === '|' || token === ';') {
      if (segment.length > 0) segments.push(segment)
      segment = []
    } else {
      segment.push(token)
    }
  }
  if (segment.length > 0) segments.push(segment)
  return segments
}

function optionName(token: string): { kind: 'long' | 'short'; value: string } | undefined {
  if (token.startsWith('--') && token.length > 2) {
    return { kind: 'long', value: token.slice(2).split('=', 1)[0]! }
  }
  if (/^-[A-Za-z]$/.test(token)) return { kind: 'short', value: token.slice(1) }
  return undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readWorkspacePackageNames(root: string): Set<string> {
  const packagesDirectory = join(root, 'packages')
  return new Set(
    readdirSync(packagesDirectory)
      .map(directory => join(packagesDirectory, directory, 'package.json'))
      .filter(existsSync)
      .map(packageJsonPath => {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown }
        return parsed.name
      })
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  )
}

function issue(root: string, file: string, line: number, message: string): ValidationGateIssue {
  return { gate: 'cli-examples', file: relative(root, file), line, message }
}

function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)
}

function lineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length
}
