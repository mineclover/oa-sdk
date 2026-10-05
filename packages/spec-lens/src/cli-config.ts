/**
 * spec-lens CLI configuration contract (spec-lens.config.{yaml,yml,json}).
 *
 * The schema checks what the CLI reads and nothing more:
 * - Only the section of the selected `source` is read and validated; the
 *   `github`, `gitlab`, and `localGit` sections of other sources are ignored.
 * - A key the schema reads with an empty value (`key:` in YAML, for example
 *   when every line under it is commented out) decodes as `null` and counts
 *   as not set.
 * - `project`, `fragmentsDir`, and `targetPath` are passed through unchanged
 *   for resolveSpecProjectConfig, which validates the project selection.
 */

export type GithubSourceConfig = { owner: string; repo: string; branch?: string; host?: string; repoCache?: string }
export type GitlabSourceConfig = { host?: string; projectId: string | number }
export type LocalGitSourceConfig = { repoPath?: string }

/** The source revisions are read from, with the section that configures it. */
export type CliSourceConfig =
  | { source: 'local-git'; localGit?: LocalGitSourceConfig }
  | { source: 'github'; github: GithubSourceConfig }
  | { source: 'gitlab'; gitlab: GitlabSourceConfig }

export type CliConfig = CliSourceConfig & {
  /** Project selection inputs, validated by resolveSpecProjectConfig. */
  project?: unknown
  fragmentsDir?: unknown
  targetPath?: unknown
  port?: number
  dbPath?: string
  branch?: string
}

type ConfigRecord = Record<string, unknown>

function isConfigObject(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnset(value: unknown): value is null | undefined {
  return value === undefined || value === null
}

function configObject(value: unknown, path: string): ConfigRecord {
  if (!isConfigObject(value)) throw new Error(`${path} must be a mapping`)
  return value
}

/** A section the selected source cannot run without. */
function requiredSection(record: ConfigRecord, key: string, path: string, source: string): ConfigRecord {
  const value = record[key]
  if (isUnset(value)) throw new Error(`${path}.${key} is required when source is ${source}`)
  return configObject(value, `${path}.${key}`)
}

/** `{ [key]: value }` for a string value, `{}` when the key is not set. */
function optionalString<K extends string>(record: ConfigRecord, key: K, path: string): Partial<Record<K, string>> {
  const value = record[key]
  const entry: Partial<Record<K, string>> = {}
  if (isUnset(value)) return entry
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  entry[key] = value
  return entry
}

function requiredString(record: ConfigRecord, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string`)
  return value
}

/**
 * The listening port. A numeric string is accepted as Node's `listen` accepts
 * it, so a quoted `port: "4891"` keeps working.
 */
function optionalPort(record: ConfigRecord, path: string): { port?: number } {
  const value = record.port
  if (isUnset(value)) return {}
  const port = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${path}.port must be an integer from 0 to 65535`)
  }
  return { port }
}

function parseSource(root: ConfigRecord): CliSourceConfig {
  const source = isUnset(root.source) ? 'local-git' : root.source
  if (source === 'local-git') {
    if (isUnset(root.localGit)) return { source }
    const localGit = configObject(root.localGit, 'config.localGit')
    return { source, localGit: optionalString(localGit, 'repoPath', 'config.localGit') }
  }
  if (source === 'github') {
    const github = requiredSection(root, 'github', 'config', source)
    return {
      source,
      github: {
        owner: requiredString(github, 'owner', 'config.github'),
        repo: requiredString(github, 'repo', 'config.github'),
        ...optionalString(github, 'branch', 'config.github'),
        ...optionalString(github, 'host', 'config.github'),
        ...optionalString(github, 'repoCache', 'config.github'),
      },
    }
  }
  if (source === 'gitlab') {
    const gitlab = requiredSection(root, 'gitlab', 'config', source)
    const projectId = gitlab.projectId
    if (typeof projectId !== 'string' && typeof projectId !== 'number') {
      throw new Error('config.gitlab.projectId must be a string or number')
    }
    return { source, gitlab: { projectId, ...optionalString(gitlab, 'host', 'config.gitlab') } }
  }
  throw new Error('config.source must be one of local-git, github, gitlab')
}

/** spec-lens.config.{yaml,yml,json} as a mapping. */
export const CliConfigSchema = {
  parse(value: unknown): CliConfig {
    const root = configObject(value, 'config')
    return {
      ...parseSource(root),
      ...(root.project === undefined ? {} : { project: root.project }),
      ...(root.fragmentsDir === undefined ? {} : { fragmentsDir: root.fragmentsDir }),
      ...(root.targetPath === undefined ? {} : { targetPath: root.targetPath }),
      ...optionalPort(root, 'config'),
      ...optionalString(root, 'dbPath', 'config'),
      ...optionalString(root, 'branch', 'config'),
    }
  },
}

/**
 * A whole spec-lens.config document. An empty document (a YAML file with no
 * content or only comments, or JSON `null`) carries no configuration, so it
 * yields `null` and the CLI auto-detects the project as it does without a file.
 */
export const CliConfigDocumentSchema = {
  parse(value: unknown): CliConfig | null {
    return isUnset(value) ? null : CliConfigSchema.parse(value)
  },
}
