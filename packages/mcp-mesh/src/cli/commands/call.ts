/**
 * @oa-sdk/mcp-mesh — CLI "call" Command
 *
 * Dispatches multi-MCP tool calls through MeshRouter with virtual namespacing
 * and resilient F5 browser refresh retries.
 */
import { Command } from 'commander'
import { formatOutput } from '../formatters.js'
import type { CliContext } from '../types.js'
import { thrownMessage } from '../errors.js'

/** Tool-call arguments given as JSON on the command line must be one JSON object. */
const ToolArgumentsSchema = {
  parse(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('Tool arguments must be a JSON object')
    }
    return { ...value }
  },
}

export function registerCallCommands(program: Command, ctx: CliContext): void {
  program
    .command('call <tool> [args...]')
    .description('Execute an MCP tool across the mesh ({domain}__{tool} or bare name)')
    .option('--peer <alias>', 'Target specific peer alias or session')
    .action(async (toolName: string, rawArgs: string[], opts) => {
      const format = ctx.getOutputFormat()

      try {
        // Parse arguments: JSON string or key=val pairs
        let parsedArgs: Record<string, unknown> = {}
        if (rawArgs && rawArgs.length > 0) {
          const joined = rawArgs.join(' ').trim()
          if (joined.startsWith('{') && joined.endsWith('}')) {
            try {
              parsedArgs = ToolArgumentsSchema.parse(JSON.parse(joined))
            } catch {
              throw new Error(`Invalid JSON arguments: ${joined}`)
            }
          } else {
            // key=val pairs
            for (const arg of rawArgs) {
              const eqIdx = arg.indexOf('=')
              if (eqIdx !== -1) {
                const key = arg.slice(0, eqIdx).trim()
                const val = arg.slice(eqIdx + 1).trim()
                // Auto-cast booleans and numbers
                if (val === 'true') parsedArgs[key] = true
                else if (val === 'false') parsedArgs[key] = false
                else if (!Number.isNaN(Number(val)) && val !== '') parsedArgs[key] = Number(val)
                else parsedArgs[key] = val
              }
            }
          }
        }

        // If specific peer option is provided, ensure session is active
        if (opts.peer) {
          const route = ctx.router.resolveRoute(toolName)
          if (route) {
            ctx.registry.setActiveSession(route.domain, opts.peer)
          }
        }

        const result = await ctx.router.dispatchTool(toolName, parsedArgs)
        console.log(formatOutput(result, format))
      } catch (err: unknown) {
        console.error(`Tool execution failed: ${thrownMessage(err)}`)
        if (ctx.isDebug()) console.error(err)
        process.exit(1)
      }
    })
}
