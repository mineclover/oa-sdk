/**
 * @oa-sdk/mcp-mesh — Multi-MCP Unified Router & Meta-Skill Dispatcher
 */
import { defineTool, type ToolDefinition } from '@oa-sdk/tools'
import { SkillRegistry } from './skill-registry.js'
import type { MeshRoutingDecision, MetaSkillDefinition } from './types.js'
import { assertToolInput, validateMeshIdentifier, validateMetaSkill } from './security.js'

export class MeshRouter {
  readonly registry: SkillRegistry
  private metaSkills = new Map<string, MetaSkillDefinition>()

  constructor(registry = new SkillRegistry()) {
    this.registry = registry
  }

  /**
   * Register a composite Meta-Skill
   */
  registerMetaSkill(metaSkill: MetaSkillDefinition): this {
    validateMetaSkill(metaSkill)
    this.metaSkills.set(metaSkill.name, metaSkill)
    return this
  }

  /**
   * Resolve a tool invocation route: finds domain, active session, and tool name
   */
  resolveRoute(invokedName: string): MeshRoutingDecision | null {
    if (typeof invokedName !== 'string' || invokedName.length === 0 || invokedName.length > 256) return null
    // 1. Check namespaced format: "{domain}__{toolName}"
    if (invokedName.includes('__')) {
      const [domain, toolName] = invokedName.split('__', 2)
      if (domain && toolName && `${domain}__${toolName}` === invokedName) {
        try {
          validateMeshIdentifier(domain, 'domain')
          validateMeshIdentifier(toolName, 'tool name')
        } catch {
          return null
        }
        const session = this.registry.getActiveSession(domain)
        if (session && this.registry.getTool(domain, toolName)) {
          return { domain, session, toolName }
        }
      }
    }

    // 2. Search across all registered domains for matching tool name
    let match: MeshRoutingDecision | null = null
    for (const skill of this.registry.listDomainSkills()) {
      const hasTool = skill.tools.some((t) => t.name === invokedName)
      if (hasTool) {
        const session = this.registry.getActiveSession(skill.domain)
        if (session) {
          // Bare names are only safe when they resolve to one domain. An
          // ambiguous bare call must be explicitly namespaced by the caller.
          if (match) return null
          match = { domain: skill.domain, session, toolName: invokedName }
        }
      }
    }
    return match
  }

  /**
   * Dispatch a tool call through the mesh to the appropriate active session
   */
  async dispatchTool(invokedName: string, args: unknown = {}): Promise<unknown> {
    const route = this.resolveRoute(invokedName)
    if (!route) {
      throw new Error(`Cannot route tool "${invokedName}": no active session found for its domain`)
    }

    const input = assertToolInput(this.registry.getTool(route.domain, route.toolName)!, args)
    return route.session.callTool(route.toolName, input)
  }

  /**
   * Verify whether a Meta-Skill's required domains are all satisfied by active sessions
   */
  checkMetaSkillReadiness(metaSkillName: string): { ready: boolean; missingDomains: string[] } {
    const meta = this.metaSkills.get(metaSkillName)
    if (!meta) {
      throw new Error(`Meta-Skill "${metaSkillName}" is not registered`)
    }

    const missingDomains: string[] = []
    for (const domain of meta.requiresDomains) {
      const active = this.registry.getActiveSession(domain)
      if (!active) {
        missingDomains.push(domain)
      }
    }

    return {
      ready: missingDomains.length === 0,
      missingDomains,
    }
  }

  /**
   * Flatten all tools across all active domain skills into unified ToolDefinitions,
   * namespaced as "{domain}__{tool}" as well as bare names if unique.
   */
  getAggregatedTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    const skills = this.registry.listDomainSkills()
    const domainsByTool = new Map<string, Set<string>>()

    // Decide which bare aliases are safe before constructing any definitions.
    // Registering while iterating used to emit duplicate names; MCP registries
    // generally keep the last definition, making dispatch depend on iteration
    // order.
    for (const skill of skills) {
      for (const tool of skill.tools) {
        const domains = domainsByTool.get(tool.name) ?? new Set<string>()
        domains.add(skill.domain)
        domainsByTool.set(tool.name, domains)
      }
    }

    for (const skill of skills) {
      for (const t of skill.tools) {
        const namespacedName = `${skill.domain}__${t.name}`

        // Mesh tools forward input unchanged; dispatchTool validates it
        // against the owning domain tool's schema before routing.
        const metadata = {
          inputSchema: t.inputSchema,
          ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
          ...(t.hints !== undefined ? { hints: t.hints } : {}),
        }

        // Register namespaced version
        tools.push(defineTool({
          name: namespacedName,
          description: `[${skill.domain}] ${t.description}`,
          ...metadata,
          execute: async (_ctx, input: unknown) => this.dispatchTool(namespacedName, input),
        }))

        // A bare name is safe only when exactly one domain owns it.
        if ((domainsByTool.get(t.name)?.size ?? 0) === 1) {
          tools.push(defineTool({
            name: t.name,
            description: t.description,
            ...metadata,
            execute: async (_ctx, input: unknown) => this.dispatchTool(t.name, input),
          }))
        }
      }
    }

    return tools
  }
}
