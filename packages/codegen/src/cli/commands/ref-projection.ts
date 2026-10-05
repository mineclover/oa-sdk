import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import {
  rootRelativePath,
  serializeRefProjectionArtifact,
  summarizeRefProjectionArtifact,
} from '../lib/ref-projection-artifact.js'
import { validateRefProjectionArtifact } from '../lib/ref-projection-artifact-schema.js'
import { createRefProjectionArtifactFromFiles } from '../lib/ref-projection-files.js'

const GENERATOR_NAME = '@oa-sdk/codegen'

export const refProjection: Command = {
  name: 'ref-projection',
  description: 'OpenAPI 문서의 $ref 구조를 전개 없이 oa-sdk.ref-projection.v1 그래프 artifact로 내보내기',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'OpenAPI YAML/JSON 문서 경로' },
    provenance: { type: 'string', description: 'build-spec --provenance가 쓴 provenance map JSON 경로 (노드별 canonicalId 매핑)' },
    output: { type: 'string', short: 'o', description: 'artifact JSON 출력 파일 경로 (기본: stdout)' },
  },
  async run(args) {
    // Commands run with the project root as working directory.
    const root = process.cwd()
    const provenancePath = optStr(args, 'provenance')
    const artifact = createRefProjectionArtifactFromFiles({
      specPath: str(args, 'spec'),
      ...(provenancePath !== undefined ? { provenancePath } : {}),
      root,
      generator: { name: GENERATOR_NAME, version: readGeneratorVersion() },
    })
    const issues = validateRefProjectionArtifact(artifact)
    if (issues.length > 0) {
      const details = issues.map(issue => `${issue.instancePath || '/'} ${issue.message}`).join('; ')
      throw new Error(`생성한 artifact가 oa-sdk.ref-projection.v1 schema를 위반합니다: ${details}`)
    }
    const text = serializeRefProjectionArtifact(artifact)

    const outputArg = optStr(args, 'output')
    if (outputArg === undefined) {
      process.stdout.write(text)
      return
    }
    const outputPath = resolve(root, outputArg)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, text)

    const summary = summarizeRefProjectionArtifact(artifact)
    const unmapped = Object.entries(summary.unmappedNodes)
      .map(([reason, count]) => `${reason} ${count}`)
      .join(', ')
    console.log([
      `ref-projection: ${summary.nodes} nodes, ${summary.edges} edges`,
      `(recursion: ${summary.recursion.guarded} guarded, ${summary.recursion.unguarded} unguarded),`,
      `${summary.mappedNodes}/${summary.nodes} nodes with canonicalId${unmapped ? ` (unmapped: ${unmapped})` : ''},`,
      `${summary.diagnostics} diagnostics -> ${rootRelativePath(root, outputPath)}`,
    ].join(' '))
  },
}

/** Version of the `@oa-sdk/codegen` package this module belongs to, from its package.json. */
function readGeneratorVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown }
      if (manifest.name === GENERATOR_NAME && typeof manifest.version === 'string') return manifest.version
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error(`${GENERATOR_NAME} package.json을 찾을 수 없습니다`)
    directory = parent
  }
}
