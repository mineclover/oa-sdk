import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { DefinitionTargetConfig } from '@oa-sdk/parser'
import type {
  ClearCacheResult,
  RefreshResult,
  SpecGraph,
  SpecPathsResult,
  SpecServerConfig,
  SpecSnapshot,
  SpecTimelineDiff,
  SpecTimelineEntry,
} from '@oa-sdk/spec-lens-contract'
import { buildTargetConfigDigest } from '../../infrastructure/cache/sqlite/cache-key.js'
import { RefreshTimelineHandler } from '../../application/commands/refresh-timeline.command.js'
import { GetDiffHandler } from '../../application/queries/get-diff.query.js'
import { GetGraphHandler } from '../../application/queries/get-graph.query.js'
import { GetPathsHandler } from '../../application/queries/get-paths.query.js'
import { GetSnapshotHandler } from '../../application/queries/get-snapshot.query.js'
import { GetTimelineHandler } from '../../application/queries/get-timeline.query.js'
import type { CachePort } from '../../application/ports/cache.port.js'
import type { SnapshotBuilderPort } from '../../application/ports/snapshot-builder.port.js'
import type { SpecSourcePort } from '../../application/ports/spec-source.port.js'
import type {
  DefinitionBuilderProjectIdentity,
  TypeSpecBundleProjectIdentity,
} from '../../domain/project.js'

type SpecLensServerCommon = {
  source: SpecSourcePort
  cache: CachePort
  branch?: string
  port?: number
  uiDir?: string  // 빌드된 apps/spec-lens 정적 파일 경로
}

export type DefinitionBuilderSpecLensServerConfig = SpecLensServerCommon & {
  kind: 'definition-builder'
  project: DefinitionBuilderProjectIdentity
  builder: SnapshotBuilderPort<'definition-builder'>
  fragmentsDir: string
  targetPath: string
  targetConfig: DefinitionTargetConfig
}

export type TypeSpecBundleSpecLensServerConfig = SpecLensServerCommon & {
  kind: 'typespec-bundle'
  project: TypeSpecBundleProjectIdentity
  builder: SnapshotBuilderPort<'typespec-bundle'>
  manifestPath: string
}

export type SpecLensServerConfig =
  | DefinitionBuilderSpecLensServerConfig
  | TypeSpecBundleSpecLensServerConfig

export function createSpecLensServer(config: SpecLensServerConfig): Hono {
  const app = new Hono()
  const targetConfigDigest = config.kind === 'definition-builder'
    ? buildTargetConfigDigest(config.targetConfig)
    : undefined

  const refresh = new RefreshTimelineHandler(config.source, config.builder, config.cache)
  const getTimeline = new GetTimelineHandler(config.cache)
  const getSnapshot = new GetSnapshotHandler(config.cache)
  const getDiff = new GetDiffHandler(config.cache, config.builder)
  const getPaths = new GetPathsHandler(config.cache)
  const getGraph = new GetGraphHandler(config.cache)

  app.use('/api/*', cors())

  // 🔵 Query: GetConfig (server identity — which target is being observed)
  app.get('/api/config', (c) => {
    const common = {
      projectKey: config.project.projectKey,
      toolchainFingerprint: config.project.toolchainFingerprint,
      projectSourceRoot: config.project.sourceRoot,
      observation: config.project.observation,
      sourceKind: config.source.kind,
      ...(config.branch !== undefined ? { branch: config.branch } : {}),
    }
    const response: SpecServerConfig = config.kind === 'definition-builder'
      ? {
          ...common,
          projectKind: 'definition-builder',
          targetName: config.targetConfig.name,
          targetPath: config.targetPath,
          fragmentsDir: config.fragmentsDir,
        }
      : {
        ...common,
        projectKind: 'typespec-bundle',
        manifestPath: config.manifestPath,
      }
    return c.json(response)
  })

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  })

  // 🔴 Command: RefreshTimeline
  app.post('/api/refresh', async (c) => {
    // Sync remote repo before fetching revisions (GithubAdapter bare clone strategy)
    if ('syncRepo' in config.source && typeof config.source.syncRepo === 'function') {
      await (config.source.syncRepo as (branch?: string) => Promise<void>)(config.branch)
    }
    const result = config.kind === 'definition-builder'
      ? await refresh.handle({
          kind: 'definition-builder',
          project: config.project,
          fragmentsDir: config.fragmentsDir,
          targetPath: config.targetPath,
          targetConfig: config.targetConfig,
          targetConfigDigest: targetConfigDigest!,
          ...(config.branch !== undefined ? { branch: config.branch } : {}),
        })
      : await refresh.handle({
          kind: 'typespec-bundle',
          project: config.project,
          manifestPath: config.manifestPath,
          ...(config.branch !== undefined ? { branch: config.branch } : {}),
        })
    const response: RefreshResult = result
    return c.json(response)
  })

  // 🔵 Query: GetTimeline (Read Model)
  app.get('/api/timeline', async (c) => {
    const rawLimit = Number(c.req.query('limit'))
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100
    const entries: SpecTimelineEntry[] = await getTimeline.handle({
      projectKey: config.project.projectKey,
      limit,
    })
    return c.json(entries)
  })

  // 🔵 Query: GetSnapshot
  app.get('/api/snapshot/:revisionId', async (c) => {
    const revisionId = c.req.param('revisionId')
    const includeEntries = c.req.query('include') === 'entries'
    const snapshot: SpecSnapshot | null = await getSnapshot.handle({
      revisionId,
      projectKey: config.project.projectKey,
      toolchainFingerprint: config.project.toolchainFingerprint,
      includeEntries,
    })
    if (snapshot === null) return c.json({ error: 'not found' }, 404)
    return c.json(snapshot)
  })

  // 🔵 Query: GetDiff
  app.get('/api/diff/:baseId/:headId', async (c) => {
    const baseId = c.req.param('baseId')
    const headId = c.req.param('headId')
    const diff: SpecTimelineDiff | null = await getDiff.handle({
      baseRevisionId: baseId,
      headRevisionId: headId,
      projectKey: config.project.projectKey,
      toolchainFingerprint: config.project.toolchainFingerprint,
    })
    if (diff === null) return c.json({ error: 'not found' }, 404)
    return c.json(diff)
  })

  // 🔵 Query: GetPaths (Read Model)
  app.get('/api/paths', async (c) => {
    const scope = c.req.query('scope')
    const domain = c.req.query('domain')
    const paths: SpecPathsResult = await getPaths.handle({
      projectKey: config.project.projectKey,
      projectKind: config.kind,
      ...(scope !== undefined ? { scope } : {}),
      ...(domain !== undefined ? { domain } : {}),
    })
    return c.json(paths)
  })

  // 🔵 Query: GetGraph (latest revision)
  app.get('/api/graph', async (c) => {
    const revisionId = c.req.query('revision')
    if (revisionId === undefined) {
      const timeline = await getTimeline.handle({
        projectKey: config.project.projectKey,
        limit: 1,
      })
      const latest = timeline[0]
      if (latest === undefined) return c.json({ nodes: [], edges: [] })
      const graph: SpecGraph | null = await getGraph.handle({
        revisionId: latest.revision.id,
        projectKey: config.project.projectKey,
        toolchainFingerprint: config.project.toolchainFingerprint,
      })
      return c.json(graph ?? { nodes: [], edges: [] })
    }
    const graph: SpecGraph | null = await getGraph.handle({
      revisionId,
      projectKey: config.project.projectKey,
      toolchainFingerprint: config.project.toolchainFingerprint,
    })
    if (graph === null) return c.json({ error: 'not found' }, 404)
    return c.json(graph)
  })

  // 🔴 Command: ClearCache
  app.delete('/api/cache', async (c) => {
    const result: ClearCacheResult = await config.cache.clearCache(config.project.projectKey)
    return c.json(result)
  })

  // Static UI (운영: React 빌드 결과 서빙)
  if (config.uiDir !== undefined) {
    app.use('/ui/*', serveStatic({ root: config.uiDir }))
    app.get('/', (c) => c.redirect('/ui/'))
  }

  return app
}

export function serveSpecLens(config: SpecLensServerConfig): void {
  const app = createSpecLensServer(config)
  const port = config.port ?? 4891
  serve({ fetch: app.fetch, port }, () => {
    console.log(`spec-lens running on http://localhost:${port}`)
  })
}
