import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createNodeMockServer,
  type NodeMockServer,
  matchRoute,
  handleRequest,
  filterRouteIndex,
  assertValidRequestSchemas,
} from '@oa-sdk/mock-server'
import { parseDocument, assertParsedDocumentComplete, type OasDocument } from '@oa-sdk/parser'

export interface MockServerInstance {
  server: NodeMockServer & { updateSpec?: (doc: any) => { routesCount: number } }
  url: string
  stop: () => Promise<void>
  updateSpec: (doc: any) => { routesCount: number }
}

/**
 * Creates an in-memory mock server supporting atomic updateSpec for hot reload testing.
 */
export async function startInMemoryMockServer(
  spec: Record<string, any>,
  options: { port?: number; host?: string } = {},
): Promise<MockServerInstance> {
  const host = options.host ?? '127.0.0.1'
  let currentSpec = spec
  let parsed = parseDocument(currentSpec as OasDocument)
  assertParsedDocumentComplete(parsed, 'startInMemoryMockServer')

  let index = filterRouteIndex(parsed.routes)
  assertValidRequestSchemas(index)

  let serverInstance: http.Server | null = null
  let actualPort = options.port ?? 0

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const method = (req.method ?? 'GET').toLowerCase() as any
    const rawUrl = req.url ?? '/'
    const parsedUrl = new URL(rawUrl, `http://${host}:${actualPort}`)
    const urlPath = parsedUrl.pathname

    const matched = matchRoute(index, method, urlPath)

    if (matched.type === 'not_found') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 'NOT_FOUND', message: `${method.toUpperCase()} ${urlPath} not found` }))
      return
    }

    if (matched.type === 'method_not_allowed') {
      res.writeHead(405, { 'Content-Length': '0' })
      res.end()
      return
    }

    const { entry, pathParams } = matched

    // Read body
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const rawBody = Buffer.concat(chunks).toString('utf8')
    let body: any = undefined
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        body = rawBody
      }
    }

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') {
        headers[k] = v
        headers[k.toLowerCase()] = v
      } else if (Array.isArray(v)) {
        headers[k] = v[0] ?? ''
        headers[k.toLowerCase()] = v[0] ?? ''
      }
    }

    const hr = handleRequest(
      {
        pathParams,
        queryParams: Object.fromEntries(parsedUrl.searchParams.entries()),
        headers,
        body,
        url: parsedUrl.toString(),
      },
      entry,
      parsed.securitySchemes,
    )

    if (hr.type === 'validation-error') {
      res.writeHead(hr.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(hr.body))
      return
    }

    if (hr.type === 'schema-error' || hr.type === 'no-response') {
      res.writeHead(hr.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(hr.body))
      return
    }

    const picked = hr.picked
    res.writeHead(picked.status, {
      ...picked.headers,
      'Content-Type': picked.contentType ?? 'application/json',
    })
    const payload = typeof picked.body === 'string' ? picked.body : JSON.stringify(picked.body)
    res.end(payload)
  }

  const server = http.createServer(requestHandler)

  await new Promise<void>((resolve, reject) => {
    server.listen(actualPort, host, () => {
      const addr = server.address() as AddressInfo
      actualPort = addr.port
      resolve()
    })
    server.on('error', reject)
  })

  const url = `http://${host}:${actualPort}`

  const updateSpec = (nextSpec: Record<string, any>) => {
    currentSpec = nextSpec
    parsed = parseDocument(currentSpec as OasDocument)
    assertParsedDocumentComplete(parsed, 'updateSpec')
    index = filterRouteIndex(parsed.routes)
    assertValidRequestSchemas(index)
    return { routesCount: index.size }
  }

  const stop = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  return {
    server: server as any,
    url,
    stop,
    updateSpec,
  }
}

/**
 * Convenience helper to fetch from the running mock server.
 */
export async function fetchMock(
  baseUrl: string,
  pathname: string,
  options: RequestInit = {},
): Promise<{
  status: number
  headers: Headers
  text: string
  json: () => any
}> {
  const fullUrl = new URL(pathname, baseUrl).toString()
  const res = await fetch(fullUrl, options)
  const text = await res.text()

  return {
    status: res.status,
    headers: res.headers,
    text,
    json: () => (text ? JSON.parse(text) : null),
  }
}
