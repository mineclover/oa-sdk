/**
 * spec-lens CLI configuration contract (spec-lens.config.{yaml,yml,json}).
 */

export type CliConfig = {
  source: 'github' | 'gitlab' | 'local-git'
  github?: { owner: string; repo: string; branch?: string; host?: string; repoCache?: string }
  gitlab?: { host?: string; projectId: string | number }
  localGit?: { repoPath?: string }
  project?: unknown
  fragmentsDir?: string
  targetPath?: string
  port?: number
  dbPath?: string
  branch?: string
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configObject(value: unknown, path: string): Record<string, unknown> {
  if (!isConfigObject(value)) throw new Error(`${path} must be a mapping`)
  return value
}

function optionalConfigString(record: Record<string, unknown>, key: string, path: string): { [key: string]: string } {
  const value = record[key]
  if (value === undefined) return {}
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  return { [key]: value }
}

function requiredConfigString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  return value
}

/** spec-lens.config.{yaml,yml,json}. `project` is validated by resolveSpecProjectConfig. */
export const CliConfigSchema = {
  parse(value: unknown): CliConfig {
    const root = configObject(value, 'config')
    const source = root.source
    if (source !== 'github' && source !== 'gitlab' && source !== 'local-git') {
      throw new Error('config.source must be one of local-git, github, gitlab')
    }
    const config: CliConfig = { source }
    if (root.github !== undefined) {
      const github = configObject(root.github, 'config.github')
      config.github = {
        owner: requiredConfigString(github, 'owner', 'config.github'),
        repo: requiredConfigString(github, 'repo', 'config.github'),
        ...optionalConfigString(github, 'branch', 'config.github'),
        ...optionalConfigString(github, 'host', 'config.github'),
        ...optionalConfigString(github, 'repoCache', 'config.github'),
      }
    }
    if (root.gitlab !== undefined) {
      const gitlab = configObject(root.gitlab, 'config.gitlab')
      const projectId = gitlab.projectId
      if (typeof projectId !== 'string' && typeof projectId !== 'number') {
        throw new Error('config.gitlab.projectId must be a string or number')
      }
      config.gitlab = { projectId, ...optionalConfigString(gitlab, 'host', 'config.gitlab') }
    }
    if (root.localGit !== undefined) {
      config.localGit = optionalConfigString(configObject(root.localGit, 'config.localGit'), 'repoPath', 'config.localGit')
    }
    if (root.project !== undefined) config.project = root.project
    if (root.port !== undefined) {
      if (typeof root.port !== 'number' || !Number.isInteger(root.port)) throw new Error('config.port must be an integer')
      config.port = root.port
    }
    return {
      ...config,
      ...optionalConfigString(root, 'fragmentsDir', 'config'),
      ...optionalConfigString(root, 'targetPath', 'config'),
      ...optionalConfigString(root, 'dbPath', 'config'),
      ...optionalConfigString(root, 'branch', 'config'),
    }
  },
}
