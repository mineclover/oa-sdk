#!/usr/bin/env node
import { resolve, join, dirname } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import {
  loadDefinitionTargetConfig,
  resolveSpecLensTypeSpecToolchain,
} from '@oa-sdk/codegen/spec-lens'
import { buildTargetConfigDigest } from './infrastructure/cache/sqlite/cache-key.js'
import { SqliteCache } from './infrastructure/cache/sqlite/sqlite-cache.js'
import { selectSnapshotBuilder } from './infrastructure/snapshot-engine/snapshot-builder-selection.js'
import { GithubAdapter } from './infrastructure/source-adapters/github/github.adapter.js'
import { GitlabAdapter } from './infrastructure/source-adapters/gitlab/gitlab.adapter.js'
import { DefaultTokenProvider } from './infrastructure/source-adapters/github/token-provider.js'
import { GitlabTokenProvider } from './infrastructure/source-adapters/gitlab/gitlab-token-provider.js'
import { LocalGitAdapter } from './infrastructure/source-adapters/local-git/local-git.adapter.js'
import { serveSpecLens } from './presentation/http/server.js'
import {
  buildManifestOrTargetDigest,
  createSpecProjectIdentity,
  digestText,
  resolveSpecProjectConfig,
} from './domain/project.js'
import type { SpecSourcePort } from './application/ports/spec-source.port.js'

type CliConfig = {
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
      try {
        return (name.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw)) as CliConfig
      } catch (err) {
        throw new Error(`Failed to parse config '${name}': ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  return null
}

function autoDetectConfig(): CliConfig {
  const productionTypeSpecManifest = 'packages/schemas/typespec/oa-sdk.typespec-bundle.json'
  if (existsSync(resolve(process.cwd(), productionTypeSpecManifest))) {
    return {
      source: 'local-git',
      localGit: { repoPath: process.cwd() },
      project: {
        kind: 'typespec-bundle',
        sourceRoot: 'packages/schemas/typespec',
        manifestPath: productionTypeSpecManifest,
      },
      port: 4891,
      dbPath: '.spec-lens.db',
    }
  }

  // Try to find a target yaml in common locations
  const candidates = [
    'packages/schemas/src/targets/book-notebook-api.yaml',
    'packages/schemas/src/targets/admin-api.yaml',
  ]
  for (const rel of candidates) {
    const full = resolve(process.cwd(), rel)
    if (existsSync(full)) {
      const fragmentsDir = resolve(dirname(full), '..', 'fragments')
      if (!existsSync(fragmentsDir)) continue
      return {
        source: 'local-git',
        localGit: { repoPath: process.cwd() },
        project: {
          kind: 'definition-builder',
          sourceRoot: fragmentsDir.replace(process.cwd() + '/', ''),
          targetPath: rel,
        },
        port: 4891,
        dbPath: '.spec-lens.db',
      }
    }
  }
  throw new Error(
    'No spec-lens.config.yaml found and could not auto-detect target.\n' +
    'Create spec-lens.config.yaml in your project root. See example:\n\n' +
    'source: local-git\n' +
    'project:\n' +
    '  kind: typespec-bundle\n' +
    '  sourceRoot: packages/schemas/typespec\n' +
    '  manifestPath: packages/schemas/typespec/oa-sdk.typespec-bundle.json\n' +
    'port: 4891\n',
  )
}

async function main() {
  const cfg = findConfig() ?? autoDetectConfig()
  const projectConfig = resolveSpecProjectConfig(cfg)
  const port = cfg.port ?? 4891
  const dbPath = resolve(process.cwd(), cfg.dbPath ?? '.spec-lens.db')
  const source = createSource(cfg)
  const observation = await source.resolveObservationIdentity(cfg.branch)
  const cache = new SqliteCache(dbPath)

  if (projectConfig.kind === 'typespec-bundle') {
    const builderSelection = selectSnapshotBuilder(projectConfig)
    const manifestPath = resolve(process.cwd(), projectConfig.manifestPath)
    if (!existsSync(manifestPath)) throw new Error(`TypeSpec bundle manifest does not exist: ${projectConfig.manifestPath}`)
    const toolchain = resolveSpecLensTypeSpecToolchain()
    const project = createSpecProjectIdentity(
      projectConfig,
      buildManifestOrTargetDigest(projectConfig.manifestPath, digestText(readFileSync(manifestPath, 'utf8'))),
      observation,
      toolchain.fingerprint,
    )
    console.log('spec-lens server starting…')
    console.log(`  source:       ${cfg.source}`)
    console.log(`  project:      ${project.sourceKind} (${project.projectKey.slice(0, 12)})`)
    console.log(`  sourceRoot:   ${projectConfig.sourceRoot}`)
    console.log(`  manifestPath: ${projectConfig.manifestPath}`)
    console.log(`  toolchain:    ${toolchain.fingerprint.slice(0, 12)}`)
    console.log(`  observation:  ${observation.repository}#${observation.ref}`)
    console.log(`  db:           ${dbPath}`)
    console.log(`  port:         ${port}`)
    serveSpecLens({
      kind: 'typespec-bundle',
      project,
      source,
      cache,
      builder: builderSelection.builder,
      manifestPath: projectConfig.manifestPath,
      ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
      port,
    })
  } else {
    const builderSelection = selectSnapshotBuilder(projectConfig)
    // sourceRoot stays repo-relative because remote adapters require relative paths.
    const fragmentsDir = projectConfig.sourceRoot
    const targetPath = resolve(process.cwd(), projectConfig.targetPath)
    const targetConfig = loadDefinitionTargetConfig(targetPath)
    const targetConfigDigest = buildTargetConfigDigest(targetConfig)
    const project = createSpecProjectIdentity(
      projectConfig,
      buildManifestOrTargetDigest(projectConfig.targetPath, targetConfigDigest),
      observation,
    )
    console.log('spec-lens server starting…')
    console.log(`  source:       ${cfg.source}`)
    console.log(`  project:      ${project.sourceKind} (${project.projectKey.slice(0, 12)})`)
    console.log(`  fragmentsDir: ${fragmentsDir}`)
    console.log(`  targetPath:   ${targetPath}`)
    console.log(`  observation:  ${observation.repository}#${observation.ref}`)
    console.log(`  db:           ${dbPath}`)
    console.log(`  port:         ${port}`)
    serveSpecLens({
      kind: 'definition-builder',
      project,
      source,
      cache,
      builder: builderSelection.builder,
      fragmentsDir,
      targetPath,
      targetConfig,
      ...(cfg.branch !== undefined ? { branch: cfg.branch } : {}),
      port,
    })
  }

  process.on('SIGINT', () => {
    cache.close()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cache.close()
    process.exit(0)
  })
}

function createSource(cfg: CliConfig): SpecSourcePort {
  if (cfg.source === 'github') {
    if (!cfg.github) throw new Error('github config required when source=github')
    return new GithubAdapter({
      owner: cfg.github.owner,
      repo: cfg.github.repo,
      tokenProvider: new DefaultTokenProvider(),
      ...(cfg.github.branch !== undefined ? { branch: cfg.github.branch } : {}),
      ...(cfg.github.host !== undefined ? { host: cfg.github.host } : {}),
      ...(cfg.github.repoCache !== undefined ? { repoCache: cfg.github.repoCache } : {}),
    })
  }
  if (cfg.source === 'gitlab') {
    if (!cfg.gitlab) throw new Error('gitlab config required when source=gitlab')
    return new GitlabAdapter({
      ...(cfg.gitlab.host !== undefined ? { host: cfg.gitlab.host } : {}),
      projectId: cfg.gitlab.projectId,
      tokenProvider: new GitlabTokenProvider(),
    })
  }
  return new LocalGitAdapter({
    repoPath: cfg.localGit?.repoPath
      ? resolve(process.cwd(), cfg.localGit.repoPath)
      : process.cwd(),
  })
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
