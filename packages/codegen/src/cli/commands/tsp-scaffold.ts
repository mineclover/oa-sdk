import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bool, optStr, str } from '../lib/args.js'
import { writeOutput } from '../lib/output.js'
import type { Command } from '../lib/types.js'

export interface ScaffoldOptions {
  route: string
  method?: string | undefined
  operationId?: string | undefined
  summary?: string | undefined
  domain?: string | undefined
  auth?: string | undefined
  crud?: boolean | undefined
  envelope?: boolean | undefined
  resource?: string | undefined
}

export function generateTypeSpecScaffold(options: ScaffoldOptions): {
  operationId: string
  code: string
  requestModelName?: string | undefined
  responseModelName: string
} {
  if (options.crud) {
    return generateCrudScaffold(options)
  }

  const method = (options.method || 'get').toLowerCase()
  const route = options.route.startsWith('/') ? options.route : `/${options.route}`
  const domain = options.domain || inferDomain(route)
  const operationId = options.operationId || inferOperationId(method, route)
  const summary = options.summary || `${operationId} operation`
  const auth = options.auth || 'bearerAuth'
  const useEnvelope = options.envelope === true

  const pathParams = extractPathParams(route)
  const hasBody = ['post', 'put', 'patch'].includes(method)
  const capitalizedOpId = capitalize(operationId)

  const requestModelName = hasBody ? `${capitalizedOpId}Request` : undefined
  const statusCode = method === 'post' ? 201 : 200

  let responseModelName: string
  const lines: string[] = []

  // 1. Request model (if body expected)
  if (hasBody && requestModelName) {
    lines.push(`@doc("${summary} 요청 본문")`)
    lines.push(`model ${requestModelName} {`)
    lines.push(`  // TODO: 요청 필드를 정의하세요`)
    lines.push(`}`)
    lines.push(``)
  }

  // 2. Response model / envelope
  if (useEnvelope) {
    if (method === 'delete') {
      responseModelName = 'NoContent'
    } else if (method === 'post') {
      const resultDto = `${capitalizedOpId}Result`
      lines.push(`@doc("${summary} 결과 DTO")`)
      lines.push(`model ${resultDto} {`)
      lines.push(`  id: string;`)
      lines.push(`}`)
      lines.push(``)
      responseModelName = `Created<${resultDto}>`
    } else {
      const resultDto = `${capitalizedOpId}Result`
      lines.push(`@doc("${summary} 결과 DTO")`)
      lines.push(`model ${resultDto} {`)
      lines.push(`  id: string;`)
      lines.push(`}`)
      lines.push(``)
      responseModelName = `Ok<${resultDto}>`
    }
  } else {
    responseModelName = `${capitalizedOpId}${statusCode}Response`
    lines.push(`@doc("${summary} 성공 응답")`)
    lines.push(`model ${responseModelName} {`)
    lines.push(`  @statusCode statusCode: ${statusCode};`)
    lines.push(`  @body body: {`)
    lines.push(`    // TODO: 응답 필드를 정의하세요`)
    lines.push(`    id: string;`)
    lines.push(`  };`)
    lines.push(`}`)
    lines.push(``)
  }

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

function generateCrudScaffold(options: ScaffoldOptions): {
  operationId: string
  code: string
  requestModelName?: string | undefined
  responseModelName: string
} {
  const rawRoute = options.route.startsWith('/') ? options.route : `/${options.route}`
  const baseRoute = rawRoute.replace(/\/\{[^}]+\}.*$/, '').replace(/\/$/, '')
  const domain = options.domain || inferDomain(baseRoute)
  const resourceName = options.resource || inferSingularResource(baseRoute)
  const pluralName = capitalize(domain)
  const auth = options.auth || 'bearerAuth'
  const useEnvelope = options.envelope ?? true

  const lines: string[] = []

  // Models & DTOs
  lines.push(`@doc("${resourceName} 리소스 엔티티")`)
  lines.push(`model ${resourceName} {`)
  lines.push(`  @format("uuid")`)
  lines.push(`  id: string;`)
  lines.push(`  createdAt: utcDateTime;`)
  lines.push(`  updatedAt?: utcDateTime;`)
  lines.push(`}`)
  lines.push(``)

  lines.push(`@doc("${resourceName} 생성 요청")`)
  lines.push(`model Create${resourceName}Request {`)
  lines.push(`  // TODO: 생성 필드를 정의하세요`)
  lines.push(`}`)
  lines.push(``)

  lines.push(`@doc("${resourceName} 수정 요청 (부분 업데이트)")`)
  lines.push(`model Update${resourceName}Request {`)
  lines.push(`  // TODO: 수정 필드를 정의하세요`)
  lines.push(`}`)
  lines.push(``)

  if (!useEnvelope) {
    lines.push(`@doc("${resourceName} 목록 응답")`)
    lines.push(`model List${pluralName}200Response {`)
    lines.push(`  @statusCode statusCode: 200;`)
    lines.push(`  @body body: {`)
    lines.push(`    items: ${resourceName}[];`)
    lines.push(`    @minValue(0)`)
    lines.push(`    total: integer;`)
    lines.push(`  };`)
    lines.push(`}`)
    lines.push(``)

    lines.push(`@doc("${resourceName} 단건 조회 성공")`)
    lines.push(`model Get${resourceName}ById200Response {`)
    lines.push(`  @statusCode statusCode: 200;`)
    lines.push(`  @body body: ${resourceName};`)
    lines.push(`}`)
    lines.push(``)

    lines.push(`@doc("${resourceName} 생성 완료")`)
    lines.push(`model Create${resourceName}201Response {`)
    lines.push(`  @statusCode statusCode: 201;`)
    lines.push(`  @body body: ${resourceName};`)
    lines.push(`}`)
    lines.push(``)

    lines.push(`@doc("${resourceName} 수정 완료")`)
    lines.push(`model Update${resourceName}200Response {`)
    lines.push(`  @statusCode statusCode: 200;`)
    lines.push(`  @body body: ${resourceName};`)
    lines.push(`}`)
    lines.push(``)

    lines.push(`@doc("${resourceName} 삭제 완료")`)
    lines.push(`model Delete${resourceName}204Response {`)
    lines.push(`  @statusCode statusCode: 204;`)
    lines.push(`}`)
    lines.push(``)
  }

  const authLine = auth !== 'none' ? `\n@useAuth(${auth})` : ''

  // 1. List
  const listResp = useEnvelope ? `Ok<PageResult<${resourceName}>>` : `List${pluralName}200Response`
  lines.push(`@summary("${resourceName} 목록 조회")`)
  lines.push(`@doc("${resourceName} 목록을 페이지네이션으로 조회합니다.")`)
  lines.push(`@tag("${domain}")${authLine}`)
  lines.push(`@operationId("list${pluralName}")`)
  lines.push(`@route("${baseRoute}")`)
  lines.push(`@get`)
  lines.push(`@oaUseResponseComponent("400", "BadRequest")`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`op list${pluralName}(`)
  lines.push(`  @doc("페이지 번호 (1-based)") @query page?: integer = 1,`)
  lines.push(`  @doc("페이지당 항목 수") @query limit?: integer = 20,`)
  lines.push(`): ${listResp};`)
  lines.push(``)

  // 2. GetById
  const getResp = useEnvelope ? `Ok<${resourceName}>` : `Get${resourceName}ById200Response`
  lines.push(`@summary("${resourceName} 단건 조회")`)
  lines.push(`@doc("ID로 ${resourceName} 단건 정보를 조회합니다.")`)
  lines.push(`@tag("${domain}")${authLine}`)
  lines.push(`@operationId("get${resourceName}ById")`)
  lines.push(`@route("${baseRoute}/{id}")`)
  lines.push(`@get`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`@oaUseResponseComponent("404", "NotFound")`)
  lines.push(`op get${resourceName}ById(@doc("${resourceName} ID") @path id: string): ${getResp};`)
  lines.push(``)

  // 3. Create
  const createResp = useEnvelope ? `Created<${resourceName}>` : `Create${resourceName}201Response`
  lines.push(`@summary("${resourceName} 생성")`)
  lines.push(`@doc("신규 ${resourceName} 리소스를 등록합니다.")`)
  lines.push(`@tag("${domain}")${authLine}`)
  lines.push(`@operationId("create${resourceName}")`)
  lines.push(`@route("${baseRoute}")`)
  lines.push(`@post`)
  lines.push(`@oaUseResponseComponent("400", "BadRequest")`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`op create${resourceName}(@body body: Create${resourceName}Request): ${createResp};`)
  lines.push(``)

  // 4. Update
  const updateResp = useEnvelope ? `Ok<${resourceName}>` : `Update${resourceName}200Response`
  lines.push(`@summary("${resourceName} 수정")`)
  lines.push(`@doc("기존 ${resourceName} 리소스를 수정합니다.")`)
  lines.push(`@tag("${domain}")${authLine}`)
  lines.push(`@operationId("update${resourceName}")`)
  lines.push(`@route("${baseRoute}/{id}")`)
  lines.push(`@put`)
  lines.push(`@oaUseResponseComponent("400", "BadRequest")`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`@oaUseResponseComponent("404", "NotFound")`)
  lines.push(`op update${resourceName}(`)
  lines.push(`  @doc("${resourceName} ID") @path id: string,`)
  lines.push(`  @body body: Update${resourceName}Request,`)
  lines.push(`): ${updateResp};`)
  lines.push(``)

  // 5. Delete
  const deleteResp = useEnvelope ? `NoContent` : `Delete${resourceName}204Response`
  lines.push(`@summary("${resourceName} 삭제")`)
  lines.push(`@doc("${resourceName} 리소스를 영구 삭제합니다.")`)
  lines.push(`@tag("${domain}")${authLine}`)
  lines.push(`@operationId("delete${resourceName}")`)
  lines.push(`@route("${baseRoute}/{id}")`)
  lines.push(`@delete`)
  lines.push(`@oaUseResponseComponent("401", "Unauthorized")`)
  lines.push(`@oaUseResponseComponent("404", "NotFound")`)
  lines.push(`op delete${resourceName}(@doc("${resourceName} ID") @path id: string): ${deleteResp};`)

  return {
    operationId: `crud${resourceName}`,
    code: lines.join('\n'),
    requestModelName: `Create${resourceName}Request`,
    responseModelName: useEnvelope ? `Ok<${resourceName}>` : `Get${resourceName}ById200Response`,
  }
}

function inferDomain(route: string): string {
  const parts = route.split('/').filter(p => p && !p.startsWith('{'))
  return parts[0] ?? 'default'
}

function inferSingularResource(route: string): string {
  const parts = route.split('/').filter(p => p && !p.startsWith('{'))
  const lastPart = parts[parts.length - 1] ?? 'item'
  let name = lastPart
  if (name.endsWith('ies')) {
    name = name.slice(0, -3) + 'y'
  } else if (name.endsWith('es') && (name.endsWith('ches') || name.endsWith('shes') || name.endsWith('sses') || name.endsWith('xes'))) {
    name = name.slice(0, -2)
  } else if (name.endsWith('s') && name.length > 3) {
    name = name.slice(0, -1)
  }
  return capitalize(name)
}

function inferOperationId(method: string, route: string): string {
  const parts = route.split('/').filter(Boolean)
  const cleanParts: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
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
    crud: { type: 'boolean', description: '리소스 전체 CRUD 엔드포인트 및 DTO 일괄 생성' },
    envelope: { type: 'boolean', description: '표준 제네릭 응답 래퍼(Ok<T>, Created<T>, NoContent, PageResult<T>) 사용' },
    resource: { type: 'string', description: 'CRUD 대상 리소스 이름 (기본: 라우트 경로로부터 자동 유추)' },
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
    const crud = bool(args, 'crud')
    const envelope = bool(args, 'envelope')
    const resource = optStr(args, 'resource')
    const file = optStr(args, 'file')
    const output = optStr(args, 'output')

    const scaffold = generateTypeSpecScaffold({
      route,
      method,
      operationId,
      domain,
      summary,
      auth,
      crud,
      envelope,
      resource,
    })

    if (output === '-' || (!output && !file)) {
      process.stdout.write(scaffold.code + '\n')
      return
    }

    if (output) {
      const targetPath = resolve(process.cwd(), output)
      const isNew = !existsSync(targetPath)
      let content = scaffold.code
      if (isNew) {
        const headerLines: string[] = [
          'import "@typespec/http";',
          'import "@typespec/openapi";',
          '',
          'using Http;',
          'using OpenAPI;',
        ]
        if (envelope) {
          headerLines.push('')
          headerLines.push('// 표준 응답 엔벨롭 템플릿')
          headerLines.push('model Ok<T> {')
          headerLines.push('  @statusCode statusCode: 200;')
          headerLines.push('  @body body: T;')
          headerLines.push('}')
          headerLines.push('')
          headerLines.push('model Created<T> {')
          headerLines.push('  @statusCode statusCode: 201;')
          headerLines.push('  @body body: T;')
          headerLines.push('}')
          headerLines.push('')
          headerLines.push('model NoContent<T = void> {')
          headerLines.push('  @statusCode statusCode: 204;')
          headerLines.push('}')
          headerLines.push('')
          headerLines.push('model PageResult<T> {')
          headerLines.push('  items: T[];')
          headerLines.push('  @minValue(0)')
          headerLines.push('  total: integer;')
          headerLines.push('  @minValue(1)')
          headerLines.push('  page?: integer = 1;')
          headerLines.push('  @minValue(1)')
          headerLines.push('  @maxValue(100)')
          headerLines.push('  limit?: integer = 20;')
          headerLines.push('}')
        }
        content = headerLines.join('\n') + '\n\n' + content
      }
      writeOutput(output, content + '\n', 'TypeSpec scaffold')
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

export default tspScaffold
