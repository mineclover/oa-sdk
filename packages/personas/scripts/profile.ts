/**
 * CLI: pnpm profile [list | show <id>]
 *
 * v0.11.5 — saved persona query 조회.
 *   list           → 모든 profile id + 페르소나 수
 *   show <id>      → 단일 profile expand 결과 (markdown)
 */

import { loadAllDomains, loadAllProfiles, loadProfile } from '../src/load.js'
import { expandProfile, renderProfileMarkdown } from '../src/profile.js'

function main(): void {
  const args = process.argv.slice(2)
  const cmd = args[0] ?? 'list'

  const domains = loadAllDomains()
  const allProfiles = loadAllProfiles()
  const profileMap = new Map(allProfiles.map(p => [p.id, p]))

  if (cmd === 'list') {
    console.log(`📋 ${allProfiles.length} profiles\n`)
    for (const p of allProfiles) {
      const expanded = expandProfile(p, { domains, profiles: profileMap })
      const desc = (p.description ?? '').replace(/\n/g, ' ').slice(0, 60)
      console.log(`  ${p.id.padEnd(28)} ${String(expanded.length).padStart(3)} personas  ${desc}`)
    }
    return
  }

  if (cmd === 'show') {
    const id = args[1]
    if (!id) {
      console.error('usage: pnpm profile show <id>')
      process.exit(1)
    }
    const profile = profileMap.get(id) ?? loadProfile(id)
    if (!profile) {
      console.error(`profile '${id}' not found`)
      process.exit(2)
    }
    const expanded = expandProfile(profile, { domains, profiles: profileMap })
    process.stdout.write(renderProfileMarkdown(profile, expanded))
    return
  }

  console.error(`unknown command: ${cmd}`)
  console.error('usage: pnpm profile [list | show <id>]')
  process.exit(1)
}

main()
