import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface WorkspaceFixtureOptions {
  configType?: 'ts' | 'mjs' | 'json' | 'oarc' | 'none'
  configContent?: string | Record<string, unknown>
  workspaceType?: 'pnpm' | 'turbo' | 'lerna' | 'workspaces' | 'none'
  hasGit?: boolean
  subdirectories?: string[]
  files?: Record<string, string>
}

export interface WorkspaceFixture {
  rootDir: string
  subdirs: Record<string, string>
  cleanup: () => Promise<void>
  writeFile: (relPath: string, content: string) => Promise<void>
  readFile: (relPath: string) => Promise<string>
  exists: (relPath: string) => boolean
}

/**
 * Creates an isolated temporary filesystem fixture representing a monorepo workspace.
 */
export async function createWorkspaceFixture(
  options: WorkspaceFixtureOptions = {},
  prefix = 'oa-e2e-workspace-'
): Promise<WorkspaceFixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  // 1. VCS marker
  if (options.hasGit) {
    const gitDir = path.join(rootDir, '.git')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
  }

  // 2. Monorepo workspace marker
  if (options.workspaceType === 'pnpm') {
    await fs.writeFile(
      path.join(rootDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n",
      'utf8'
    )
  } else if (options.workspaceType === 'turbo') {
    await fs.writeFile(
      path.join(rootDir, 'turbo.json'),
      JSON.stringify({ $schema: 'https://turbo.build/schema.json', tasks: {} }, null, 2),
      'utf8'
    )
  } else if (options.workspaceType === 'lerna') {
    await fs.writeFile(
      path.join(rootDir, 'lerna.json'),
      JSON.stringify({ version: '1.0.0', packages: ['packages/*'] }, null, 2),
      'utf8'
    )
  } else if (options.workspaceType === 'workspaces') {
    await fs.writeFile(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ name: 'fixture-root', private: true, workspaces: ['packages/*'] }, null, 2),
      'utf8'
    )
  }

  // 3. Declarative config file
  if (options.configType === 'ts') {
    const defaultContent = `export default {\n  rootDir: '.', \n  specs: []\n};\n`
    const content = typeof options.configContent === 'string'
      ? options.configContent
      : `export default ${JSON.stringify(options.configContent ?? { rootDir: '.', specs: [] }, null, 2)};\n`
    await fs.writeFile(path.join(rootDir, 'oa.config.ts'), content, 'utf8')
  } else if (options.configType === 'mjs') {
    const content = typeof options.configContent === 'string'
      ? options.configContent
      : `export default ${JSON.stringify(options.configContent ?? { rootDir: '.', specs: [] }, null, 2)};\n`
    await fs.writeFile(path.join(rootDir, 'oa.config.mjs'), content, 'utf8')
  } else if (options.configType === 'json') {
    const content = typeof options.configContent === 'string'
      ? options.configContent
      : JSON.stringify(options.configContent ?? { rootDir: '.', specs: [] }, null, 2)
    await fs.writeFile(path.join(rootDir, 'oa.config.json'), content, 'utf8')
  } else if (options.configType === 'oarc') {
    const content = typeof options.configContent === 'string'
      ? options.configContent
      : JSON.stringify(options.configContent ?? { rootDir: '.', specs: [] }, null, 2)
    await fs.writeFile(path.join(rootDir, '.oarc.json'), content, 'utf8')
  }

  // 4. Subdirectories
  const subdirs: Record<string, string> = {}
  if (options.subdirectories) {
    for (const relSub of options.subdirectories) {
      const fullSub = path.join(rootDir, relSub)
      await fs.mkdir(fullSub, { recursive: true })
      subdirs[relSub] = fullSub
    }
  }

  // 5. Explicit files
  if (options.files) {
    for (const [relFile, content] of Object.entries(options.files)) {
      const fullFile = path.join(rootDir, relFile)
      await fs.mkdir(path.dirname(fullFile), { recursive: true })
      await fs.writeFile(fullFile, content, 'utf8')
    }
  }

  return {
    rootDir,
    subdirs,
    cleanup: async () => {
      if (fsSync.existsSync(rootDir)) {
        await fs.rm(rootDir, { recursive: true, force: true })
      }
    },
    writeFile: async (relPath: string, content: string) => {
      const full = path.join(rootDir, relPath)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
    },
    readFile: async (relPath: string) => {
      return await fs.readFile(path.join(rootDir, relPath), 'utf8')
    },
    exists: (relPath: string) => {
      return fsSync.existsSync(path.join(rootDir, relPath))
    },
  }
}
