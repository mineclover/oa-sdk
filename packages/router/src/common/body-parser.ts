export type RouterTarget = 'hono' | 'express' | 'fastify' | 'elysia'

/**
 * Determine the body-parsing expression based on the request content type(s).
 */
export function buildBodyParseLine(
  target: RouterTarget,
  contentTypes: string[],
  typeName: string,
  typed: boolean,
  required: boolean,
): string {
  const primary = contentTypes[0] ?? 'application/json'

  if (target === 'hono') {
    if (primary === 'application/json') {
      if (!required) {
        return typed
          ? `  const body = c.req.raw.body === null ? undefined : await c.req.json<${typeName}Body>()`
          : `  const body = c.req.raw.body === null ? undefined : await c.req.json() // ${typeName}Body`
      }
      return typed
        ? `  const body = await c.req.json<${typeName}Body>()`
        : `  const body = await c.req.json() // ${typeName}Body`
    }
    if (primary === 'multipart/form-data') {
      if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.formData() // ${typeName}Body`
      return `  const body = await c.req.formData() // ${typeName}Body`
    }
    if (primary === 'application/x-www-form-urlencoded') {
      if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.parseBody() // ${typeName}Body`
      return `  const body = await c.req.parseBody() // ${typeName}Body`
    }
    if (!required) return `  const body = c.req.raw.body === null ? undefined : await c.req.text() // ${typeName}Body`
    return `  const body = await c.req.text() // ${typeName}Body`
  }

  // express — body is already parsed by middleware
  if (primary === 'multipart/form-data') {
    return `  const body = req.body${typed ? ` as ${typeName}Body${required ? '' : ' | undefined'}` : ''} // ${typeName}Body (use multer middleware)`
  }
  if (primary === 'application/x-www-form-urlencoded') {
    return `  const body = req.body${typed ? ` as ${typeName}Body${required ? '' : ' | undefined'}` : ''} // ${typeName}Body (use express.urlencoded() middleware)`
  }
  if (typed) {
    return `  const body = req.body as ${typeName}Body${required ? '' : ' | undefined'}`
  }
  return `  const body = req.body // ${typeName}Body`
}
