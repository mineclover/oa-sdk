import type { PopupDefinition } from '../contract/definition.js'
import { browserHostEnvironment, type HostEnvironment } from '../env.js'
import type { BridgeNode } from '../node/node.js'
import { openPopupSession, type ContractOf, type HostOpenOptions, type PopupSession, type SessionHandle } from './session.js'

export type PopupBridgeOptions = {
  /** Window adapter. Defaults to the global `window`, resolved on first use so importing is SSR-safe. */
  env?: HostEnvironment
  /**
   * The page's node. Give the same node to the popup runtime when this page is itself a popup, so
   * both neighbours share one attention policy, topology and trace.
   */
  node?: BridgeNode
  /** Defaults applied to every `open()`. */
  defaults?: Partial<Omit<HostOpenOptions, 'init' | 'host'>>
}

export interface PopupBridge {
  /**
   * Opens a popup and resolves when it is READY. Call it directly from a user-initiated event
   * handler: the window is opened synchronously, before any `await`.
   */
  open<D extends PopupDefinition>(definition: D, options?: HostOpenOptions<ContractOf<D>>): Promise<PopupSession<ContractOf<D>>>
  /** Sessions that have not ended yet. */
  readonly sessions: ReadonlySet<SessionHandle>
}

export function createPopupBridge(bridgeOptions: PopupBridgeOptions = {}): PopupBridge {
  const sessions = new Set<SessionHandle>()
  let env = bridgeOptions.env
  return {
    sessions,
    open(definition, options) {
      env ??= browserHostEnvironment()
      const merged = {
        ...(bridgeOptions.node === undefined ? {} : { node: bridgeOptions.node }),
        ...bridgeOptions.defaults,
        ...options,
      } as HostOpenOptions<ContractOf<typeof definition>>
      const opening = openPopupSession(env, definition, merged)
      return opening.then(session => {
        sessions.add(session)
        void session.closed.then(() => sessions.delete(session))
        return session
      })
    },
  }
}
