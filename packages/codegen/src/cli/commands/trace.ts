import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { OasDocument } from '@oa-sdk/parser'
import type { OaManifest } from '../../routing/index.js'
import {
  analyzeSpecImpact,
  buildSpecTraceabilityGraph,
  formatSpecTraceabilityHumanReport,
  querySpecTrace,
  saveSpecTraceabilitySidecar,
  type SpecTraceQuery,
} from '../../traceability/index.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { parseBuildSpecProvenanceMap } from '../lib/provenance-report.js'
import type { Command } from '../lib/types.js'

export const trace: Command = {
  name: 'trace',
  description:
    'OpenAPI 3.2 스펙 정의의 엔드투엔드 추적성 그래프(.oa-trace.json) 생성, 다중 조건 질의 및 역방향 영향도(Blast Radius) 분석',
  options: {
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: 'OpenAPI YAML/JSON 문서 경로',
    },
    'typespec-root': {
      type: 'string',
      description: 'TypeSpec 소스 디렉토리 루트 경로 (AST 선언 좌표 결합)',
    },
    provenance: {
      type: 'string',
      description: 'build-spec --provenance로 생성된 provenance map JSON 경로',
    },
    manifest: {
      type: 'string',
      description: '.oa-manifest.json 파일 경로 (생성된 코드 파일 경로 연결)',
    },
    symbol: {
      type: 'string',
      description: '조회할 스펙 심볼명 또는 생성된 TypeScript 심볼명',
    },
    pointer: {
      type: 'string',
      description: '조회할 OpenAPI JSON Pointer',
    },
    'tracking-id': {
      type: 'string',
      description: '조회할 불변 추적 ID (@traceId 또는 trk_<hash>)',
    },
    source: {
      type: 'string',
      description: '조회할 원본 소스 파일 경로 필터',
    },
    requirement: {
      type: 'string',
      description: '조회할 요구사항 ID (@requirement)',
    },
    persona: {
      type: 'string',
      description: '조회할 페르소나 ID (@persona)',
    },
    impact: {
      type: 'string',
      description: '역방향 영향도 분석(Blast Radius) 시작 대상 (쉼표로 복수 지정 가능)',
    },
    output: {
      type: 'string',
      short: 'o',
      description: '.oa-trace.json 추적성 사이드카 출력 파일 경로',
    },
    format: {
      type: 'string',
      default: 'human',
      description: '출력 포맷 (human | json)',
    },
    verify: {
      type: 'boolean',
      description: '추적성 무결성 검증 모드 (중복 trackingId 또는 미해소 $ref 존재 시 exit 1)',
    },
  },
  async run(args) {
    const root = process.cwd()
    const specArg = str(args, 'spec')
    const specPath = resolve(root, specArg)
    const rawSpecText = readFileSync(specPath, 'utf-8')
    const parsedSpec = (
      specPath.endsWith('.json') ? JSON.parse(rawSpecText) : parseYaml(rawSpecText)
    ) as OasDocument

    const typespecRootArg = optStr(args, 'typespec-root')
    const provenanceArg = optStr(args, 'provenance')
    const manifestArg = optStr(args, 'manifest')

    const provenanceMap = provenanceArg
      ? parseBuildSpecProvenanceMap(
          JSON.parse(readFileSync(resolve(root, provenanceArg), 'utf-8')),
          resolve(root, provenanceArg),
        )
      : undefined

    const manifest = manifestArg
      ? (JSON.parse(readFileSync(resolve(root, manifestArg), 'utf-8')) as OaManifest)
      : undefined

    const graph = buildSpecTraceabilityGraph({
      spec: parsedSpec,
      specPath: specArg,
      ...(typespecRootArg ? { typespecRoot: resolve(root, typespecRootArg) } : {}),
      ...(provenanceMap ? { provenanceMap } : {}),
      ...(manifest ? { manifest } : {}),
    })

    const outputArg = optStr(args, 'output')
    if (outputArg) {
      const outputPath = resolve(root, outputArg)
      saveSpecTraceabilitySidecar(outputPath, graph)
    }

    const query: SpecTraceQuery = {}
    const symbolArg = optStr(args, 'symbol')
    const pointerArg = optStr(args, 'pointer')
    const trackingIdArg = optStr(args, 'tracking-id')
    const sourceArg = optStr(args, 'source')
    const requirementArg = optStr(args, 'requirement')
    const personaArg = optStr(args, 'persona')

    if (symbolArg) query.symbol = symbolArg
    if (pointerArg) query.pointer = pointerArg
    if (trackingIdArg) query.trackingId = trackingIdArg
    if (sourceArg) query.sourceFile = sourceArg
    if (requirementArg) query.requirement = requirementArg
    if (personaArg) query.persona = personaArg

    const hasQuery = Object.keys(query).length > 0
    const matchedNodes = hasQuery ? querySpecTrace(graph, query) : Object.values(graph.nodes)

    const impactArg = optStr(args, 'impact')
    const impactResult = impactArg
      ? analyzeSpecImpact(
          graph,
          impactArg
            .split(',')
            .map(item => item.trim())
            .filter(Boolean),
        )
      : undefined

    const format = optStr(args, 'format') ?? 'human'
    if (format === 'json') {
      const payload =
        hasQuery || impactResult
          ? {
              schemaVersion: graph.schemaVersion,
              specSha256: graph.specSha256,
              summary: graph.summary,
              nodes: matchedNodes,
              ...(impactResult ? { impact: impactResult } : {}),
              diagnostics: graph.diagnostics,
            }
          : graph
      console.log(JSON.stringify(payload, null, 2))
    } else {
      console.log(formatSpecTraceabilityHumanReport(matchedNodes, impactResult))
    }

    const verify = bool(args, 'verify')
    if (verify && graph.diagnostics.length > 0) {
      throw new CliExitError(1)
    }
  },
}

export { trace as traceCommand }
export default trace
