import {
  defineContract,
  definePopup,
  event,
  method,
  withTransfer,
  type Clock,
  type SecurityEvent,
} from '../src/index.js'
import { createPopupBridge } from '../src/host.js'
import { createPopupRuntime, type PopupConnection, type PopupRuntime } from '../src/popup.js'
import { createMemoryBrowser, type MemoryPopupPage } from '../src/testing.js'

export type Init = { documentId: string; locale: string }

export const assetContract = defineContract({
  id: 'asset-selector',
  init: (value: unknown): Init => {
    const v = value as Partial<Init> | null
    if (typeof v?.documentId !== 'string' || typeof v.locale !== 'string') throw new Error('documentId and locale are required')
    return v as Init
  },
  methods: {
    'asset.select': method<{ multiple?: boolean }, { assetIds: string[] }>({ permission: 'assets:read' }),
    'asset.getSnapshot': method<void, { revision: number; assetIds: string[] }>(),
    'asset.save': method<{ name: string }, { saved: number }>(),
    'asset.readSelection': method<void, { text: string }>(),
    'asset.upload': method<{ bytes: ArrayBuffer }, { length: number }>(),
    'asset.download': method<{ size: number }, { bytes: ArrayBuffer }>(),
  },
  events: {
    'asset.selectionChanged': event<{ assetIds: string[] }>(),
    'asset.progress': event<{ percent: number }>({ replay: { capacity: 8 } }),
    // High-frequency events, merged inside a 50 ms window.
    'asset.cursorMoved': event<{ x: number; y: number }>({ coalesce: { windowMs: 50, strategy: 'latest' } }),
    'asset.itemsTouched': event<{ ids: string[] }>({
      coalesce: { windowMs: 50, strategy: (accumulated, next) => ({ ids: [...new Set([...accumulated.ids, ...next.ids])] }) },
    }),
    'asset.hover': event<{ id: string }>({ coalesce: { windowMs: 50, strategy: 'latest', leading: true } }),
    'asset.scrolled': event<{ top: number }>({ replay: { capacity: 8 }, coalesce: { windowMs: 50, strategy: 'latest' } }),
  },
  host: { 'host.document.getSelection': method<void, { text: string }>({ permission: 'document:read' }) },
})

export const definition = definePopup(assetContract, { url: 'https://tools.example.com/asset-selector' })

export type Booted = {
  freeze(): void
  runtime: PopupRuntime<typeof assetContract>
  page: MemoryPopupPage
  inits: Init[]
  /** What the popup knew about the negotiated features while `onInit` ran. */
  initFeatures: Array<{ context: string[]; link: string[] }>
  /** Resolves with the connection, or `undefined` when `start()` failed. */
  started: Promise<PopupConnection | undefined>
  saves: number
}

export type SetupOptions = {
  /** Delay before the popup application boots (page loading latency). */
  bootDelayMs?: number
  /** Skip booting the popup entirely (it never says HELLO). */
  silent?: boolean
  allowedHostOrigins?: string[]
  onInit?: (init: Init) => void | Promise<void>
  skipRegister?: string[]
  onSecurity?: (event: SecurityEvent) => void
  popupAuthorize?: Parameters<typeof createPopupRuntime>[0]['authorize']
  popupProtocolVersions?: string[]
  /** Later page loads (reloads) stay silent. */
  bootFirstOnly?: boolean
  /** Lets a test hang the popup: after `freeze()` it no longer reads its port. */
  freezable?: boolean
  popupLimits?: Parameters<typeof createPopupRuntime>[0]['limits']
  /** Features the popup offers; a function is read on every page load, so a reload can change the offer. */
  popupFeatures?: readonly string[] | (() => readonly string[])
  /** Drives every timer of both sides; without it the system clock is used. */
  clock?: Clock
  popupOnError?: (error: unknown) => void
  /** HELLO retry of the popup; default: the runtime's own. */
  popupHelloRetry?: Parameters<typeof createPopupRuntime>[0]['helloRetry']
  /** How long the popup waits for the host to connect. Default 400 ms. */
  popupHandshakeTimeoutMs?: number
  /** Passed to every popup runtime, e.g. to watch its retries. */
  popupNode?: Parameters<typeof createPopupRuntime>[0]['node']
}

/** Wraps the port the host handed over so a test can make the popup stop reading it (a hung page). */
function freezablePort(port: MessagePort, isFrozen: () => boolean): MessagePort {
  const gated = new Map<unknown, EventListener>()
  const wrapper = {
    addEventListener(type: string, listener: EventListener) {
      const guarded: EventListener = event => {
        if (!isFrozen()) listener(event)
      }
      gated.set(listener, guarded)
      port.addEventListener(type, guarded)
    },
    removeEventListener(type: string, listener: EventListener) {
      const guarded = gated.get(listener)
      if (guarded !== undefined) port.removeEventListener(type, guarded)
    },
    start: () => port.start(),
    close: () => port.close(),
    postMessage: (message: unknown, transfer?: Transferable[]) => port.postMessage(message, transfer ?? []),
  }
  return wrapper as unknown as MessagePort
}

export function setup(options: SetupOptions = {}) {
  const browser = createMemoryBrowser(options.clock === undefined ? {} : { clock: options.clock })
  const booted: Booted[] = []
  let saveRuns = 0
  browser.onPopupLoad(page => {
    if (options.silent || (options.bootFirstOnly && booted.length > 0)) return
    const boot = () => {
      let frozen = false
      const env = options.freezable
        ? {
            ...page.env,
            host: page.env.host,
            hash: page.env.hash,
            listen: (listener: Parameters<typeof page.env.listen>[0]) =>
              page.env.listen(message => listener({ ...message, ports: message.ports.map(port => freezablePort(port, () => frozen)) })),
          }
        : page.env
      const runtime = createPopupRuntime({
        contract: assetContract,
        allowedHostOrigins: options.allowedHostOrigins ?? [browser.hostOrigin],
        env,
        ...(options.popupLimits === undefined ? {} : { limits: options.popupLimits }),
        handshakeTimeoutMs: options.popupHandshakeTimeoutMs ?? 400,
        ...(options.popupHelloRetry === undefined ? {} : { helloRetry: options.popupHelloRetry }),
        ...(options.popupNode === undefined ? {} : { node: options.popupNode }),
        ...(options.popupOnError === undefined ? {} : { onError: options.popupOnError }),
        openerPollMs: 20,
        ...(options.popupFeatures === undefined
          ? {}
          : { features: typeof options.popupFeatures === 'function' ? options.popupFeatures() : options.popupFeatures }),
        ...(options.popupProtocolVersions === undefined ? {} : { protocolVersions: options.popupProtocolVersions }),
        ...(options.popupAuthorize === undefined ? {} : { authorize: options.popupAuthorize }),
        ...(options.onSecurity === undefined ? {} : { onSecurityEvent: options.onSecurity }),
        onInit: async (init, context) => {
          entry.inits.push(init)
          entry.initFeatures.push({ context: [...context.features.ids], link: [...runtime.link.features.ids] })
          await options.onInit?.(init)
        },
      })
      const skip = new Set(options.skipRegister ?? [])
      const handlers = {
        'asset.select': async (params: { multiple?: boolean }) => ({ assetIds: params.multiple ? ['a1', 'a2'] : ['a1'] }),
        'asset.getSnapshot': () => ({ revision: 0, assetIds: ['a1'] }),
        'asset.save': async (params: { name: string }) => {
          saveRuns++
          entry.saves++
          await new Promise(r => setTimeout(r, 30))
          return { saved: params.name.length }
        },
        'asset.readSelection': () => runtime.host.call('host.document.getSelection'),
        'asset.upload': (params: { bytes: ArrayBuffer }) => ({ length: params.bytes.byteLength }),
        'asset.download': (params: { size: number }) => {
          const bytes = new ArrayBuffer(params.size)
          return withTransfer({ bytes }, [bytes])
        },
      }
      for (const [name, handler] of Object.entries(handlers)) {
        if (!skip.has(name)) runtime.register(name as keyof typeof handlers, handler as never)
      }
      const entry: Booted = { freeze: () => { frozen = true }, runtime, page, inits: [], initFeatures: [], started: runtime.start().catch(() => undefined), saves: 0 }
      booted.push(entry)
    }
    if (options.bootDelayMs === undefined) boot()
    else setTimeout(boot, options.bootDelayMs)
  })
  const securityEvents: SecurityEvent[] = []
  const bridge = createPopupBridge({ env: browser.hostEnv, defaults: { closedPollMs: 20, onSecurityEvent: e => securityEvents.push(e) } })
  return { browser, bridge, booted, securityEvents, saveRuns: () => saveRuns }
}

export const init: Init = { documentId: 'doc-123', locale: 'ko-KR' }
