import { execFileSync } from 'node:child_process'

export interface TokenProvider {
  getToken(repoKey: string): Promise<string>
}

export type TokenProviderRule = {
  pattern: string
  source: 'env' | 'gh-cli' | 'explicit'
  envVar?: string
  token?: string
}

export type TokenProviderConfig = {
  rules: TokenProviderRule[]
}

export class DefaultTokenProvider implements TokenProvider {
  constructor(private readonly config: TokenProviderConfig = { rules: [] }) {}

  async getToken(repoKey: string): Promise<string> {
    for (const rule of this.config.rules) {
      if (!matchPattern(rule.pattern, repoKey)) continue
      const token = await resolveRule(rule)
      if (token !== undefined) return token
    }
    // fallback: env → gh-cli
    return await resolveFallback()
  }
}

async function resolveRule(rule: TokenProviderRule): Promise<string | undefined> {
  switch (rule.source) {
    case 'env': {
      const varName = rule.envVar ?? 'GITHUB_TOKEN'
      return process.env[varName]
    }
    case 'gh-cli':
      return invokeGhCli()
    case 'explicit':
      return rule.token
  }
}

async function resolveFallback(): Promise<string> {
  const envToken = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN']
  if (envToken !== undefined && envToken.length > 0) return envToken

  const cliToken = invokeGhCli()
  if (cliToken !== undefined) return cliToken

  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN env var or run `gh auth login`.',
  )
}

function invokeGhCli(): string | undefined {
  try {
    const result = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const token = result.trim()
    return token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

function matchPattern(pattern: string, repoKey: string): boolean {
  if (pattern === '*') return true
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(repoKey)
}
