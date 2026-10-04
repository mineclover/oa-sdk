/**
 * @oa-sdk/mcp-mesh — CLI "collab" Command Group
 *
 * Manages Folder-level CRDT concurrent editing and AI First-Class Co-Editor.
 */
import { Command } from 'commander'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { WorkspaceSyncer } from '@oa-sdk/collab-workspace'
import { formatOutput } from '../formatters.js'
import type { CliContext } from '../types.js'

export function registerCollabCommands(program: Command, ctx: CliContext): void {
  const collabCmd = program
    .command('collab')
    .description('Manage real-time folder CRDT synchronization and AI Co-Editor')

  // collab start <folder>
  collabCmd
    .command('start <folder>')
    .description('Start real-time CRDT tree-lattice file synchronization on a local target folder')
    .option('--ai <model>', 'Attach an AI First-Class Co-Editor actor (e.g. gemini-3.8, claude-3.7)')
    .option('--client-id <id>', 'Local editor client ID', 'client:human:local-user')
    .option('--read-only', 'Mount workspace in read-only observation mode', false)
    .action(async (folder: string, opts) => {
      const rootDir = folder
      if (!existsSync(rootDir)) {
        console.error(`Folder "${rootDir}" does not exist.`)
        process.exit(1)
      }

      const syncer = new WorkspaceSyncer({
        rootPath: rootDir,
        workspaceId: 'local-workspace',
        clientId: opts.clientId,
        role: 'human',
      })

      // Scan initial files into lattice
      let fileCount = 0
      async function scanDir(currentDir: string) {
        const entries = await readdir(currentDir, { withFileTypes: true })
        for (const ent of entries) {
          if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') continue
          const full = join(currentDir, ent.name)
          if (ent.isDirectory()) {
            await scanDir(full)
          } else if (ent.isFile()) {
            const rel = relative(rootDir, full)
            try {
              const content = await readFile(full, 'utf-8')
              syncer.applyHumanEdit(rel, content)
              fileCount++
            } catch {}
          }
        }
      }

      await scanDir(rootDir)

      console.log(`🚀 [Collab] Real-time Workspace CRDT Syncer active:`)
      console.log(`   Target Folder:  ${rootDir}`)
      console.log(`   Client ID:      ${opts.clientId}`)
      console.log(`   Indexed Files:  ${fileCount}`)
      console.log(`   Merge Algebra:  Semi-Lattice (A ⊔ B = B ⊔ A, Conflict-Free)`)

      // If AI Co-Editor requested
      if (opts.ai) {
        const aiActor = syncer.createAiEditor(opts.ai, `AI Co-Editor (${opts.ai})`)
        console.log(`🤖 [Collab] AI 1st-Class Co-Editor attached:`)
        console.log(`   Client ID:      ${aiActor.clientId}`)
        console.log(`   Model:          ${aiActor.modelName}`)
        console.log(`   IntentLock:     Enabled (Visual range protection & cursor reservation)`)
      }

      console.log('\nListening for file events and peer deltas. Press Ctrl+C to terminate.')

      const onSignal = () => {
        console.log('\n[Collab] Stopping workspace syncer...')
        process.exit(0)
      }
      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
    })

  // collab status
  collabCmd
    .command('status')
    .description('View active IntentLocks, connected editors, and workspace presence')
    .action(() => {
      const format = ctx.getOutputFormat()
      // In standalone CLI call, report demo diagnostic state
      const result = {
        collabEngine: '@oa-sdk/collab-workspace',
        semiLatticeJoin: 'active',
        activePresences: [
          { clientId: 'client:human:local-user', role: 'human', name: 'local-user', status: 'online' },
        ],
        activeIntentLocks: [],
      }

      console.log(formatOutput(result, format))
    })
}
