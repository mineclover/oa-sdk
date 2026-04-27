import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import {
  stringifyOpenApiYaml,
  upgradeOpenApiDocumentTo32,
  writeJson,
  writeOpenApiYaml,
} from '../lib/openapi-collect.js'

export const upgrade: Command = {
  name: 'upgrade',
  description: 'OpenAPI 3.0/3.1 산출물 → OpenAPI 3.2 분석 artifact',
  options: {
    spec: { type: 'string', short: 's', required: true, description: '업그레이드할 OpenAPI YAML/JSON 경로' },
    output: { type: 'string', short: 'o', description: 'OpenAPI 3.2 YAML 출력 경로 (기본: stdout)' },
    report: { type: 'string', description: '변환 리포트 JSON 출력 경로' },
  },
  async run(args) {
    const { document } = loadSpecWithPath(str(args, 'spec'))
    const result = upgradeOpenApiDocumentTo32(document)
    const report = optStr(args, 'report')
    if (report) writeJson(report, result.report)

    const output = optStr(args, 'output')
    if (output) {
      writeOpenApiYaml(output, result.document)
      console.log(`✅ OpenAPI upgraded: ${output}`)
      if (report) console.log(`✅ OpenAPI upgrade report: ${report}`)
    } else {
      process.stdout.write(stringifyOpenApiYaml(result.document))
    }
  },
}
