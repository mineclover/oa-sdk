import { readFileSync } from 'node:fs'
import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { stringifyOpenApiYaml, writeJson } from '../lib/openapi-collect.js'
import { writeOutput } from '../lib/output.js'
import {
  applyTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
} from '../lib/typespec-sidecar.js'
import { validateDocument } from '@oa-sdk/parser'

export const tspRestore: Command = {
  name: 'tsp-restore',
  description: 'Apply a TypeSpec compatibility sidecar to an emitted OpenAPI artifact',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'sidecar를 적용할 TypeSpec emitted OpenAPI YAML/JSON 경로' },
    sidecar: { type: 'string', required: true, description: 'oa-sdk.typespec-compat-sidecar.v1 JSON 경로' },
    output: { type: 'string', short: 'o', description: '복원된 OpenAPI YAML 출력 경로 (기본: stdout)' },
    report: { type: 'string', description: 'sidecar restore report JSON 출력 경로' },
  },
  async run(args) {
    const specPath = str(args, 'spec')
    const { document } = loadSpecWithPath(specPath)
    const sidecar = parseTypeSpecCompatibilitySidecar(JSON.parse(readFileSync(str(args, 'sidecar'), 'utf8')) as unknown)
    const restored = applyTypeSpecCompatibilitySidecar(document, sidecar)
    const report = optStr(args, 'report')
    if (report) writeJson(report, restored.report)
    if (restored.report.counts.missingTargets > 0) {
      throw new Error(`sidecar restore missed ${restored.report.counts.missingTargets} target(s)`)
    }
    const validation = validateDocument(restored.document, {
      basePath: specPath,
      requireOpenApi32: true,
    })
    if (!validation.valid) {
      throw new Error(`restored OpenAPI is invalid: ${validation.summary}`)
    }

    writeOutput(optStr(args, 'output'), stringifyOpenApiYaml(restored.document), 'TypeSpec sidecar restored OpenAPI')
    if (report) console.log(`✅ TypeSpec sidecar restore report: ${report}`)
  },
}
