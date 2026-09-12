import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import type { Command, CommandArgValue, CommandContext } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import { loadOpenApiOrTarget } from '../lib/target-openapi.js'
import { createArtifactReview } from '../lib/artifact-review.js'
import {
  formatOpenApiDiff,
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import { CliExitError } from '../lib/errors.js'
import { loadOaConfig, resolveProfileTarget } from '../lib/config-loader.js'
import { projectTargetSpec, computeVersionHash } from '../../spec-projector.js'
import {
  OPENAPI_PROJECTION_PROFILE_EXTENSION,
  OPENAPI_PROJECTION_VERSION_HASH_EXTENSION,
} from '@oa-sdk/openapi-projection-contract'
import type { ProfileTargetConfig } from '../../config.js'

type OutputFormat = 'human' | 'json'

const checkArtifactSpec = commandById(oaGenGovernanceManifest, 'check-artifact')

export const checkArtifact: Command = {
  name: checkArtifactSpec.name,
  description: checkArtifactSpec.summary,
  options: {
    head: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'head'),
    },
    schema: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'schema'),
    },
    artifact: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'artifact'),
    },
    config: {
      type: 'string',
      short: 'c',
      description: optionDescription(checkArtifactSpec, 'config'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(checkArtifactSpec, 'format'),
    },
    target: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'target'),
    },
    fragments: {
      type: 'string',
      description: optionDescription(checkArtifactSpec, 'fragments'),
    },
  },
  async run(args, context) {
    const headPath = optStr(args, 'head') ?? optStr(args, 'schema')
    const artifactPath = optStr(args, 'artifact')
    const configPath = optStr(args, 'config')
    const format = readFormat(optStr(args, 'format'))
    const root = context?.projectRoot ?? optStr(args, 'project-root') ?? optStr(args, 'root')

    // Case 1: Artifact specified without head/schema
    if (artifactPath && !headPath) {
      await handleSingleArtifactInspection(artifactPath, format, context, root)
      return
    }

    // Case 2: Explicit Single-Target Mode (both head/schema and artifact provided)
    if (artifactPath && headPath) {
      await handleSingleTargetCheck(headPath, artifactPath, args, format, context, root)
      return
    }

    // Case 3: Config-Driven Multi-Target Mode (no targeting arguments)
    await handleConfigDrivenCheck(configPath, format, context, root)
  },
}

export const driftCheck: Command = {
  ...checkArtifact,
  name: 'drift:check',
  description: 'Committed artifact freshness and spec drift verification (alias for check-artifact)',
}

async function handleSingleArtifactInspection(
  artifactPath: string,
  format: OutputFormat,
  context?: CommandContext,
  root?: string,
): Promise<void> {
  const resolved = resolve(root ?? context?.cwd ?? process.cwd(), artifactPath)
  if (!existsSync(resolved)) {
    const message = `Artifact file missing from disk: ${artifactPath}`
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: false,
            summary: message,
            targets: [
              {
                id: 'manual-artifact',
                artifact: artifactPath,
                status: 'missing',
                fresh: false,
                message,
              },
            ],
          },
          null,
          2,
        ),
      )
    } else {
      console.error(message)
    }
    throw new CliExitError(1)
  }

  const stat = statSync(resolved)
  if (stat.size === 0) {
    const message = `Artifact file is empty (0 bytes): ${artifactPath}`
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: false,
            summary: message,
            targets: [
              {
                id: 'manual-artifact',
                artifact: artifactPath,
                status: 'corrupt',
                fresh: false,
                message,
              },
            ],
          },
          null,
          2,
        ),
      )
    } else {
      console.error(message)
    }
    throw new CliExitError(1)
  }

  try {
    const raw = readFileSync(resolved, 'utf8')
    JSON.parse(raw)
  } catch (err) {
    const message = `Invalid JSON in artifact file: ${artifactPath} (${err instanceof Error ? err.message : String(err)})`
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: false,
            summary: message,
            targets: [
              {
                id: 'manual-artifact',
                artifact: artifactPath,
                status: 'corrupt',
                fresh: false,
                message,
              },
            ],
          },
          null,
          2,
        ),
      )
    } else {
      console.error(message)
    }
    throw new CliExitError(1)
  }

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'oa-gen.artifact-freshness.v1',
          fresh: true,
          summary: `Artifact ${artifactPath} is valid JSON`,
          targets: [
            {
              id: 'manual-artifact',
              artifact: artifactPath,
              status: 'fresh',
              fresh: true,
            },
          ],
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`fresh ${artifactPath} - valid JSON artifact`)
  }
}

async function handleSingleTargetCheck(
  headPath: string,
  artifactPath: string,
  args: Record<string, CommandArgValue>,
  format: OutputFormat,
  context?: CommandContext,
  root?: string,
): Promise<void> {
  const baseDir = root ?? context?.cwd ?? process.cwd()
  const resolvedArtifact = resolve(baseDir, artifactPath)
  if (!existsSync(resolvedArtifact)) {
    console.error(`Artifact file missing: ${artifactPath}`)
    throw new CliExitError(1)
  }
  if (statSync(resolvedArtifact).size === 0) {
    console.error(`Artifact file is empty (0 bytes): ${artifactPath}`)
    throw new CliExitError(1)
  }

  const isSchemaFile = /\.(?:ts|mts|cts|js|mjs|cjs)$/.test(headPath)

  if (isSchemaFile) {
    const resolvedHead = resolve(baseDir, headPath)
    if (!existsSync(resolvedHead)) {
      console.error(`Schema entry file missing: ${headPath}`)
      throw new CliExitError(1)
    }

    let committedDoc: Record<string, unknown>
    try {
      committedDoc = JSON.parse(readFileSync(resolvedArtifact, 'utf8'))
    } catch {
      console.error(`Invalid JSON in artifact file: ${artifactPath}`)
      throw new CliExitError(1)
    }

    const info = (committedDoc.info as Record<string, unknown> | undefined) ?? {}
    const inferredId =
      optStr(args, 'target') ??
      basename(artifactPath)
        .replace(/\.(?:openapi|schema)\.json$/, '')
        .replace(/\.json$/, '')

    const targetConfig: ProfileTargetConfig = {
      id: inferredId,
      ...(info.title !== undefined ? { title: String(info.title) } : {}),
      ...(info.version !== undefined ? { version: String(info.version) } : {}),
      profile: (committedDoc[OPENAPI_PROJECTION_PROFILE_EXTENSION] as any) ?? 'component-bundle',
      schemaEntry: headPath,
      outDir: dirname(artifactPath),
    }

    const projected = await projectTargetSpec(targetConfig, baseDir)
    const committedHash = computeVersionHash(committedDoc)
    const projectedHash = projected.versionHash
    const isFresh = committedHash === projectedHash
    const differences = isFresh ? [] : diffOpenApiDocuments(projected.openApiDoc, committedDoc)

    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: isFresh,
            summary: isFresh ? `fresh ${artifactPath}` : `stale ${artifactPath} - spec drift detected`,
            targets: [
              {
                id: targetConfig.id,
                artifact: artifactPath,
                status: isFresh ? 'fresh' : 'drift',
                fresh: isFresh,
                committedHash,
                projectedHash,
                differences,
              },
            ],
          },
          null,
          2,
        ),
      )
    } else if (isFresh) {
      console.log(`fresh ${artifactPath} - in sync with source schema (${projectedHash})`)
    } else {
      console.log(`stale ${artifactPath} - spec drift detected`)
      console.log(`  Projected hash: ${projectedHash}`)
      console.log(`  Committed hash: ${committedHash}`)
      if (differences.length > 0) {
        console.log(formatOpenApiDiff(differences))
      }
    }

    if (!isFresh) throw new CliExitError(1)
    return
  }

  // Legacy OpenAPI vs OpenAPI document comparison
  const targetPath = optStr(args, 'target')
  const fragmentsDir = optStr(args, 'fragments')
  const head = loadOpenApiOrTarget({
    specPath: headPath,
    ...(targetPath ? { targetPath } : {}),
    ...(fragmentsDir ? { fragmentsDir } : {}),
  })
  const artifact = loadSpecWithPath(artifactPath, baseDir)
  const payload = createArtifactReview({
    headDocument: head.document,
    artifactPath: artifact.path,
    artifactDocument: artifact.document,
  })

  if (format === 'json') {
    console.log(JSON.stringify(payload, null, 2))
  } else if (payload.fresh) {
    console.log(`fresh ${payload.artifact} - ${payload.summary}`)
  } else {
    console.log(`stale ${payload.artifact} - ${payload.summary}`)
    console.log(formatOpenApiDiff(payload.differences))
  }

  if (!payload.fresh) throw new CliExitError(1)
}

async function handleConfigDrivenCheck(
  configPath: string | undefined,
  format: OutputFormat,
  context?: CommandContext,
  root?: string,
): Promise<void> {
  const loaded = await loadOaConfig({
    ...(configPath ? { configPath } : {}),
    ...(context?.cwd !== undefined ? { cwd: context.cwd } : {}),
    ...(root !== undefined ? { explicitRoot: root } : {}),
  })

  if (!loaded) {
    const message = '오류: oa.config.ts 설정 파일을 찾을 수 없으며, --artifact 또는 --head 옵션이 필요합니다'
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: false,
            summary: message,
            targets: [],
          },
          null,
          2,
        ),
      )
    } else {
      console.error(message)
    }
    throw new CliExitError(1)
  }

  const specs = loaded.config.specs ?? []
  if (specs.length === 0) {
    const message = '오류: 설정 파일에 specs 목록이 비어 있습니다'
    if (format === 'json') {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 'oa-gen.artifact-freshness.v1',
            fresh: false,
            summary: message,
            targets: [],
          },
          null,
          2,
        ),
      )
    } else {
      console.error(message)
    }
    throw new CliExitError(1)
  }

  const targetResults: {
    id: string
    profile: string
    artifact: string
    status: 'fresh' | 'drift' | 'missing' | 'corrupt'
    fresh: boolean
    committedHash?: string
    projectedHash?: string
    message?: string
    differences?: OpenApiNormalizedDiffEntry[]
  }[] = []

  let allFresh = true

  for (const specTarget of specs) {
    const resolvedTarget = resolveProfileTarget(specTarget, loaded.rootDir)
    const expectedArtifactPath = join(resolvedTarget.outDir, `${resolvedTarget.id}.openapi.json`)
    const relArtifactPath = relative(loaded.rootDir, expectedArtifactPath)

    if (!existsSync(expectedArtifactPath)) {
      allFresh = false
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'missing',
        fresh: false,
        message: 'Artifact file missing from disk',
      })
      continue
    }

    if (statSync(expectedArtifactPath).size === 0) {
      allFresh = false
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'corrupt',
        fresh: false,
        message: 'Artifact file is empty (0 bytes)',
      })
      continue
    }

    let committedDoc: Record<string, unknown>
    try {
      const raw = readFileSync(expectedArtifactPath, 'utf8')
      committedDoc = JSON.parse(raw)
    } catch {
      allFresh = false
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'corrupt',
        fresh: false,
        message: 'Failed to parse artifact JSON',
      })
      continue
    }

    let projected
    try {
      projected = await projectTargetSpec(resolvedTarget, loaded.rootDir)
    } catch (err) {
      allFresh = false
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'corrupt',
        fresh: false,
        message: `Projection failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      continue
    }

    const committedHash = computeVersionHash(committedDoc)
    const projectedHash = projected.versionHash
    const isFresh = committedHash === projectedHash

    if (!isFresh) {
      allFresh = false
      const differences = diffOpenApiDocuments(projected.openApiDoc, committedDoc)
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'drift',
        fresh: false,
        committedHash,
        projectedHash,
        differences,
      })
    } else {
      targetResults.push({
        id: resolvedTarget.id,
        profile: resolvedTarget.profile ?? 'full-api-document',
        artifact: relArtifactPath,
        status: 'fresh',
        fresh: true,
        committedHash,
        projectedHash,
      })
    }
  }

  if (format === 'json') {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'oa-gen.artifact-freshness.v1',
          fresh: allFresh,
          summary: allFresh
            ? `All ${specs.length} spec artifacts are fresh`
            : `Spec drift detected in ${targetResults.filter(t => !t.fresh).length} of ${specs.length} targets`,
          targets: targetResults,
        },
        null,
        2,
      ),
    )
  } else {
    printHumanFreshnessTable(targetResults)
  }

  if (!allFresh) {
    throw new CliExitError(1)
  }
}

function printHumanFreshnessTable(
  targets: {
    id: string
    profile: string
    artifact: string
    status: 'fresh' | 'drift' | 'missing' | 'corrupt'
    fresh: boolean
    committedHash?: string
    projectedHash?: string
    message?: string
    differences?: OpenApiNormalizedDiffEntry[]
  }[],
): void {
  console.log('\nSpec Freshness & Drift Verification:')
  console.log('='.repeat(80))
  console.log(`${'Target'.padEnd(24)} ${'Status'.padEnd(20)} ${'Artifact'}`)
  console.log('-'.repeat(80))

  for (const target of targets) {
    let statusLabel = ''
    if (target.status === 'fresh') statusLabel = '🟢 FRESH'
    else if (target.status === 'drift') statusLabel = '🔴 DRIFT DETECTED'
    else if (target.status === 'missing') statusLabel = '🔴 MISSING'
    else statusLabel = '🔴 CORRUPT'

    console.log(`${target.id.padEnd(24)} ${statusLabel.padEnd(20)} ${target.artifact}`)
    if (target.status === 'drift') {
      if (target.projectedHash) console.log(`  Projected: ${target.projectedHash}`)
      if (target.committedHash) console.log(`  Committed: ${target.committedHash}`)
      if (target.differences && target.differences.length > 0) {
        for (const diff of target.differences.slice(0, 5)) {
          console.log(`    - [${diff.kind}] ${diff.pointer}: ${diff.message}`)
        }
        if (target.differences.length > 5) {
          console.log(`    ... and ${target.differences.length - 5} more diff entries`)
        }
      }
    } else if (target.message) {
      console.log(`  ${target.message}`)
    }
  }
  console.log('='.repeat(80))

  const freshCount = targets.filter(t => t.fresh).length
  if (freshCount === targets.length) {
    console.log(`\nAll ${targets.length} spec artifacts are fresh and in sync with source code.\n`)
  } else {
    console.log(
      `\nSpec drift detected: ${targets.length - freshCount} of ${targets.length} targets failed freshness checks.\n`,
    )
  }
}

function readFormat(format: string | undefined): OutputFormat {
  if (format === undefined) return 'human'
  if (format === 'human' || format === 'json') return format
  throw new Error(`unsupported artifact check format: ${format}`)
}
