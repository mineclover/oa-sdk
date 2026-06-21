import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import { writeJson } from '../lib/openapi-collect.js'
import { exportOpenApiToTypeSpec } from '../lib/tsp-export.js'
import { createTypeSpecCompatibilitySidecar } from '../lib/typespec-sidecar.js'
import { writeOutput } from '../lib/output.js'

export const tspExport: Command = {
  name: 'tsp-export',
  description: 'OpenAPI artifact -> TypeSpec spike source + diagnostics',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'TypeSpec으로 변환할 OpenAPI YAML/JSON 경로' },
    output: { type: 'string', short: 'o', description: '생성할 .tsp 파일 경로 (기본: stdout)' },
    report: { type: 'string', description: '변환 diagnostics JSON 출력 경로' },
    sidecar: { type: 'string', description: 'TypeSpec projection 밖에 남길 OA SDK compatibility sidecar JSON 출력 경로' },
    namespace: { type: 'string', description: '생성할 TypeSpec namespace 이름' },
  },
  async run(args) {
    const { document } = loadSpecWithPath(str(args, 'spec'))
    const namespace = optStr(args, 'namespace')
    const result = exportOpenApiToTypeSpec(document, namespace ? { namespace } : {})
    const report = optStr(args, 'report')
    const sidecar = optStr(args, 'sidecar')
    if (report) writeJson(report, result.report)
    if (sidecar) writeJson(sidecar, createTypeSpecCompatibilitySidecar(document))
    writeOutput(optStr(args, 'output'), result.source, 'TypeSpec export')
    if (report) console.log(`✅ TypeSpec export report: ${report}`)
    if (sidecar) console.log(`✅ TypeSpec compatibility sidecar: ${sidecar}`)
  },
}
