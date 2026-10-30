/**
 * Browser E2E harness: bundles the host and popup apps, serves them from three distinct origins
 * (host `localhost`, popup `127.0.0.1:A`, rogue `127.0.0.1:B`) and drives them with Chromium.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)))

export type Harness = {
  browser: Browser
  hostOrigin: string
  popupOrigin: string
  rogueOrigin: string
  close(): Promise<void>
}

function listen(server: Server): Promise<string> {
  return new Promise(resolvePromise => {
    server.listen(0, () => resolvePromise(String((server.address() as AddressInfo).port)))
  })
}

export async function startHarness(): Promise<Harness> {
  const out = await mkdtemp(join(tmpdir(), 'popup-bridge-e2e-'))
  await build({
    entry: { host: join(root, 'apps/host.ts'), popup: join(root, 'apps/popup.ts') },
    format: ['iife'],
    platform: 'browser',
    outDir: out,
    dts: false,
    silent: true,
    config: false,
    clean: false,
  })
  const hostJs = await readFile(join(out, 'host.global.js'), 'utf8')
  const popupJs = await readFile(join(out, 'popup.global.js'), 'utf8')

  let hostOrigin = ''
  const hostServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x')
    if (url.pathname === '/host.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(hostJs)
      return
    }
    const headers: Record<string, string> = { 'content-type': 'text/html' }
    if (url.searchParams.get('coop') === '1') headers['cross-origin-opener-policy'] = 'same-origin'
    response
      .writeHead(200, headers)
      .end('<!doctype html><title>host</title><button id="open">open</button><script src="/host.js"></script>')
  })
  const popupServer = (getHostOrigin: () => string) =>
    createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://x')
      if (url.pathname === '/popup.js') {
        response.writeHead(200, { 'content-type': 'text/javascript' }).end(popupJs)
        return
      }
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><title>popup</title><script>window.__CONFIG=${JSON.stringify({ hostOrigin: getHostOrigin() })}</script><script src="/popup.js"></script>`)
    })
  const popupA = popupServer(() => hostOrigin)
  const popupB = popupServer(() => hostOrigin)

  const [hostPort, popupPort, roguePort] = await Promise.all([listen(hostServer), listen(popupA), listen(popupB)])
  hostOrigin = `http://localhost:${hostPort}`
  // Strict site isolation puts the host and the popup in separate renderer processes, as in a real
  // browser; without it a hung popup page would also stall the host's timers.
  const browser = await chromium.launch({ headless: true, args: ['--site-per-process'] })
  return {
    browser,
    hostOrigin,
    popupOrigin: `http://127.0.0.1:${popupPort}`,
    rogueOrigin: `http://127.0.0.1:${roguePort}`,
    async close() {
      await browser.close()
      await Promise.all([hostServer, popupA, popupB].map(server => new Promise(done => server.close(done))))
      await rm(out, { recursive: true, force: true })
    },
  }
}

// ---- page helpers --------------------------------------------------------------------------

export type OpenResult = { ok: true; index: number } | { ok: false; code: string; message: string }

export type HostConfig = {
  url: string
  expectedOrigin?: string
  init?: unknown
  handshakeTimeoutMs?: number
  allowReconnect?: boolean
  closeWindowOnClose?: boolean
  heartbeat?: { intervalMs: number; timeoutMs: number }
  maxNotificationsPerSecond?: number
  features?: string[]
}

export async function newHostPage(context: BrowserContext, harness: Harness, query = ''): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${harness.hostOrigin}/${query}`)
  return page
}

/** Clicks the host's open button (a real gesture) and returns the popup page and the outcome. */
export async function openPopup(
  context: BrowserContext,
  host: Page,
  config: HostConfig,
): Promise<{ popup: Page; result: OpenResult }> {
  await host.evaluate(cfg => ((window as unknown as { __cfg: unknown }).__cfg = cfg), config)
  const popupPromise = context.waitForEvent('page')
  await host.click('#open')
  const popup = await popupPromise
  const result = await host.evaluate(() => (window as unknown as { __opening: Promise<OpenResult> }).__opening)
  return { popup, result }
}

export function call(host: Page, index: number, name: string, params?: unknown, options?: unknown) {
  return host.evaluate(
    async ([i, n, p, o]) => {
      const session = (window as unknown as { __sessions: Array<{ call(n: string, p?: unknown, o?: unknown): Promise<unknown> }> }).__sessions[i as number]!
      try {
        return { ok: true as const, value: await session.call(n as string, p, o) }
      } catch (error) {
        return { ok: false as const, code: (error as { code?: string }).code ?? 'UNKNOWN' }
      }
    },
    [index, name, params, options] as const,
  )
}

export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last value: ${JSON.stringify(value)}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

/** Clicks the button of a popup that opens a popup of its own, and returns the new page. */
export async function openNested(
  context: BrowserContext,
  parent: Page,
  url: string,
): Promise<{ child: Page; result: { ok: true } | { ok: false; code: string } }> {
  await parent.evaluate(target => ((window as unknown as { __openBUrl: string }).__openBUrl = target), url)
  const childPromise = context.waitForEvent('page')
  await parent.click('#open-b')
  const child = await childPromise
  const result = await parent.evaluate(() => (window as unknown as { __openingB: Promise<{ ok: true } | { ok: false; code: string }> }).__openingB)
  return { child, result }
}
