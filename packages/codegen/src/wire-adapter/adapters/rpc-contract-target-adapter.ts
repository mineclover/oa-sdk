/**
 * RPC Service Contract Target Adapter
 *
 * Generates unified bidirectional RPC service contracts from TypeSpec SSOT:
 * - Server handlers interface for backend implementation (Fastify / Hono / Express / Elysia)
 * - Typed RPC client with automatic Protobuf / MessagePack wire compression
 *
 * @oa-sdk/codegen
 */

import type { TypeSpecWireTargetAdapter } from '../wire-adapter-types.js'
import type { WireSchemaModel, WireService, WireMethod } from '../wire-schema-model.js'

export interface RpcContractAdapterOptions {
  readonly typesImport?: string | undefined
  readonly clientImport?: string | undefined
}

export class RpcContractTargetAdapter implements TypeSpecWireTargetAdapter<string, RpcContractAdapterOptions> {
  public readonly id = 'rpc-contract'
  public readonly name = 'RPC Service Contract Target Adapter'
  public readonly target = 'rpc'
  public readonly fileExtension = '.ts'

  transform(model: WireSchemaModel, options: RpcContractAdapterOptions = {}): string {
    const lines: string[] = []

    lines.push('// Auto-generated RPC Service Contracts & Client from TypeSpec SSOT.')
    lines.push('// @oa-sdk/codegen RpcContractTargetAdapter')
    lines.push('')
    lines.push("import type { BinaryCodecAdapter } from '@oa-sdk/client'")

    if (options.typesImport) {
      const typeNames = model.models.map(m => m.name)
      if (typeNames.length > 0) {
        lines.push(`import type { ${typeNames.join(', ')} } from '${options.typesImport}'`)
      }
    }

    lines.push('')

    for (const svc of model.services) {
      lines.push(...this.renderServerHandlers(svc))
      lines.push('')
      lines.push(...this.renderClient(svc, model))
      lines.push('')
    }

    return lines.join('\n').trimEnd() + '\n'
  }

  private renderServerHandlers(svc: WireService): string[] {
    const lines: string[] = []
    const name = svc.serviceName ?? svc.name

    if (svc.doc) lines.push(`/** ${svc.doc} */`)
    lines.push(`export interface ${name}ServerHandlers<TContext = unknown> {`)
    for (const m of svc.methods) {
      const doc = m.doc ? `  /** ${m.doc} */\n` : ''
      const input = m.inputType === 'Empty' ? 'void' : m.inputType
      const output = m.outputType === 'Empty' ? 'void' : m.outputType
      lines.push(`${doc}  ${toCamelCase(m.name)}(request: ${input}, context: TContext): Promise<${output}> | ${output}`)
    }
    lines.push('}')
    lines.push('')
    lines.push(`export type ${name}Handler<TContext = unknown> = ${name}ServerHandlers<TContext>`)
    return lines
  }

  private renderClient(svc: WireService, model: WireSchemaModel): string[] {
    const lines: string[] = []
    const name = svc.serviceName ?? svc.name
    const clientName = `${name}RpcClient`

    lines.push(`export interface ${name}RpcClientOptions {`)
    lines.push('  readonly baseUrl: string')
    lines.push('  readonly headers?: Record<string, string> | undefined')
    lines.push('  readonly codecs?: Record<string, BinaryCodecAdapter<any>> | readonly BinaryCodecAdapter<any>[] | undefined')
    lines.push('  readonly fetch?: typeof globalThis.fetch | undefined')
    lines.push('}')
    lines.push('')

    lines.push(`export class ${clientName} {`)
    lines.push('  private readonly baseUrl: string')
    lines.push('  private readonly defaultHeaders: Record<string, string>')
    lines.push('  private readonly fetchImpl: typeof globalThis.fetch')
    lines.push('')
    lines.push(`  constructor(options: ${name}RpcClientOptions) {`)
    lines.push("    this.baseUrl = options.baseUrl.replace(/\\/+$/, '')")
    lines.push('    this.defaultHeaders = options.headers ?? {}')
    lines.push('    this.fetchImpl = options.fetch ?? globalThis.fetch')
    lines.push('  }')
    lines.push('')

    for (const m of svc.methods) {
      const methodName = toCamelCase(m.name)
      const input = m.inputType === 'Empty' ? '' : `request: ${m.inputType}, `
      const output = m.outputType === 'Empty' ? 'void' : m.outputType
      const path = m.route ?? `/${svc.name.toLowerCase()}/${m.name.toLowerCase()}`
      const httpMethod = m.httpMethod ?? 'POST'
      const wireFormat = m.wireFormat ?? 'protobuf'
      const mediaType = wireFormat === 'msgpack' ? 'application/msgpack' : 'application/x-protobuf'

      if (m.doc) lines.push(`  /** ${m.doc} */`)
      lines.push(`  async ${methodName}(${input}options?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<${output}> {`)
      lines.push(`    const url = \`\${this.baseUrl}${path}\``)
      lines.push('    const headers: Record<string, string> = {')
      lines.push('      ...this.defaultHeaders,')
      lines.push(`      'Content-Type': ${JSON.stringify(mediaType)},`)
      lines.push(`      'Accept': ${JSON.stringify(mediaType)},`)
      lines.push('      ...(options?.headers ?? {}),')
      lines.push('    }')
      lines.push('')
      lines.push(`    const init: RequestInit = {`)
      lines.push(`      method: ${JSON.stringify(httpMethod)},`)
      lines.push('      headers,')
      if (m.inputType !== 'Empty') {
        lines.push('      body: request as any,')
      }
      lines.push('      signal: options?.signal,')
      lines.push('    }')
      lines.push('')
      lines.push('    const res = await this.fetchImpl(url, init)')
      lines.push('    if (!res.ok) {')
      lines.push(`      throw new Error(\`RPC call ${m.name} failed with status \\\${res.status}: \\\${res.statusText}\`)`)
      lines.push('    }')
      if (m.outputType === 'Empty') {
        lines.push('    return')
      } else {
        lines.push(`    return await res.json() as ${output}`)
      }
      lines.push('  }')
      lines.push('')
    }

    lines.push('}')
    return lines
  }
}

function toCamelCase(str: string): string {
  return str.replace(/^[A-Z]/, c => c.toLowerCase())
}
