/**
 * Host page of the browser E2E. Tests configure `window.__cfg`, click `#open` (a real user
 * gesture, so the popup is allowed) and then drive the session through the `__sessions` list.
 */
import { createBridgeNode, definePopup, defineSharedState, type BridgeNode, type OwnedState } from '../../src/index.js'
import { createPopupBridge, type PopupSession, type ReconnectInfo } from '../../src/host.js'
import { contract } from './contract.js'

type Config = {
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

type Opening = { ok: true; index: number } | { ok: false; code: string; message: string }

const w = window as unknown as {
  __cfg: Config
  __opening: Promise<Opening>
  __sessions: PopupSession<typeof contract>[]
  __events: Record<string, Array<{ revision: number; gap: boolean; replayed: boolean; payload: unknown }>>
  __closeInfo: Record<number, unknown>
  __reconnects: Record<number, number>
  __reconnectInfo: Record<number, ReconnectInfo>
  __resync(index: number): Promise<unknown>
  __subscribe(index: number, name: 'asset.selectionChanged' | 'asset.progress'): Promise<void>
  __securityEvents: unknown[]
  __transferTest(index: number, size: number): Promise<{ length: number; detachedAfter: number; downloaded: number }>
  __node: BridgeNode
  __toasts: { intent?: string; visibility: string }[]
  __ownSelection(initial: string[]): void
  __owned?: OwnedState<{ ids: string[] }>
}

w.__sessions = []
w.__events = {}
w.__closeInfo = {}
w.__reconnects = {}
w.__reconnectInfo = {}
w.__securityEvents = []

w.__toasts = []
const selection = defineSharedState<{ ids: string[] }>({ name: 'document.selection', initial: { ids: [] }, writable: true })
w.__node = createBridgeNode({
  name: 'root',
  topology: true,
  attention: {
    minIntervalMs: 0,
    blinkIntervalMs: 100,
    focusSettleMs: 50,
    onAttention: (request, context) => w.__toasts.push({ ...(request.intent === undefined ? {} : { intent: request.intent }), visibility: context.visibility }),
  },
})
w.__ownSelection = initial => {
  w.__owned = w.__node.state.own(selection, { initial: { ids: initial } })
}

const bridge = createPopupBridge({ node: w.__node, defaults: { closedPollMs: 100, onSecurityEvent: e => w.__securityEvents.push(e) } })

w.__subscribe = async (index, name) => {
  const session = w.__sessions[index]!
  w.__events[index] = []
  await session.subscribe(name, (payload, meta) => w.__events[index]!.push({ revision: meta.revision, gap: meta.gap, replayed: meta.replayed, payload }))
}

w.__resync = index => w.__sessions[index]!.resync()

w.__transferTest = async (index, size) => {
  const session = w.__sessions[index]!
  const bytes = new ArrayBuffer(size)
  const uploaded = await session.call('asset.upload', { bytes }, { transfer: [bytes] })
  const downloaded = await session.call('asset.download', { size })
  return { length: uploaded.length, detachedAfter: bytes.byteLength, downloaded: downloaded.bytes.byteLength }
}

document.getElementById('open')!.addEventListener('click', () => {
  // Everything up to `bridge.open` is synchronous: the window opens inside the click.
  const cfg = w.__cfg
  const definition = definePopup(contract, {
    url: cfg.url,
    ...(cfg.expectedOrigin === undefined ? {} : { expectedOrigin: cfg.expectedOrigin }),
  })
  w.__opening = bridge
    .open(definition, {
      init: (cfg.init ?? { documentId: 'doc-123', locale: 'ko-KR' }) as never,
      host: { 'host.document.getSelection': () => ({ text: 'selected words' }) },
      ...(cfg.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: cfg.handshakeTimeoutMs }),
      ...(cfg.allowReconnect === undefined ? {} : { allowReconnect: cfg.allowReconnect }),
      ...(cfg.closeWindowOnClose === undefined ? {} : { closeWindowOnClose: cfg.closeWindowOnClose }),
      ...(cfg.heartbeat === undefined ? {} : { heartbeat: cfg.heartbeat }),
      ...(cfg.features === undefined ? {} : { features: cfg.features }),
      ...(cfg.maxNotificationsPerSecond === undefined ? {} : { limits: { maxNotificationsPerSecond: cfg.maxNotificationsPerSecond } }),
    })
    .then(
      (session): Opening => {
        const index = w.__sessions.push(session) - 1
        w.__reconnects[index] = 0
        session.on('reconnect', info => {
          w.__reconnects[index] = (w.__reconnects[index] ?? 0) + 1
          w.__reconnectInfo[index] = info
        })
        void session.closed.then(info => (w.__closeInfo[index] = { reason: info.reason, code: info.error?.code ?? null }))
        return { ok: true, index }
      },
      (error: { code?: string; message?: string }): Opening => ({ ok: false, code: error.code ?? 'UNKNOWN', message: String(error.message) }),
    )
})

document.title = 'host-ready'
