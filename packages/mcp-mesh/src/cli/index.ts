/**
 * @oa-sdk/mcp-mesh — Unified Commander CLI Engine
 *
 * Exposes "peer", "skill", "collab", "call", and "mesh" subcommands.
 */
import { Command } from 'commander'
import { WebMcpBridgeClient } from '@oa-sdk/peer-transport'
import { SkillRegistry } from '../skill-registry.js'
import { MeshRouter } from '../mesh-router.js'
import { registerPeerCommands } from './commands/peer.js'
import { registerSkillCommands } from './commands/skill.js'
import { registerCollabCommands } from './commands/collab.js'
import { registerCallCommands } from './commands/call.js'
import { registerMeshCommands } from './commands/mesh.js'
import type { CliContext, MeshCliOptions } from './types.js'

export * from './types.js'
export * from './formatters.js'

export function createMeshCli(options: MeshCliOptions = {}): Command {
  const program = new Command()

  program
    .name(options.name ?? 'oa-mesh')
    .version(options.version ?? '0.1.0')
    .description(
      options.description ??
        'Universal Multi-MCP Mesh, 1:N Domain Skill Registry & Real-time Collab CLI',
    )

  // Global options
  program
    .option('-o, --output <format>', 'Output format (json, table)', 'table')
    .option('--debug', 'Enable debug output', false)
    .option('--bridge <url>', 'Local WebMCP bridge server URL', options.serverUrl ?? 'http://127.0.0.1:8787')
    .option('--auth-token <token>', 'Bearer token for an authenticated bridge (or WEBMCP_AUTH_TOKEN)', undefined)
    .option('--store <path>', 'Custom path to ~/.webmcp/peers.json registry', options.storePath)

  const registry = options.registry ?? new SkillRegistry()
  const router = options.router ?? new MeshRouter(registry)

  // Factory for CLI context bound to latest parsed global options
  const getContext = (): CliContext => {
    const opts = program.opts()
    const serverUrl = (opts.bridge as string) ?? options.serverUrl ?? 'http://127.0.0.1:8787'
    const authToken = (opts.authToken as string | undefined) ?? options.authToken ?? process.env.WEBMCP_AUTH_TOKEN
    const storePath = (opts.store as string) ?? options.storePath
    const bridgeClient =
      options.bridgeClient ??
      new WebMcpBridgeClient({
        serverUrl,
        ...(authToken ? { authToken } : {}),
        ...(storePath ? { storePath } : {}),
      })

    return {
      registry,
      router,
      bridgeClient,
      serverUrl,
      ...(storePath ? { storePath } : {}),
      getOutputFormat: () => (opts.output as 'json' | 'table') ?? 'table',
      isDebug: () => Boolean(opts.debug),
    }
  }

  // Lazy proxy context so subcommands evaluate global options dynamically
  const ctx: CliContext = {
    get registry() {
      return getContext().registry
    },
    get router() {
      return getContext().router
    },
    get bridgeClient() {
      return getContext().bridgeClient
    },
    get serverUrl() {
      return getContext().serverUrl
    },
    get storePath() {
      return getContext().storePath
    },
    getOutputFormat: () => getContext().getOutputFormat(),
    isDebug: () => getContext().isDebug(),
  }

  // Register command groups
  registerPeerCommands(program, ctx)
  registerSkillCommands(program, ctx)
  registerCollabCommands(program, ctx)
  registerCallCommands(program, ctx)
  registerMeshCommands(program, ctx)

  return program
}
