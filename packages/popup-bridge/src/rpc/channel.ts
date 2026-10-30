/**
 * Message channel abstraction under the RPC endpoint. A `MessagePort` is the v0.1 transport; an
 * iframe, extension port or desktop IPC only needs another `RpcChannel` to reuse everything above.
 */
export interface RpcChannel {
  send(message: unknown, transfer?: Transferable[]): void
  /** Several subscribers may listen; each message goes to all of them. */
  subscribe(listener: (message: unknown) => void): () => void
  /** Idempotent. */
  close(): void
}

/**
 * Wraps a `MessagePort`. The port starts delivering when the first subscriber attaches, so the
 * caller must subscribe before the peer is allowed to send.
 */
export function fromMessagePort(port: MessagePort): RpcChannel {
  const listeners = new Set<(message: unknown) => void>()
  let started = false
  let closed = false
  const onMessage = (event: MessageEvent) => {
    for (const listener of [...listeners]) listener(event.data)
  }
  return {
    send(message, transfer) {
      if (closed) return
      port.postMessage(message, transfer ?? [])
    },
    subscribe(listener) {
      listeners.add(listener)
      if (!started && !closed) {
        started = true
        port.addEventListener('message', onMessage)
        port.start()
      }
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      if (closed) return
      closed = true
      listeners.clear()
      port.removeEventListener('message', onMessage)
      port.close()
    },
  }
}

/** In-process channel pair with asynchronous delivery; useful for unit tests and same-realm peers. */
export function createMemoryChannelPair(): [RpcChannel, RpcChannel] {
  const make = () => {
    const listeners = new Set<(message: unknown) => void>()
    return { listeners, closed: false }
  }
  const a = make()
  const b = make()
  const endpoint = (self: ReturnType<typeof make>, peer: ReturnType<typeof make>): RpcChannel => ({
    send(message, transfer) {
      if (self.closed || peer.closed) return
      const copy = structuredClone(message, transfer === undefined ? undefined : { transfer })
      queueMicrotask(() => {
        if (peer.closed) return
        for (const listener of [...peer.listeners]) listener(copy)
      })
    },
    subscribe(listener) {
      self.listeners.add(listener)
      return () => {
        self.listeners.delete(listener)
      }
    },
    close() {
      self.closed = true
      self.listeners.clear()
    },
  })
  return [endpoint(a, b), endpoint(b, a)]
}
