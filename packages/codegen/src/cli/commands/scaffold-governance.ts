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
    profile: { type: 'string', description: 'generic | nestjs-swagger | fastapi (기본: generic)' },
    'source-command': { type: 'string', description: 'raw OpenAPI artifact를 생성하는 명령. 예: pnpm export:openapi' },
    'runtime-openapi-url': { type: 'string', description: 'runtime drift 확인용 OpenAPI URL' },
    'oa-gen-command': { type: 'string', description: '독립 실행용 oa-gen 명령 (기본: oa-gen). 예: pnpm exec oa-gen' },
    'oa-gen-setup-command': { type: 'string', description: 'generated CI에서 oa-gen을 준비할 신뢰된 설치/빌드 명령' },
    'typegen-policy': { type: 'string', description: 'verify-only | commit-required (기본: verify-only)' },
    force: { type: 'boolean', description: '기존 scaffold 파일 덮어쓰기' },
  },
  async run(args) {
    const sourceCommand = optStr(args, 'source-command')
    const runtimeOpenApiUrl = optStr(args, 'runtime-openapi-url')
    const oaGenCommand = optStr(args, 'oa-gen-command')
    const oaGenSetupCommand = optStr(args, 'oa-gen-setup-command')
    const typegenPolicy = optStr(args, 'typegen-policy')
    const result = scaffoldOpenApiGovernance({
      rootDir: str(args, 'root'),
      service: str(args, 'service'),
      profile: parseOpenApiCollectProfile(optStr(args, 'profile')),
      ...(sourceCommand ? { sourceCommand } : {}),
      ...(runtimeOpenApiUrl ? { runtimeOpenApiUrl } : {}),
      ...(oaGenCommand ? { oaGenCommand } : {}),
      ...(oaGenSetupCommand ? { oaGenSetupCommand } : {}),
      ...(typegenPolicy ? { typegenPolicy: typegenPolicy as 'verify-only' | 'commit-required' } : {}),
      force: bool(args, 'force'),
    })
    console.log(formatScaffoldResult(result))
  },
}
