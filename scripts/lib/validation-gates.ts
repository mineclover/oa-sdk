import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

export type ValidationGateIssue = {
  gate: string
  file: string
  line: number
  message: string
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

const skippedDirectories = new Set([
  '.git',
  '.next',
  '.oa-cache',
  '.pnpm-store',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'references',
])

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
        for (const example of readFencedShellCommands(content, options.executable)) {
          const commandName = example.tokens[1]
          if (!commandName || commandName === '--help' || commandName === '-h') continue
          const command = commands.get(commandName)
          if (!command) {
            issues.push(issue(options.root, file, example.line, `unknown ${options.executable} command: ${commandName}`))
            continue
          }
          const longOptions = new Set(Object.keys(command.options))
          const shortOptions = new Set(Object.values(command.options)
            .map(option => option.short)
            .filter((value): value is string => value !== undefined))
          for (const token of example.tokens.slice(2)) {
            if (token === '--help' || token === '-h') continue
            const option = optionName(token)
            if (!option) continue
            const known = option.kind === 'long'
              ? longOptions.has(option.value)
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
      const executableIndex = segment.indexOf(executable)
      if (executableIndex === -1) continue
      examples.push({ tokens: segment.slice(executableIndex), line: firstLine })
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

function issue(root: string, file: string, line: number, message: string): ValidationGateIssue {
  return { gate: 'cli-examples', file: relative(root, file), line, message }
}

function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)
}

function lineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length
}
