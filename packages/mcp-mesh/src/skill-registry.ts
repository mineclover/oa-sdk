/**
 * @oa-sdk/mcp-mesh — 1:N Domain Skill & Session Instance Registry
 *
 * Enforces the invariant: 1 Domain Skill <---> N Runtime MCP Sessions.
 */
import type {
  WebMcpPeerRecord,
  WebMcpBridgeClient,
  CloudTransitClient,
  PeerCallPayload,
  PeerCallResult,
} from '@oa-sdk/peer-transport'
import type { DomainSkillDefinition, McpSessionInstance, McpTransportType } from './types.js'
import { defineTool, type ToolDefinition } from '@oa-sdk/tools'
import { assertToolInput, validateDomainSkill, validateMeshIdentifier, validateSession } from './security.js'

export type PeerToolCaller = {
  callTool<T = unknown>(payload: PeerCallPayload): Promise<PeerCallResult<T>>
}

export class SkillRegistry {
  private skills = new Map<string, DomainSkillDefinition>()
  private sessions = new Map<string, McpSessionInstance>()
  private domainSessions = new Map<string, Set<string>>()
  private activeSessionPerDomain = new Map<string, string>()

  /**
   * Register a canonical domain skill (1 per domain)
   */
  registerDomainSkill(skill: DomainSkillDefinition): this {
    validateDomainSkill(skill)
    this.skills.set(skill.domain, skill)
    if (!this.domainSessions.has(skill.domain)) {
      this.domainSessions.set(skill.domain, new Set())
    }
    return this
  }

  /**
   * Get domain skill by domain name
   */
  getDomainSkill(domain: string): DomainSkillDefinition | undefined {
    return this.skills.get(domain)
  }

  /**
   * List all registered domain skills
   */
  listDomainSkills(): DomainSkillDefinition[] {
    return Array.from(this.skills.values())
  }

  /**
   * Bind an active runtime MCP session instance to its domain
   */
  bindSession(session: McpSessionInstance): this {
    validateSession(session)
    const previous = this.sessions.get(session.sessionId)
    if (previous && previous.domain !== session.domain) {
      this.domainSessions.get(previous.domain)?.delete(session.sessionId)
      if (this.activeSessionPerDomain.get(previous.domain) === session.sessionId) this.activeSessionPerDomain.delete(previous.domain)
    }
    this.sessions.set(session.sessionId, session)

    if (!this.domainSessions.has(session.domain)) {
      this.domainSessions.set(session.domain, new Set())
    }
    this.domainSessions.get(session.domain)!.add(session.sessionId)

    // Default active session if none set or previous disconnected
    const currentActive = this.activeSessionPerDomain.get(session.domain)
    if (!currentActive || this.sessions.get(currentActive)?.status !== 'active') {
      this.activeSessionPerDomain.set(session.domain, session.sessionId)
    }

    return this
  }

  /**
   * Unbind a session instance
   */
  unbindSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    this.sessions.delete(sessionId)
    this.domainSessions.get(session.domain)?.delete(sessionId)

    if (this.activeSessionPerDomain.get(session.domain) === sessionId) {
      // Pick next available active session
      const remaining = Array.from(this.domainSessions.get(session.domain) ?? []).filter((id) => this.sessions.get(id)?.status === 'active')
      if (remaining.length > 0) {
        this.activeSessionPerDomain.set(session.domain, remaining[0]!)
      } else {
        this.activeSessionPerDomain.delete(session.domain)
      }
    }

    return true
  }

  /**
   * Get the active session instance for a domain
   */
  getActiveSession(domain: string): McpSessionInstance | null {
    if (!this.skills.has(domain)) return null
    const activeId = this.activeSessionPerDomain.get(domain)
    if (!activeId) return null
    const active = this.sessions.get(activeId)
    if (active?.status === 'active') return active
    const fallback = this.getSessionsForDomain(domain).find((session) => session.status === 'active')
    if (fallback) this.activeSessionPerDomain.set(domain, fallback.sessionId)
    return fallback ?? null
  }

  /**
   * Explicitly set the active session instance for a domain
   */
  setActiveSession(domain: string, sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.domain !== domain || session.status !== 'active' || !this.skills.has(domain)) return false
    this.activeSessionPerDomain.set(domain, sessionId)
    return true
  }

  /**
   * Get all session instances currently bound to a domain
   */
  getSessionsForDomain(domain: string): McpSessionInstance[] {
    const ids = this.domainSessions.get(domain)
    if (!ids) return []
    const result: McpSessionInstance[] = []
    for (const id of ids) {
      const s = this.sessions.get(id)
      if (s) result.push(s)
    }
    return result
  }

  /**
   * Hydrate a DomainSkill and bind session from a discovered WebMCP Peer
   *
   * Ensures that even if multiple sessions connect (e.g. wireframe-local, wireframe-tab-2),
   * only 1 canonical DomainSkill ('wireframe') is maintained!
   */
  hydratePeerSession(
    peer: WebMcpPeerRecord,
    bridgeClient?: WebMcpBridgeClient | CloudTransitClient | PeerToolCaller,
  ): { skill: DomainSkillDefinition; session: McpSessionInstance } {
    if (!peer || typeof peer !== 'object' || typeof peer.alias !== 'string' || peer.alias.length === 0 || peer.alias.length > 128) {
      throw new TypeError('peer alias is required')
    }
    // 1. Determine canonical domain name (e.g. 'wireframe-local', 'wireframe-cloud' -> 'wireframe')
    const domain = validateMeshIdentifier(peer.alias.replace(/-(local|cloud|relay|session-\d+|tab-\d+|\d+)$/, '').toLowerCase(), 'domain')

    // 2. Fetch or create the canonical DomainSkill
    let skill = this.skills.get(domain)
    const peerTools = peer.cachedTools ?? []
    if (!Array.isArray(peerTools) || peerTools.length > 1024) throw new Error('peer tool catalog is invalid')
    const allowedTools = peer.allowedTools ? new Set(peer.allowedTools) : null
    const peerToolNames = new Set<string>()
    for (const tool of peerTools) {
      if (!tool || typeof tool.name !== 'string') throw new Error('peer tool entry is invalid')
      validateMeshIdentifier(tool.name, 'peer tool name')
      peerToolNames.add(tool.name)
      if (tool.description !== undefined && typeof tool.description !== 'string') throw new Error('peer tool description is invalid')
      if (tool.inputSchema !== undefined && (typeof tool.inputSchema !== 'object' || tool.inputSchema === null || Array.isArray(tool.inputSchema))) throw new Error('peer tool schema is invalid')
      if (allowedTools && !allowedTools.has(tool.name)) throw new Error(`peer catalog contains tool not in allowedTools: ${tool.name}`)
    }

    if (!skill) {
      const tools = peerTools.map((t) =>
        defineTool({
          name: t.name,
          description: t.description ?? `Tool ${t.name}`,
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          execute: async (_ctx, input) => {
            const activeSession = this.getActiveSession(domain)
            if (!activeSession) {
              throw new Error(`No active session available for domain "${domain}"`)
            }
            return activeSession.callTool(t.name, input)
          },
        }),
      )

      skill = {
        domain,
        name: peer.title ?? `${domain.toUpperCase()} Domain Skill`,
        version: '1.0.0',
        description: `Unified ${domain} domain skill hydrated from WebMCP`,
        instructions: peer.skillManifest?.instructions ?? `Use this skill to interact with ${domain} operations.`,
        tools,
      }
      this.registerDomainSkill(skill)
    } else {
      // Merge any new tools into existing domain skill without duplicates
      for (const t of peerTools) {
        if (!skill.tools.some((existing) => existing.name === t.name)) {
          skill.tools.push(
            defineTool({
              name: t.name,
              description: t.description ?? `Tool ${t.name}`,
              inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
              execute: async (_ctx, input) => {
                const activeSession = this.getActiveSession(domain)
                if (!activeSession) {
                  throw new Error(`No active session available for domain "${domain}"`)
                }
                return activeSession.callTool(t.name, input)
              },
            }),
          )
        }
      }
    }

    // 3. Create and bind runtime McpSessionInstance
    const sessionId = validateMeshIdentifier(peer.id ?? peer.alias, 'session id')
    const peerStatus = peer.status === 'connected' || peer.status === 'ready' ? 'active' : peer.status === 'disconnected' ? 'disconnected' : 'idle'
    const isCloudTransit = peer.origin?.includes('/transit/') || (Boolean(bridgeClient) && typeof bridgeClient === 'object' && 'peerAlias' in (bridgeClient as Record<string, unknown>))
    const inferredTransport: McpTransportType = isCloudTransit
      ? 'cloud-transit'
      : peer.origin?.startsWith('http')
        ? 'bridge-http'
        : 'p2p-webrtc'

    const session: McpSessionInstance = {
      sessionId,
      domain,
      alias: peer.alias,
      transportType: inferredTransport,
      endpointUrl: peer.invitationUrl ?? peer.signalingUrl,
      status: peer.status === undefined ? 'active' : peerStatus,
      callTool: async (toolName, args) => {
        if (!peerToolNames.has(toolName) || (allowedTools && !allowedTools.has(toolName))) throw new Error(`Tool "${toolName}" is not allowed for peer "${peer.alias}"`)
        const definition = this.getTool(domain, toolName)
        const input = definition ? assertToolInput(definition, args ?? {}) : args
        if (bridgeClient) {
          const res = await bridgeClient.callTool({
            tool: toolName,
            args: input as Record<string, unknown> | undefined,
            peer: peer.alias,
            sessionId: peer.id,
          })
          if (res.isError) throw new Error(res.error)
          return res.result
        }
        throw new Error(`No bridgeClient provided for session "${sessionId}"`)
      },
    }

    this.bindSession(session)
    return { skill, session }
  }

  /** Return the canonical tool definition for authorization and validation. */
  getTool(domain: string, toolName: string): ToolDefinition | undefined {
    const skill = this.skills.get(domain)
    return skill?.tools.find((tool) => tool.name === toolName)
  }
}
