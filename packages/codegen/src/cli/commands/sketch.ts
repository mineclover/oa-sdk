/**
 * @intent INTENT-OA-CLI-SKETCH
 * @doc docs/guides/cli-command-reference.md#sketch
 *
 * First-class `oa-gen sketch` CLI command for TypeSpec (`.tsp`) Module Interface Sketch
 * IR parsing (`verify`), Arena candidate comparison (`compare`), artifact emission (`emit`),
 * and Phase D/E implementation contract canary verification (`check-contract`) (`REV-01`).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { checkImplementationContract } from '@oa-sdk/ast-sync'
import { compareSketchCandidates, parseTypeSpecSketch } from '@oa-sdk/surface-ir'
import { emitSketchArtifacts } from '../../sketch-emitter/index.js'
import { optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import type { Command } from '../lib/types.js'

function resolvePrimarySpecPath(specArg: string, root: string): string {
  const candidate = resolve(root, specArg)
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const dirName = basename(candidate)
    const namedTsp = join(candidate, `${dirName}.tsp`)
    if (existsSync(namedTsp)) {
      return namedTsp
    }
    const tspFiles = readdirSync(candidate)
      .filter((entry) => entry.endsWith('.tsp'))
      .sort()
    if (tspFiles.length > 0) {
      return join(candidate, tspFiles[0]!)
    }
  }
  return candidate
}

function resolveComparePaths(specArg: string, root: string): string[] {
  const rawParts = specArg
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (rawParts.length === 1) {
    const single = resolve(root, rawParts[0]!)
    if (existsSync(single) && statSync(single).isDirectory()) {
      const candidatesSubdir = join(single, 'candidates')
      const searchDir =
        existsSync(candidatesSubdir) && statSync(candidatesSubdir).isDirectory()
          ? candidatesSubdir
          : single
      return readdirSync(searchDir)
        .filter((entry) => entry.endsWith('.tsp'))
        .sort()
        .map((entry) => join(searchDir, entry))
    }
  }
  return rawParts.map((item) => resolve(root, item))
}

export const sketch: Command = {
  name: 'sketch',
  description:
    'TypeSpec(.tsp) 모듈 인터페이스 스케치 IR 검증(verify), 후보 비교(compare), 산출물 방출(emit: schema/openapi/mmd/stubs), 구현 계약 카나리 검사(check-contract)',
  options: {
    action: {
      type: 'string',
      short: 'a',
      default: 'verify',
      description: '실행 액션 (verify | emit | compare | check-contract)',
    },
    spec: {
      type: 'string',
      short: 's',
      required: true,
      description: '표준 TypeSpec(.tsp) 파일 또는 스케치 디렉터리 경로 (compare 시 쉼표로 복수 지정 가능)',
    },
    'out-dir': {
      type: 'string',
      short: 'o',
      description: 'emit 액션 시 산출물(.schema.json, .openapi.json, .mmd, sketch_stub.{ts,py}) 출력 디렉터리',
    },
    domain: {
      type: 'string',
      description: '도메인 슬러그 (기본값: .tsp 파일명)',
    },
    impl: {
      type: 'string',
      description: 'check-contract 액션 시 검사할 구현 파일 경로 (implementation.ts 또는 implementation.py)',
    },
    stub: {
      type: 'string',
      description: 'check-contract 액션 시 비교할 계약 스텁 경로 (미지정 시 .tsp에서 자동 생성)',
    },
    format: {
      type: 'string',
      default: 'json',
      description: '출력 포맷 (json | human)',
    },
  },
  async run(args) {
    const root = process.cwd()
    const action = optStr(args, 'action') ?? 'verify'
    const specArg = str(args, 'spec')
    const format = optStr(args, 'format') ?? 'json'

    if (action === 'compare') {
      const specPaths = resolveComparePaths(specArg, root)
      if (specPaths.length < 2) {
        console.error('compare 액션은 쉼표로 구분된 2개 이상의 .tsp 후보 경로 또는 candidates/ 디렉터리가 필요합니다.')
        throw new CliExitError(1)
      }
      const candidates = specPaths.map((filePath) => ({
        name: basename(filePath, '.tsp'),
        sourceText: readFileSync(filePath, 'utf-8'),
      }))
      const result = compareSketchCandidates(candidates)
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(
          `[oa-gen sketch compare] winner=${result.recommendedWinner} candidates=${result.candidates.length}`,
        )
      }
      return
    }

    const specPath = resolvePrimarySpecPath(specArg, root)
    if (!existsSync(specPath)) {
      console.error(`TypeSpec 파일을 찾을 수 없습니다: ${specPath}`)
      throw new CliExitError(1)
    }
    const tspSource = readFileSync(specPath, 'utf-8')
    const domain = optStr(args, 'domain') ?? basename(specPath, '.tsp')

    if (action === 'verify') {
      const ir = parseTypeSpecSketch(tspSource, specPath)
      if (format === 'json') {
        console.log(JSON.stringify(ir, null, 2))
      } else {
        console.log(
          `[oa-gen sketch verify] namespace=${ir.namespace} profile=${ir.profile} depth=${ir.depthMetrics.interfaceDepth} (isDeep=${ir.depthMetrics.isDeep}) redFlags=${ir.redFlags.length}`,
        )
      }
      return
    }

    if (action === 'emit') {
      const outDir = resolve(root, optStr(args, 'out-dir') ?? dirname(specPath))
      mkdirSync(outDir, { recursive: true })
      const emitted = emitSketchArtifacts(tspSource, domain)
      const schemaFile = join(outDir, `${domain}.schema.json`)
      const openapiFile = join(outDir, `${domain}.openapi.json`)
      const mermaidFile = join(outDir, `${domain}.mmd`)
      const tsStubFile = join(outDir, 'sketch_stub.ts')
      const pyStubFile = join(outDir, 'sketch_stub.py')

      writeFileSync(schemaFile, `${JSON.stringify(emitted.jsonSchema, null, 2)}\n`, 'utf-8')
      writeFileSync(openapiFile, `${JSON.stringify(emitted.openApi, null, 2)}\n`, 'utf-8')
      writeFileSync(mermaidFile, emitted.mermaid, 'utf-8')
      writeFileSync(tsStubFile, emitted.tsStub, 'utf-8')
      writeFileSync(pyStubFile, emitted.pyStub, 'utf-8')

      const payload = {
        ok: true,
        domain,
        specPath,
        outDir,
        files: {
          schemaFile,
          openapiFile,
          mermaidFile,
          tsStubFile,
          pyStubFile,
        },
        ir: emitted.ir,
      }
      if (format === 'json') {
        console.log(JSON.stringify(payload, null, 2))
      } else {
        console.log(`[oa-gen sketch emit] Emitted 5 artifacts for '${domain}' in ${outDir}`)
      }
      return
    }

    if (action === 'check-contract') {
      const implArg = optStr(args, 'impl')
      if (!implArg) {
        console.error('check-contract 액션은 --impl <구현파일경로> 옵션이 필요합니다.')
        throw new CliExitError(1)
      }
      const implPath = resolve(root, implArg)
      if (!existsSync(implPath)) {
        console.error(`구현 파일을 찾을 수 없습니다: ${implPath}`)
        throw new CliExitError(1)
      }
      const implSource = readFileSync(implPath, 'utf-8')
      const language: 'typescript' | 'python' = implPath.endsWith('.py') ? 'python' : 'typescript'
      const ir = parseTypeSpecSketch(tspSource, specPath)
      const contractedOperations = ir.interfaces.flatMap((iface) =>
        iface.operations.map((op) => op.name),
      )
      const contractedModels = ir.models.map((model) => model.name)
      const report = checkImplementationContract({
        implementationSource: implSource,
        language,
        contractedOperations,
        contractedModels,
      })
      if (format === 'json') {
        console.log(JSON.stringify(report, null, 2))
      } else {
        console.log(
          `[oa-gen sketch check-contract] passed=${report.passed} scrapRequired=${report.scrapRequired} friction=${report.totalFrictionSignals}`,
        )
      }
      if (!report.passed || report.scrapRequired) {
        throw new CliExitError(1)
      }
      return
    }

    console.error(
      `알 수 없는 sketch 액션입니다: '${action}' (지원: verify | emit | compare | check-contract)`,
    )
    throw new CliExitError(1)
  },
}

export { sketch as sketchCommand }
