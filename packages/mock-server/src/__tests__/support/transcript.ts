/**
 * Replays requests against the Node HTTP and MSW adapters and records the
 * response bytes (status, headers, body text) each one produced.
 */
import { getResponse, type RequestHandler } from 'msw'
import type { NodeMockServer } from '../../adapters/node-http.js'
import type { TranscriptRequest } from '../fixtures/response-bytes.js'

export type Exchange = {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Connection-management headers depend on the HTTP client and wall clock, not
 * on the mock, so they are left out of recorded exchanges.
 */
const TRANSPORT_HEADERS = new Set(['date', 'keep-alive', 'connection'])

export async function recordExchange(response: Response): Promise<Exchange> {
  const headers: Record<string, string> = {}
  for (const [name, value] of [...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!TRANSPORT_HEADERS.has(name)) headers[name] = value
  }
  return { status: response.status, headers, body: await response.text() }
}

export async function replayOnNode(
  server: NodeMockServer,
  requests: readonly TranscriptRequest[],
): Promise<Record<string, Exchange>> {
  const transcript: Record<string, Exchange> = {}
  for (const request of requests) {
    const response = await fetch(`${server.url}${request.path}`, toRequestInit(request))
    transcript[request.name] = await recordExchange(response)
  }
  return transcript
}

/**
 * Resolves each request through MSW's own handler matching, in process. A
 * request no handler claims is recorded as `undefined`.
 */
export async function replayOnMsw(
  handlers: RequestHandler[],
  origin: string,
  requests: readonly TranscriptRequest[],
): Promise<Record<string, Exchange | undefined>> {
  const transcript: Record<string, Exchange | undefined> = {}
  for (const request of requests) {
    const response = await getResponse(handlers, new Request(`${origin}${request.path}`, toRequestInit(request)))
    transcript[request.name] = response ? await recordExchange(response) : undefined
  }
  return transcript
}

function toRequestInit(request: TranscriptRequest): RequestInit {
  return {
    method: request.method,
    ...(request.headers !== undefined && { headers: request.headers }),
    ...(request.body !== undefined && { body: request.body }),
  }
}
