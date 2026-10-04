/**
 * @oa-sdk/mcp-mesh — CLI "mesh" Command Group
 *
 * Overview of Multi-MCP cluster and composite Meta-Skill verification.
 */
import { Command } from 'commander'
import { formatOutput } from '../formatters.js'
import type { CliContext } from '../types.js'

export function registerMeshCommands(program: Command, ctx: CliContext): void {
  const meshCmd = program.command('mesh').description('Inspect Multi-MCP cluster status and Meta-Skill readiness')

  // mesh status
  meshCmd
    .command('status')
    .description('Overview of all registered domain skills, active sessions, and meta-skills in the mesh')
    .action(() => {
      const format = ctx.getOutputFormat()
      const domains = ctx.registry.listDomainSkills()
      let totalSessions = 0
      let totalTools = 0

      for (const d of domains) {
        totalTools += d.tools.length
        totalSessions += ctx.registry.getSessionsForDomain(d.domain).length
      }

      const summary = {
        totalDomains: domains.length,
        totalSessions,
        totalTools,
        domains: domains.map((d) => ({
          domain: d.domain,
          name: d.name,
          toolsCount: d.tools.length,
          activeSession: ctx.registry.getActiveSession(d.domain)?.alias ?? 'none',
          totalSessions: ctx.registry.getSessionsForDomain(d.domain).length,
        })),
      }

      console.log(formatOutput(summary, format))
    })

  // mesh meta
  const metaCmd = meshCmd.command('meta').description('Manage composite Meta-Skills')

  metaCmd
    .command('check <name>')
    .description('Verify whether all required domain skills are satisfied by active sessions for a Meta-Skill')
    .action((name: string) => {
      const format = ctx.getOutputFormat()
      try {
        const readiness = ctx.router.checkMetaSkillReadiness(name)
        if (format === 'json') {
          console.log(JSON.stringify(readiness, null, 2))
          return
        }

        if (readiness.ready) {
          console.log(`✅ Meta-Skill "${name}" is READY: all required domains have active sessions.`)
        } else {
          console.log(`❌ Meta-Skill "${name}" is NOT READY: missing active sessions for domains:`)
          for (const d of readiness.missingDomains) {
            console.log(`   - ${d}`)
          }
        }
      } catch (err: any) {
        console.error(`Meta-Skill check error: ${err.message ?? err}`)
        process.exit(1)
      }
    })
}
