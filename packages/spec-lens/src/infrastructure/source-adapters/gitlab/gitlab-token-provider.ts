import { execFileSync } from 'node:child_process'
import type { TokenProvider } from '../github/token-provider.js'

export class GitlabTokenProvider implements TokenProvider {
  async getToken(_repoKey: string): Promise<string> {
    const envToken =
      process.env['GITLAB_TOKEN'] ??
      process.env['GL_TOKEN'] ??
      process.env['CI_JOB_TOKEN']
    if (envToken !== undefined && envToken.length > 0) return envToken

    const cliToken = invokeGlabCli()
    if (cliToken !== undefined) return cliToken

    throw new Error(
      'No GitLab token found. Set GITLAB_TOKEN env var or run `glab auth login`.',
    )
  }
}

function invokeGlabCli(): string | undefined {
  try {
    const result = execFileSync('glab', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const token = result.trim()
    return token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}
