export type RouterTarget = 'hono' | 'express' | 'fastify' | 'elysia'

/**
 * Emits the __readOaRawQuerystring helper function definition for raw OAS 3.2 querystrings.
 */
export function renderRawQuerystringHelper(): string {
  return [
    `function __readOaRawQuerystring(url: string): string | undefined {`,
    `  const question = url.indexOf('?')`,
    `  if (question === -1) return undefined`,
    `  const hash = url.indexOf('#', question + 1)`,
    `  return url.slice(question + 1, hash === -1 ? undefined : hash)`,
    `}`,
  ].join('\n')
}

/**
 * Checks whether any operation in the list declares an `in: 'querystring'` parameter.
 */
export function hasRawQuerystringParameter(
  operations: ReadonlyArray<{ parameters: ReadonlyArray<{ in: string }> }>,
): boolean {
  return operations.some(op => op.parameters.some(p => p.in === 'querystring'))
}

/**
 * Builds the framework-specific raw querystring extraction line.
 */
export function buildRawQuerystringExtraction(
  target: RouterTarget,
  typeName: string,
  hasTypes: boolean,
): string {
  const type = hasTypes ? `${typeName}QueryString` : 'string'
  switch (target) {
    case 'hono':
      return `const querystring = __readOaRawQuerystring(c.req.raw.url) as ${type} | undefined // raw serialized query string; no leading '?'`
    case 'express':
      return `const querystring = __readOaRawQuerystring(req.originalUrl ?? req.url) as ${type} | undefined // raw serialized query string; no leading '?'`
    case 'fastify':
      return `const querystring = __readOaRawQuerystring(request.raw.url ?? request.url) as ${type} | undefined // raw serialized query string; no leading '?'`
    case 'elysia':
      return `const querystring = __readOaRawQuerystring(request.url) as ${type} | undefined // raw serialized query string; no leading '?'`
  }
}
