/**
 * @oa-sdk/mcp-mesh — CLI "peer" Command Group
 */
import { Command } from 'commander'
import { createPeerServer } from '@oa-sdk/peer-server'
import { FilePeerStore } from '@oa-sdk/peer-server'
import { formatOutput } from '../formatters.js'
import type { CliContext } from '../types.js'
import { thrownMessage } from '../errors.js'

export function registerPeerCommands(program: Command, ctx: CliContext): void {
  const peerCmd = program.command('peer').description('Manage WebMCP browser peers and signaling daemon')

  // peer list
  peerCmd
    .command('list')
    .description('List all registered WebMCP browser peers, their tools, and connection status')
    .action(async () => {
      const format = ctx.getOutputFormat()
      const peers: Array<Record<string, unknown>> = []

      // 1. Try fetching from live bridge server
      try {
        const status = await ctx.bridgeClient.getStatus()
        if (status.peers && Array.isArray(status.peers)) {
          for (const p of status.peers) {
            peers.push({
              alias: p.alias,
              id: p.id ?? '-',
              status: p.status ?? (status.connected ? 'connected' : 'idle'),
              tools: p.cachedTools?.length ?? status.toolsCount ?? 0,
              origin: p.origin ?? ctx.serverUrl,
              updatedAt: p.updatedAt ? new Date(p.updatedAt).toLocaleTimeString() : '-',
            })
          }
        }
      } catch {
        // Fallback to local store
      }

      // 2. Fallback to ~/.webmcp/peers.json if nothing from server
      if (peers.length === 0) {
        const store = new FilePeerStore(ctx.storePath)
        const data = await store.load()
        for (const [alias, p] of Object.entries(data.peers)) {
          peers.push({
            alias,
            id: p.id ?? '-',
            status: p.status ?? 'idle',
            tools: p.cachedTools?.length ?? 0,
            origin: p.origin ?? '-',
            updatedAt: p.updatedAt ? new Date(p.updatedAt).toLocaleTimeString() : '-',
          })
        }
      }

      console.log(formatOutput(peers, format))
    })

  // peer status
  peerCmd
    .command('status [alias]')
    .description('Inspect real-time diagnostic status of WebMCP bridge and specified peer')
    .action(async (alias?: string) => {
      const targetAlias = alias ?? ctx.bridgeClient.alias
      const format = ctx.getOutputFormat()

      try {
        const status = await ctx.bridgeClient.getStatus()
        const peer = await ctx.bridgeClient.resolvePeer(targetAlias)

        const result = {
          bridgeServerUrl: ctx.serverUrl,
          bridgeOnline: status.ok,
          targetAlias,
          connected: peer?.status === 'connected' || (status.activeAlias === targetAlias && status.connected),
          transportType: peer?.origin?.startsWith('http') ? 'bridge-http' : 'p2p-webrtc',
          toolsCount: peer?.cachedTools?.length ?? status.toolsCount ?? 0,
          cachedTools: peer?.cachedTools?.map((t) => t.name) ?? [],
          invitationUrl: peer?.invitationUrl ?? null,
        }

        console.log(formatOutput(result, format))
      } catch (err: unknown) {
        console.error(`Error checking peer status: ${thrownMessage(err)}`)
        if (ctx.isDebug()) console.error(err)
        process.exit(1)
      }
    })

  // peer server
  const serverCmd = peerCmd.command('server').description('Control local WebMCP Peering & Signaling server')

  serverCmd
    .command('start')
    .description('Start local WebMCP peering server daemon')
    .option('-p, --port <number>', 'Port number to listen on', (val) => Number(val), 8787)
    .option('--host <host>', 'Hostname to bind', '127.0.0.1')
    .action(async (opts) => {
      try {
        const serverInstance = createPeerServer({
          port: opts.port,
          hostname: opts.host,
          storePath: ctx.storePath,
        })

        const res = await serverInstance.start()
        console.log(`[WebMCP] Peering server started on http://${res.hostname}:${res.port}`)
        console.log(`[WebMCP] Home MCP endpoint: http://${res.hostname}:${res.port}/home/mcp`)
        console.log(`[WebMCP] Status endpoint: http://${res.hostname}:${res.port}/status`)

        // Keep process open if running interactively
        const onSignal = async () => {
          console.log('\n[WebMCP] Shutting down peering server...')
          await serverInstance.close()
          process.exit(0)
        }
        process.on('SIGINT', onSignal)
        process.on('SIGTERM', onSignal)
      } catch (err: unknown) {
        console.error(`Failed to start peering server: ${thrownMessage(err)}`)
        if (ctx.isDebug()) console.error(err)
        process.exit(1)
      }
    })
}
