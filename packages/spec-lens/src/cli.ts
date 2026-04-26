#!/usr/bin/env node
import { resolve, join, dirname } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { loadDefinitionTargetConfig } from '@oa-sdk/codegen/spec-lens'
import { buildTargetConfigDigest } from './infrastructure/cache/sqlite/cache-key.js'
import { SqliteCache } from './infrastructure/cache/sqlite/sqlite-cache.js'
import { SnapshotBuilder } from './infrastructure/snapshot-engine/snapshot-builder.js'
import { GithubAdapter } from './infrastructure/source-adapters/github/github.adapter.js'
import { GitlabAdapter } from './infrastructure/source-adapters/gitlab/gitlab.adapter.js'
import { DefaultTokenProvider } from './infrastructure/source-adapters/github/token-provider.js'
import { LocalGitAdapter } from './infrastructure/source-adapters/local-git/local-git.adapter.js'
import { serveSpecLens } from './presentation/http/server.js'

type CliConfig = {
  source: 'github' | 'gitlab' | 'local-git'
  github?: { owner: string; repo: string; branch?: string }
  gitlab?: { host?: string; projectId: string | number }
  localGit?: { repoPath?: string }
  fragmentsDir: string
  targetPath: string
  port?: number
  dbPath?: string
  branch?: string
}

function findConfig(): CliConfig | null {
  const candidates = [
    'spec-lens.config.yaml',
    'spec-lens.config.yml',
    'spec-lens.config.json',
  ]
  for (const name of candidates) {
    const p = resolve(process.cwd(), name)
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf8')
      return (name.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as CliConfig
    }
  }
  return null
}

function autoDetectConfig(): CliConfig {
  // Try to find a target yaml in common locations
  const candidates = [
    'packages/schemas/src/targets/book-notebook-api.yaml',
    'packages/schemas/src/targets/admin-api.yaml',
  ]
  for (const rel of candidates) {
    const full = resolve(process.cwd(), rel)
    if (existsSync(full)) {
      const fragmentsDir = resolve(dirname(full), '..', 'fragments')
      return {
        source: 'local-git',
        localGit: { repoPath: process.cwd() },
        fragmentsDir: fragmentsDir.replace(process.cwd() + '/', ''),
        targetPath: rel,
        port: 4891,
        dbPath: '.spec-lens.db',
      }
    }
  }
  throw new Error(
    'No spec-lens.config.yaml found and could not auto-detect target.\n' +
    'Create spec-lens.config.yaml in your project root. See example:\n\n' +
    'source: local-git\n' +
    'fragmentsDir: packages/schemas/src/fragments\n' +
    'targetPath: packages/schemas/src/targets/book-notebook-api.yaml\n' +
    'port: 4891\n',
  )
}

async function main() {
  const cfg = findConfig() ?? autoDetectConfig()
  const port = cfg.port ?? 4891
  const dbPath = resolve(process.cwd(), cfg.dbPath ?? '.spec-lens.db')
  // fragmentsDir: keep as configured (repo-relative) — remote adapters require relative paths
  const fragmentsDir = cfg.fragmentsDir.replace(/\/$/, '')
  const targetPath = resolve(process.cwd(), cfg.targetPath)

  console.log('spec-lens server starting…')
  console.log(`  source:       ${cfg.source}`)
  console.log(`  fragmentsDir: ${fragmentsDir}`)
  console.log(`  targetPath:   ${targetPath}`)
  console.log(`  db:           ${dbPath}`)
  console.log(`  port:         ${port}`)

  const targetConfig = loadDefinitionTargetConfig(targetPath)
  const cache = new SqliteCache(dbPath)
  const builder = new SnapshotBuilder()

  let source
  if (cfg.source === 'github') {
    if (!cfg.github) throw new Error('github config required when source=github')
    source = new GithubAdapter({
      owner: cfg.github.owner,
      repo: cfg.github.repo,
      tokenProvider: new DefaultTokenProvider(),
    })
  } else if (cfg.source === 'gitlab') {
    if (!cfg.gitlab) throw new Error('gitlab config required when source=gitlab')
    source = new GitlabAdapter({
      ...(cfg.gitlab.host !== undefined ? { host: cfg.gitlab.host } : {}),
      projectId: cfg.gitlab.projectId,
      tokenProvider: new DefaultTokenProvider(),
    })
  } else {
    source = new LocalGitAdapter({
      repoPath: cfg.localGit?.repoPath
        ? resolve(process.cwd(), cfg.localGit.repoPath)
        : process.cwd(),
    })
  }

  serveSpecLens({
    source,
    cache,
    builder,
    fragmentsDir,
    targetPath,
    targetConfig,
    ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
    port,
  })
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
