import type { Command } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import {
  formatScaffoldResult,
  scaffoldOpenApiGovernance,
} from '../lib/openapi-governance-scaffold.js'
import { parseOpenApiCollectProfile } from '../lib/openapi-collect.js'

export const scaffoldGovernance: Command = {
  name: 'scaffold-governance',
  description: '외부 OpenAPI 서비스용 governance interface/config/scripts scaffold 생성',
  options: {
    root: { type: 'string', required: true, description: '스캐폴드를 생성할 서비스 루트 디렉토리' },
    service: { type: 'string', required: true, description: '서비스 이름' },
    profile: { type: 'string', description: 'generic | nestjs-swagger (기본: generic)' },
    'source-command': { type: 'string', description: 'raw OpenAPI artifact를 생성하는 명령. 예: pnpm export:openapi' },
    'runtime-openapi-url': { type: 'string', description: 'runtime drift 확인용 OpenAPI URL' },
    force: { type: 'boolean', description: '기존 scaffold 파일 덮어쓰기' },
  },
  async run(args) {
    const sourceCommand = optStr(args, 'source-command')
    const runtimeOpenApiUrl = optStr(args, 'runtime-openapi-url')
    const result = scaffoldOpenApiGovernance({
      rootDir: str(args, 'root'),
      service: str(args, 'service'),
      profile: parseOpenApiCollectProfile(optStr(args, 'profile')),
      ...(sourceCommand ? { sourceCommand } : {}),
      ...(runtimeOpenApiUrl ? { runtimeOpenApiUrl } : {}),
      force: bool(args, 'force'),
    })
    console.log(formatScaffoldResult(result))
  },
}
