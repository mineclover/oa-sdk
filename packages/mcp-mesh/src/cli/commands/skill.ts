/**
 * @oa-sdk/mcp-mesh — CLI "skill" Command Group
 *
 * Enforces the 1:N Domain Skill vs Runtime Session Instance Invariant:
 * Replicating sessions (e.g. wireframe-local, wireframe-tab-2) map to 1 DomainSkill.
 */
import { Command } from 'commander'
import { formatOutput } from '../formatters.js'
import type { CliContext } from '../types.js'

export function registerSkillCommands(program: Command, ctx: CliContext): void {
  const skillCmd = program.command('skill').description('Manage 1:N Domain Skills and WebMCP tool hydration')

  // skill list
  skillCmd
    .command('list')
    .description('List registered canonical Domain Skills and their bound runtime session instances')
    .action(() => {
      const format = ctx.getOutputFormat()
      const skills = ctx.registry.listDomainSkills()

      if (format === 'json') {
        const payload = skills.map((s) => {
          const sessions = ctx.registry.getSessionsForDomain(s.domain)
          const activeSession = ctx.registry.getActiveSession(s.domain)
          return {
            domain: s.domain,
            name: s.name,
            version: s.version,
            description: s.description,
            toolsCount: s.tools.length,
            tools: s.tools.map((t) => t.name),
            activeSessionId: activeSession?.sessionId ?? null,
            sessions: sessions.map((sess) => ({
              sessionId: sess.sessionId,
              alias: sess.alias,
              status: sess.status,
              transportType: sess.transportType,
              isActive: sess.sessionId === activeSession?.sessionId,
            })),
          }
        })
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      if (skills.length === 0) {
        console.log('No Domain Skills registered. Use "oa-mesh skill pull <peer>" to hydrate from WebMCP.')
        return
      }

      console.log('=== Domain Skills (1 Domain Skill <---> N Runtime Sessions) ===\n')
      for (const s of skills) {
        const sessions = ctx.registry.getSessionsForDomain(s.domain)
        const activeSession = ctx.registry.getActiveSession(s.domain)

        console.log(`🔷 Domain: ${s.domain} (${s.name} v${s.version})`)
        console.log(`   Description: ${s.description}`)
        console.log(`   Tools (${s.tools.length}): ${s.tools.map((t) => t.name).join(', ')}`)
        console.log(`   Bound Sessions (${sessions.length}):`)

        if (sessions.length === 0) {
          console.log(`     (no active sessions connected)`)
        } else {
          for (const sess of sessions) {
            const isActive = sess.sessionId === activeSession?.sessionId
            const marker = isActive ? '★ [ACTIVE]' : '  [STANDBY]'
            console.log(
              `     ${marker} ${sess.alias} (id: ${sess.sessionId}, transport: ${sess.transportType}, status: ${sess.status})`,
            )
          }
        }
        console.log('')
      }
    })

  // skill pull <peer>
  skillCmd
    .command('pull <peer>')
    .description('Download WebMCP tool catalog from peer and hydrate into 1:N canonical DomainSkill')
    .action(async (peerAlias: string) => {
      try {
        let peer = await ctx.bridgeClient.resolvePeer(peerAlias)

        if (!peer) {
          // Attempt fetching tools directly from bridge server
          const tools = await ctx.bridgeClient.listTools(peerAlias)
          if (tools.length > 0) {
            peer = {
              alias: peerAlias,
              title: `${peerAlias} WebMCP`,
              cachedTools: tools,
              status: 'connected',
            }
          }
        }

        if (!peer) {
          throw new Error(`Peer "${peerAlias}" not found in local registry or bridge server`)
        }

        const { skill, session } = ctx.registry.hydratePeerSession(peer, ctx.bridgeClient)

        console.log(`✅ Successfully hydrated WebMCP Skill:`)
        console.log(`   Domain:        ${skill.domain}`)
        console.log(`   Domain Name:   ${skill.name}`)
        console.log(`   Bound Session: ${session.alias} (transport: ${session.transportType})`)
        console.log(`   Total Tools:   ${skill.tools.length}`)
        console.log(`   Tools:         ${skill.tools.map((t) => t.name).join(', ')}`)
      } catch (err: any) {
        console.error(`Failed to pull skill: ${err.message ?? err}`)
        if (ctx.isDebug()) console.error(err)
        process.exit(1)
      }
    })

  // skill inspect <domain>
  skillCmd
    .command('inspect <domain>')
    .description('Inspect detailed tools, input schemas, instructions, and workspace scoping rules')
    .action((domain: string) => {
      const format = ctx.getOutputFormat()
      const skill = ctx.registry.getDomainSkill(domain)

      if (!skill) {
        console.error(`Domain Skill "${domain}" not found. Run "oa-mesh skill list" to see registered domains.`)
        process.exit(1)
      }

      if (format === 'json') {
        const payload = {
          domain: skill.domain,
          name: skill.name,
          version: skill.version,
          description: skill.description,
          instructions: skill.instructions ?? null,
          workspaceRules: skill.workspaceRules ?? null,
          tools: skill.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        }
        console.log(JSON.stringify(payload, null, 2))
        return
      }

      console.log(`=== Domain Skill: ${skill.domain} ===`)
      console.log(`Name:        ${skill.name} (v${skill.version})`)
      console.log(`Description: ${skill.description}`)
      if (skill.instructions) {
        console.log(`\nInstructions:\n${skill.instructions}`)
      }
      if (skill.workspaceRules) {
        console.log(`\nWorkspace Rules:`)
        console.log(`  Allowed Paths: ${skill.workspaceRules.allowedPaths?.join(', ') ?? 'all'}`)
        console.log(`  Read-Only:     ${skill.workspaceRules.readOnly ? 'Yes' : 'No'}`)
      }

      console.log(`\nTools (${skill.tools.length}):`)
      for (const t of skill.tools) {
        console.log(`\n  ⚙️  ${t.name}`)
        console.log(`     Description: ${t.description}`)
        console.log(`     Schema:      ${JSON.stringify(t.inputSchema)}`)
      }
    })
}
