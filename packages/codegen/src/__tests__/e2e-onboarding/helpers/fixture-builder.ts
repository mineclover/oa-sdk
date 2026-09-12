import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface WorkspaceFixtureOptions {
  packageJson?: Record<string, unknown>
  indentation?: '2' | '4' | 'tabs'
  lineEndings?: 'lf' | 'crlf'
  hasBunLock?: boolean
  hasPnpmLock?: boolean
  hasGit?: boolean
  files?: Record<string, string>
}

export interface WorkspaceFixture {
  rootDir: string
  cleanup: () => Promise<void>
  writeFile: (relPath: string, content: string) => Promise<void>
  readFile: (relPath: string) => Promise<string>
  readJson: <T = unknown>(relPath: string) => Promise<T>
  exists: (relPath: string) => boolean
}

/**
 * Creates an isolated temporary filesystem fixture representing a project workspace.
 */
export async function createOnboardingFixture(
  options: WorkspaceFixtureOptions = {},
  prefix = 'oa-onboard-e2e-',
): Promise<WorkspaceFixture> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  // 1. VCS marker
  if (options.hasGit) {
    const gitDir = path.join(rootDir, '.git')
    await fs.mkdir(gitDir, { recursive: true })
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
  }

  // 2. Lockfiles
  if (options.hasBunLock) {
    await fs.writeFile(path.join(rootDir, 'bun.lockb'), '', 'utf8')
  }
  if (options.hasPnpmLock) {
    await fs.writeFile(path.join(rootDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4\n', 'utf8')
  }

  // 3. package.json formatting
  if (options.packageJson) {
    const indent = options.indentation === 'tabs' ? '\t' : options.indentation === '4' ? '    ' : '  '
    let content = JSON.stringify(options.packageJson, null, indent)
    if (options.lineEndings === 'crlf') {
      content = content.replace(/\n/g, '\r\n') + '\r\n'
    } else {
      content = content + '\n'
    }
    await fs.writeFile(path.join(rootDir, 'package.json'), content, 'utf8')
  }

  // 4. Custom files
  if (options.files) {
    for (const [relPath, content] of Object.entries(options.files)) {
      const fullPath = path.join(rootDir, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf8')
    }
  }

  return {
    rootDir,
    cleanup: async () => {
      try {
        await fs.rm(rootDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    },
    writeFile: async (relPath: string, content: string) => {
      const fullPath = path.join(rootDir, relPath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content, 'utf8')
    },
    readFile: async (relPath: string) => {
      return await fs.readFile(path.join(rootDir, relPath), 'utf8')
    },
    readJson: async <T = unknown>(relPath: string): Promise<T> => {
      const raw = await fs.readFile(path.join(rootDir, relPath), 'utf8')
      return JSON.parse(raw) as T
    },
    exists: (relPath: string) => {
      return fsSync.existsSync(path.join(rootDir, relPath))
    },
  }
}
