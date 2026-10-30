/**
 * Popup page of the browser E2E. `window.__CONFIG` is injected by the harness; the `mode` query
 * parameter selects a behaviour.
 */
import { createBridgeNode, definePopup, defineSharedState, withTransfer, type BridgeNode, type OwnedState, type ReplicaState } from '../../src/index.js'
import { createPopupBridge, type PopupSession } from '../../src/host.js'
import { createPopupRuntime, type PopupRuntime } from '../../src/popup.js'
import { contract } from './contract.js'

type Config = { hostOrigin: string }
const config = (window as unknown as { __CONFIG: Config }).__CONFIG
const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'normal'
// `allow` overrides the host origin the popup accepts (to test refusal).
const allowed = params.get('allow') ?? config.hostOrigin
// `features=x.a,x.b` sets the optional protocol features this popup offers.
const featuresParam = params.get('features')
const offered = featuresParam === null || featuresParam === '' ? undefined : featuresParam.split(',')

const w = window as unknown as {
  __runtime: PopupRuntime<typeof contract>
  __inits: unknown[]
  __closeInfo: unknown
  __startError: string | null
  __emit(ids: string[]): void
  __emitMany(count: number): void
  __emitProgress(count: number): void
  __hang(ms: number): void
  __saves: number
  __loaded: number
  __node?: BridgeNode | undefined
  __toasts: { intent?: string; visibility: string }[]
  __openingB?: Promise<{ ok: true } | { ok: false; code: string }>
  __openBUrl: string
  __sessionB?: PopupSession<typeof contract>
  __bridge?: ReturnType<typeof createPopupBridge>
  __ownSelection(initial: string[]): void
  __owned?: OwnedState<{ ids: string[] }>
  __replicate(): Promise<unknown>
  __replica?: ReplicaState<{ ids: string[] }>
  __notifications: string[]
}
w.__inits = []
w.__closeInfo = null
w.__startError = null
w.__saves = 0
w.__toasts = []
w.__notifications = []

const selection = defineSharedState<{ ids: string[] }>({ name: 'document.selection', initial: { ids: [] }, writable: true })

// `chain` is a popup that opens a popup of its own; `leaf` is the one it opens. Both get a node,
// so each can ask the other for attention and share state.
const node =
  mode === 'chain' || mode === 'leaf'
    ? createBridgeNode({
        name: mode,
        topology: true,
        attention: {
          minIntervalMs: 0,
          blinkIntervalMs: 100,
          focusSettleMs: 50,
          onAttention: (request, context) => w.__toasts.push({ ...(request.intent === undefined ? {} : { intent: request.intent }), visibility: context.visibility }),
        },
      })
    : undefined
w.__node = node

const runtime = createPopupRuntime({
  contract,
  allowedHostOrigins: [allowed],
  handshakeTimeoutMs: 2_000,
  openerPollMs: 100,
  ...(offered === undefined ? {} : { features: offered }),
  ...(node === undefined ? {} : { node }),
  onInit: init => {
    if (mode === 'reject-init') throw new Error('unsupported locale')
    w.__inits.push(init)
  },
})
w.__runtime = runtime
runtime.onClose(info => (w.__closeInfo = { reason: info.reason, code: info.error?.code ?? null }))

runtime.implement({
  'asset.select': async params => ({ assetIds: params.multiple ? ['a1', 'a2'] : ['a1'] }),
  'asset.getSnapshot': () => ({ revision: 0, assetIds: ['a1'] }),
  ...(mode === 'skip-save'
    ? {}
    : {
        'asset.save': async (params: { name: string }) => {
          w.__saves++
          await new Promise(resolve => setTimeout(resolve, 600))
          return { saved: params.name.length }
        },
      }),
  'asset.readSelection': () => runtime.host.call('host.document.getSelection'),
  'asset.upload': (params: { bytes: ArrayBuffer }) => ({ length: params.bytes.byteLength }),
  'asset.download': (params: { size: number }) => {
    const bytes = new ArrayBuffer(params.size)
    return withTransfer({ bytes }, [bytes])
  },
  'asset.leak': () => ({ handle: () => 1 }),
})
w.__emit = ids => runtime.emit('asset.selectionChanged', { assetIds: ids })
w.__emitMany = count => {
  for (let i = 0; i < count; i++) runtime.emit('asset.selectionChanged', { assetIds: [String(i)] })
}
w.__emitProgress = count => {
  for (let percent = 1; percent <= count; percent++) runtime.emit('asset.progress', { percent })
}
// Blocks the page's main thread, like a hung page: no message is processed until it returns.
w.__hang = ms => {
  setTimeout(() => {
    const end = Date.now() + ms
    while (Date.now() < end) { /* busy */ }
  }, 0)
}

w.__ownSelection = initial => {
  w.__owned = node!.state.own(selection, { initial: { ids: initial } })
}
w.__replicate = async () => {
  w.__replica = runtime.link.replicate(selection)
  return w.__replica.ready
}

if (mode === 'chain') {
  const bridge = createPopupBridge({ node: node!, defaults: { closedPollMs: 100 } })
  w.__bridge = bridge
  const button = document.createElement('button')
  button.id = 'open-b'
  button.textContent = 'open B'
  // The harness page loads this script from <head>; the body exists once parsing is done.
  document.addEventListener('DOMContentLoaded', () => document.body.append(button))
  button.addEventListener('click', () => {
    // Opened inside the click, so the browser treats it as user-initiated.
    w.__openingB = bridge
      .open(definePopup(contract, { url: w.__openBUrl, requiredCapabilities: [] }), { init: { documentId: 'doc-b', locale: 'ko-KR' }, handshakeTimeoutMs: 5_000 })
      .then(
        session => {
          w.__sessionB = session
          return { ok: true as const }
        },
        (error: { code?: string }) => ({ ok: false as const, code: error.code ?? 'UNKNOWN' }),
      )
  })
}

const start = () => runtime.start().then(
  () => undefined,
  (error: { code?: string }) => {
    w.__startError = error.code ?? 'UNKNOWN'
  },
)
if (mode === 'slow') setTimeout(start, 700)
else void start()
document.title = 'popup-loaded'
