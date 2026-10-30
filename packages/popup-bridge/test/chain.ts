import {
  createAttentionManager,
  createBridgeNode,
  defineContract,
  definePopup,
  method,
  type BridgeNode,
} from '../src/index.js'
import { createPopupBridge, type PopupBridge, type PopupSession } from '../src/host.js'
import { createPopupRuntime, type PopupRuntime } from '../src/popup.js'
import { createMemoryBrowser, createMemorySurface, type MemorySurface } from '../src/testing.js'

export const ROOT = 'https://root.example.com'
export const A = 'https://a.example.com'
export const B = 'https://b.example.com'

export const aContract = defineContract({ id: 'page-a', methods: { 'a.ping': method<void, { ok: boolean }>() } })
export const bContract = defineContract({ id: 'page-b', methods: { 'b.ping': method<void, { ok: boolean }>() } })
export const defineA = definePopup(aContract, { url: `${A}/a`, requiredCapabilities: [] })
export const defineB = definePopup(bContract, { url: `${B}/b`, requiredCapabilities: [] })

export type Pages = {
  a?: { runtime: PopupRuntime<typeof aContract>; bridge: PopupBridge; node: BridgeNode; surface: MemorySurface }
  b?: { runtime: PopupRuntime<typeof bContract>; node: BridgeNode; surface: MemorySurface }
}

export type ChainOptions = {
  rootTopology?: boolean
  aTopology?: boolean
  bTopology?: boolean
  aAttention?: Parameters<typeof createAttentionManager>[0] | false
  bAttention?: Parameters<typeof createAttentionManager>[0] | false
  aState?: MemorySurface['state']
  bState?: MemorySurface['state']
  aTopologyPolicy?: Parameters<typeof createBridgeNode>[0] extends infer O ? (O extends { topology?: infer T } ? T : never) : never
  rootTraceBuffer?: number
}

/** root window → popup A → popup B; A is a popup of the root and the host of B. */
export function chain(options: ChainOptions = {}) {
  const browser = createMemoryBrowser({ hostOrigin: ROOT })
  const rootSurface = createMemorySurface({ state: 'focused', title: 'Root' })
  const rootNode = createBridgeNode({
    name: 'root',
    origin: ROOT,
    topology: options.rootTopology ?? true,
    ...(options.rootTraceBuffer === undefined ? {} : { traceBuffer: options.rootTraceBuffer }),
    attention: { surface: rootSurface, minIntervalMs: 0, blinkIntervalMs: 5, focusSettleMs: 1 },
  })
  const pages: Pages = {}
  const attention = (surface: MemorySurface, custom: ChainOptions['aAttention']) =>
    custom === false ? undefined : { surface, minIntervalMs: 0, blinkIntervalMs: 5, focusSettleMs: 1, ...custom }

  browser.onPopupLoad(page => {
    if (page.origin === A) {
      const surface = createMemorySurface({ state: options.aState ?? 'hidden', title: 'Popup A' })
      const attentionOptions = attention(surface, options.aAttention)
      const node = createBridgeNode({
        name: 'a',
        origin: A,
        topology: options.aTopologyPolicy ?? options.aTopology ?? true,
        ...(attentionOptions === undefined ? {} : { attention: attentionOptions }),
      })
      const runtime = createPopupRuntime({ contract: aContract, allowedHostOrigins: [ROOT], env: page.env, node, openerPollMs: 20 })
      runtime.register('a.ping', () => ({ ok: true }))
      const bridge = createPopupBridge({ env: page.hostEnv, node, defaults: { closedPollMs: 20 } })
      pages.a = { runtime, bridge, node, surface }
      void runtime.start().catch(() => undefined)
    } else if (page.origin === B) {
      const surface = createMemorySurface({ state: options.bState ?? 'hidden', title: 'Popup B' })
      const attentionOptions = attention(surface, options.bAttention)
      const node = createBridgeNode({
        name: 'b',
        origin: B,
        topology: options.bTopology ?? true,
        ...(attentionOptions === undefined ? {} : { attention: attentionOptions }),
      })
      const runtime = createPopupRuntime({ contract: bContract, allowedHostOrigins: [A], env: page.env, node, openerPollMs: 20 })
      runtime.register('b.ping', () => ({ ok: true }))
      pages.b = { runtime, node, surface }
      void runtime.start().catch(() => undefined)
    }
  })

  const rootBridge = createPopupBridge({ env: browser.hostEnv, node: rootNode, defaults: { closedPollMs: 20 } })
  return {
    browser,
    pages,
    rootNode,
    rootSurface,
    async open(): Promise<{ sessionA: PopupSession<typeof aContract>; sessionB: PopupSession<typeof bContract> }> {
      const sessionA = await rootBridge.open(defineA)
      const sessionB = await pages.a!.bridge.open(defineB)
      return { sessionA, sessionB }
    },
  }
}
