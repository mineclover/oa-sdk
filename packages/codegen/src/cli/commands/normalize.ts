import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import {
  parseOpenApiCollectProfile,
  stringifyOpenApiYaml,
  writeOpenApiYaml,
} from '../lib/openapi-collect.js'
import { loadNormalizedOpenApi } from '../lib/normalized-openapi.js'

export const normalize: Command = {
  name: 'normalize',
  description: '외부 OpenAPI 산출물 → stable governance artifact',
  options: {
    spec: { type: 'string', short: 's', required: true, description: '정규화할 OpenAPI YAML/JSON 또는 TypeSpec(.tsp) 경로' },
    output: { type: 'string', short: 'o', description: '정규화된 OpenAPI YAML 출력 경로 (기본: stdout)' },
    profile: { type: 'string', description: 'generic | nestjs-swagger | fastapi (기본: generic)' },
  },
  async run(args) {
    const profile = parseOpenApiCollectProfile(optStr(args, 'profile'))
    const normalized = await loadNormalizedOpenApi(str(args, 'spec'), { profile })
    const output = optStr(args, 'output')
    if (output) {
      writeOpenApiYaml(output, normalized)
      console.log(`✅ OpenAPI normalized: ${output}`)
    } else {
      process.stdout.write(stringifyOpenApiYaml(normalized))
    }
  },
}
