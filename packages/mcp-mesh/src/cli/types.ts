/**
 * @oa-sdk/mcp-mesh — CLI Types & Context
 */
import type { SkillRegistry } from '../skill-registry.js'
import type { MeshRouter } from '../mesh-router.js'
import type { WebMcpBridgeClient } from '@oa-sdk/peer-transport'

export interface CliContext {
  registry: SkillRegistry
  router: MeshRouter
  bridgeClient: WebMcpBridgeClient
  serverUrl: string
  storePath?: string | undefined
  getOutputFormat: () => 'json' | 'table'
  isDebug: () => boolean
}

export interface MeshCliOptions {
  name?: string | undefined
  version?: string | undefined
  description?: string | undefined
  serverUrl?: string | undefined
  /** Bearer token for an authenticated peer-server. */
  authToken?: string | undefined
  storePath?: string | undefined
  registry?: SkillRegistry | undefined
  router?: MeshRouter | undefined
  bridgeClient?: WebMcpBridgeClient | undefined
}
