import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import {
  normalizeOpenApiDocument,
  parseOpenApiCollectProfile,
  stringifyOpenApiYaml,
  writeOpenApiYaml,
} from '../lib/openapi-collect.js'

export const normalize: Command = {
  name: 'normalize',
  description: '외부 OpenAPI 산출물 → stable governance artifact',
  options: {
    spec: { type: 'string', short: 's', required: true, description: '정규화할 OpenAPI YAML/JSON 경로' },
    output: { type: 'string', short: 'o', description: '정규화된 OpenAPI YAML 출력 경로 (기본: stdout)' },
    profile: { type: 'string', description: 'generic | nestjs-swagger (기본: generic)' },
  },
  async run(args) {
    const { document } = loadSpecWithPath(str(args, 'spec'))
    const profile = parseOpenApiCollectProfile(optStr(args, 'profile'))
    const normalized = normalizeOpenApiDocument(document, { profile })
    const output = optStr(args, 'output')
    if (output) {
      writeOpenApiYaml(output, normalized)
      console.log(`✅ OpenAPI normalized: ${output}`)
    } else {
      process.stdout.write(stringifyOpenApiYaml(normalized))
    }
  },
}
