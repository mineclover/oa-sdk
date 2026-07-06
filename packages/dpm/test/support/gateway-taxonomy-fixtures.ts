import { getDpmGatewayOpenApiDocument } from '../../src/index.js'

export function getDpmGatewaySchema(name: string): Record<string, any> {
  const schema = getDpmGatewayOpenApiDocument().components?.schemas?.[name]
  if (!schema || typeof schema !== 'object') {
    throw new Error(`expected DPM gateway schema: ${name}`)
  }
  return schema as Record<string, any>
}
