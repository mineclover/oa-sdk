import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { optStr, str } from '../lib/args.js'
import { writeOutput } from '../lib/output.js'
import type { Command } from '../lib/types.js'

export interface ScaffoldOptions {
  route: string
  method?: string
  operationId?: string
  summary?: string
  domain?: string
  auth?: string
}

export function generateTypeSpecScaffold(options: ScaffoldOptions): {
  operationId: string
  code: string
  requestModelName?: string
  responseModelName: string
} {
  const method = (options.method || 'get').toLowerCase()
  const route = options.route.startsWith('/') ? options.route : `/${options.route}`
  const domain = options.domain || inferDomain(route)
  const operationId = options.operationId || inferOperationId(method, route)
  const summary = options.summary || `${operationId} operation`
  const auth = options.auth || 'bearerAuth'

  const pathParams = extractPathParams(route)
  const hasBody = ['post', 'put', 'patch'].includes(method)
  const capitalizedOpId = capitalize(operationId)

  const requestModelName = hasBody ? `${capitalizedOpId}Request` : undefined
  const statusCode = method === 'post' ? 201 : 200
  const responseModelName = `${capitalizedOpId}${statusCode}Response`

  const lines: string[] = []

  // 1. Request model (if body expected)
  if (hasBody && requestModelName) {
    lines.push(`@doc("${summary} 요청 본문")`)
    lines.push(`model ${requestModelName} {`)
    lines.push(`  // TODO: 요청 필드를 정의하세요`)
    lines.push(`}`)
    lines.push(``)
  }

  // 2. Response model
  lines.push(`@doc("${summary} 성공 응답")`)
  lines.push(`model ${responseModelName} {`)
  lines.push(`  @statusCode statusCode: ${statusCode};`)
  lines.push(`  @body body: {`)
  lines.push(`    // TODO: 응답 필드를 정의하세요`)
  lines.push(`    id: string;`)
  lines.push(`  };`)
  lines.push(`}`)
  lines.push(``)

  // 3. Operation
  lines.push(`@summary("${summary}")`)
  lines.push(`@doc("${summary}")`)
  lines.push(`@tag("${domain}")`)
  if (auth !== 'none') {
    lines.push(`@useAuth(${auth})`)
  }
  lines.push(`@operationId("${operationId}")`)
  lines.push(`@route("${route}")`)
  lines.push(`@${method}`)
  lines.push(`@oaUseResponseComponent("400", "BadRequest")`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`@oaUseResponseComponent("404", "NotFound")`)

  const paramDecls: string[] = []
  for (const param of pathParams) {
    paramDecls.push(`@doc("${param} ID") @path ${param}: string`)
  }
  if (hasBody && requestModelName) {
    paramDecls.push(`@body body: ${requestModelName}`)
  }

  const paramsStr = paramDecls.length > 0 ? `\n  ${paramDecls.join(',\n  ')},\n` : ''
  lines.push(`op ${operationId}(${paramsStr}): ${responseModelName};`)

  return {
    operationId,
    code: lines.join('\n'),
    requestModelName,
    responseModelName,
  }
}

function inferDomain(route: string): string {
  const parts = route.split('/').filter(p => p && !p.startsWith('{'))
  return parts[0] || 'default'
}

function inferOperationId(method: string, route: string): string {
  const parts = route.split('/').filter(Boolean)
  const cleanParts: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith('{') && p.endsWith('}')) {
      cleanParts.push('By' + capitalize(p.slice(1, -1)))
    } else {
      const next = parts[i + 1]
      let name = p
      if (next && next.startsWith('{') && next.endsWith('}') && name.endsWith('s') && name.length > 3) {
        name = name.slice(0, -1)
      }
      cleanParts.push(capitalize(name))
    }
  }
  return method.toLowerCase() + cleanParts.join('')
}

function extractPathParams(route: string): string[] {
  const matches = route.match(/\{([^}]+)\}/g) || []
  return matches.map(m => m.slice(1, -1))
}

function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const tspScaffold: Command = {
  name: 'tsp-scaffold',
  description: 'TypeSpec operation 및 DTO 모델 스캐폴딩 생성/주입',
  options: {
    route: { type: 'string', short: 'r', required: true, description: '엔드포인트 HTTP 라우트 경로 (예: /users/{id}/audit)' },
    method: { type: 'string', short: 'm', description: 'HTTP 메서드 (get | post | put | patch | delete, 기본: get)' },
    'operation-id': { type: 'string', description: '생성할 operationId (기본: route와 method로부터 자동 생성)' },
    domain: { type: 'string', short: 'd', description: '도메인 이름' },
    summary: { type: 'string', description: 'Operation summary 설명' },
    auth: { type: 'string', description: '인증 데코레이터 적용 여부 (기본: bearerAuth, none으로 비활성화)' },
    file: { type: 'string', short: 'f', description: '주입 대상 .tsp 파일 경로' },
    output: { type: 'string', short: 'o', description: '생성된 TypeSpec 코드를 기록할 파일 경로 (미지정 시 대상 파일에 추가, - 는 stdout)' },
  },
  async run(args) {
    const route = str(args, 'route')
    const method = optStr(args, 'method') || 'get'
    const operationId = optStr(args, 'operation-id')
    const domain = optStr(args, 'domain')
    const summary = optStr(args, 'summary')
    const auth = optStr(args, 'auth')
    const file = optStr(args, 'file')
    const output = optStr(args, 'output')

    const scaffold = generateTypeSpecScaffold({
      route,
      method,
      operationId,
      domain,
      summary,
      auth,
    })

    if (output === '-' || (!output && !file)) {
      process.stdout.write(scaffold.code + '\n')
      return
    }

    if (output) {
      writeOutput(output, scaffold.code + '\n', 'TypeSpec scaffold')
      return
    }

    if (file) {
      const targetPath = resolve(process.cwd(), file)
      if (!existsSync(targetPath)) {
        throw new Error(`Target TypeSpec file not found: ${targetPath}`)
      }
      const existing = readFileSync(targetPath, 'utf8')
      const updated = existing.trimEnd() + '\n\n' + scaffold.code + '\n'
      writeFileSync(targetPath, updated, 'utf8')
      console.log(`✅ TypeSpec scaffold appended to: ${targetPath}`)
    }
  },
}
