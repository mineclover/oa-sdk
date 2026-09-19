/**
 * @oa-sdk/tools — Commander.js CLI Adapter
 *
 * Automatically generates CLI commands, positional arguments, type-coerced options,
 * and structured outputs from ToolDefinitions and JSON Schemas.
 */
import { Command } from 'commander'
import { createToolContext, executeTool } from './context.js'
import { normalizeJsonSchema, validateToolInput } from './schema.js'
import type { ToolDefinition } from './types.js'

export interface CliAdapterOptions {
  name?: string | undefined
  version?: string | undefined
  description?: string | undefined
  outputFormat?: 'json' | 'table' | undefined
}

export function createCli(
  tools: ToolDefinition[],
  options: CliAdapterOptions = {},
): Command {
  const program = new Command()

  program
    .name(options.name ?? 'cli')
    .version(options.version ?? '1.0.0')
    .description(options.description ?? 'CLI generated from tools')

  // Global options
  program
    .option('-o, --output <format>', 'Output format (json, table)', options.outputFormat ?? 'json')
    .option('--debug', 'Enable debug log output', false)

  // Group tools by category
  const categoryMap = new Map<string, ToolDefinition[]>()
  for (const tool of tools) {
    const cat = tool.category ?? 'default'
    const list = categoryMap.get(cat) ?? []
    list.push(tool)
    categoryMap.set(cat, list)
  }

  for (const [category, catTools] of categoryMap.entries()) {
    const parentCmd =
      category === 'default'
        ? program
        : program.command(category).description(`${category} commands`)

    for (const tool of catTools) {
      addToolCommand(parentCmd, tool)
    }
  }

  return program
}

function addToolCommand(parent: Command, tool: ToolDefinition): void {
  const commandName = tool.cli?.command ?? getCommandName(tool.name, tool.category)
  const cmd = parent.command(commandName).description(tool.description)

  if (tool.cli?.aliases) {
    for (const alias of tool.cli.aliases) {
      cmd.alias(alias)
    }
  }

  // Identify positional arguments
  const positionalArgNames = new Set((tool.cli?.arguments ?? []).map((a) => a.name))

  // Add positional arguments
  if (tool.cli?.arguments) {
    for (const arg of tool.cli.arguments) {
      const argStr = arg.required ? `<${arg.name}>` : `[${arg.name}]`
      cmd.argument(argStr, arg.description)
    }
  }

  // Extract options from inputSchema (skipping positional arguments)
  const schema = normalizeJsonSchema(tool.inputSchema)
  if (schema.properties) {
    const requiredFields = new Set(schema.required ?? [])

    for (const [key, prop] of Object.entries(schema.properties)) {
      if (positionalArgNames.has(key)) continue

      const propType = Array.isArray(prop.type) ? prop.type[0] : prop.type
      const isRequired = requiredFields.has(key)
      const flagName = toKebabCase(key)
      const desc = prop.description ?? key

      if (propType === 'boolean') {
        cmd.option(`--${flagName}`, desc, prop.default as boolean | undefined)
      } else if (propType === 'number' || propType === 'integer') {
        const flagStr = isRequired ? `--${flagName} <number>` : `--${flagName} [number]`
        const coerce = (val: string) => {
          const n = Number(val)
          if (Number.isNaN(n)) throw new Error(`Invalid number: ${val}`)
          return n
        }
        if (isRequired) {
          cmd.requiredOption(flagStr, desc, coerce, prop.default as number | undefined)
        } else {
          cmd.option(flagStr, desc, coerce, prop.default as number | undefined)
        }
      } else if (propType === 'array') {
        const flagStr = isRequired ? `--${flagName} <items>` : `--${flagName} [items]`
        const coerce = (val: string, prev?: unknown) => {
          const prevArr = Array.isArray(prev) ? prev : []
          const items = val.includes(',') ? val.split(',').map((s) => s.trim()) : [val]
          return [...prevArr, ...items]
        }
        if (isRequired) {
          cmd.requiredOption(flagStr, desc, coerce, prop.default as unknown[] | undefined)
        } else {
          cmd.option(flagStr, desc, coerce, prop.default as unknown[] | undefined)
        }
      } else {
        const flagStr = isRequired ? `--${flagName} <${key}>` : `--${flagName} [${key}]`
        if (isRequired) {
          cmd.requiredOption(flagStr, desc, prop.default as string | undefined)
        } else {
          cmd.option(flagStr, desc, prop.default as string | undefined)
        }
      }
    }
  }

  // Add examples if present
  if (tool.cli?.examples) {
    cmd.addHelpText('after', `\nExamples:\n  ${tool.cli.examples.join('\n  ')}`)
  }

  // Action execution handler
  cmd.action(async (...args: unknown[]) => {
    const globalOpts = parent.parent?.opts() ?? parent.opts() ?? {}
    const options = args[args.length - 2] as Record<string, unknown>
    const positionalArgs = args.slice(0, -2)

    try {
      const input: Record<string, unknown> = { ...options }

      // Map positional args
      if (tool.cli?.arguments) {
        for (let i = 0; i < tool.cli.arguments.length && i < positionalArgs.length; i++) {
          const arg = tool.cli.arguments[i]!
          input[arg.name] = positionalArgs[i]
        }
      }

      // Validate input
      const validation = validateToolInput(tool.inputSchema, input)
      if (!validation.success) {
        console.error(`Validation error: ${validation.error}`)
        process.exit(1)
      }

      const ctx = createToolContext({ meta: { cli: true, toolName: tool.name } })
      const result = await executeTool(tool, validation.data, ctx)

      const format = (globalOpts.output as string) ?? 'json'
      console.log(formatOutput(result, format))
    } catch (error: any) {
      console.error(`Error: ${error.message ?? String(error)}`)
      if (globalOpts.debug) {
        console.error(error)
      }
      process.exit(1)
    }
  })
}

function getCommandName(name: string, category?: string): string {
  if (category && name.startsWith(`${category}-`)) {
    return name.slice(category.length + 1)
  }
  return name
}

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function formatOutput(data: unknown, format: string): string {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return data

  if (format === 'table' && Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return formatTable(data as Record<string, unknown>[])
  }

  return JSON.stringify(data, null, 2)
}

function formatTable(items: Record<string, unknown>[]): string {
  if (items.length === 0) return '[]'
  const keys = Object.keys(items[0]!)
  if (keys.length === 0) return '[]'

  const widths = keys.map((k) =>
    Math.max(
      k.length,
      ...items.map((it) => {
        const val = it[k]
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
        return str.length
      }),
    ),
  )

  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join('  ')
  const separator = widths.map((w) => '-'.repeat(w)).join('  ')
  const rows = items.map((it) =>
    keys
      .map((k, i) => {
        const val = it[k]
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')
        return str.padEnd(widths[i]!)
      })
      .join('  '),
  )

  return [header, separator, ...rows].join('\n')
}
