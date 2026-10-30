/**
 * Window-level adapters. The host and popup logic never touch `window` directly; they talk to
 * these interfaces, so an iframe, an extension page or a desktop shell only needs another
 * implementation (and tests use the in-memory one from `@oa-sdk/popup-bridge/testing`).
 */

/**
 * The time source of the bridge: wall time, timers and randomness. Everything that waits goes
 * through it, so tests (and unusual hosts) can drive time by hand instead of sleeping. The
 * environments carry an optional one; without it the page's own timers are used.
 */
export interface Clock {
  /** Milliseconds, comparable only with other `now()` values of the same clock. */
  now(): number
  /** Runs `run` once after `ms`; the returned function cancels it and is safe to call again. */
  after(ms: number, run: () => void): () => void
  /** Runs `run` every `ms` until cancelled. */
  every(ms: number, run: () => void): () => void
  /** A number in `[0, 1)`, e.g. for jitter. */
  random(): number
}

/** Longest delay `setTimeout` honours (a 32-bit signed millisecond count); a longer one fires after about 1 ms. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * The page's real clock. It looks up the timer globals on every call rather than capturing them,
 * so fake timers installed later (`vi.useFakeTimers()`) take effect.
 */
export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, run) {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
  every(ms, run) {
    const id = setInterval(run, ms)
    return () => clearInterval(id)
  },
  random: () => Math.random(),
}

/** A message as delivered by the environment, mirroring the fields of `MessageEvent` that matter. */
export type IncomingWindowMessage = {
  data: unknown
  origin: string
  source: unknown
  ports: readonly MessagePort[]
}

/** The other window, as seen by one side. */
export interface PeerHandle {
  postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void
  /** True when `source` (from an incoming message) is this peer. */
  isSource(source: unknown): boolean
  readonly closed: boolean
  close(): void
  /**
   * Asks the browser to bring that window to the front. Browsers honour it only inside a user
   * gesture of the calling window, so call it straight from a click handler.
   */
  focus(): void
}

export type OpenWindowOptions = { name?: string; features?: string }

export interface HostEnvironment {
  /**
   * Opens the popup. Must call the underlying `window.open` synchronously: the caller invokes it
   * inside the user's click so browsers do not block it. Returns `null` when blocked.
   */
  open(url: string, options: OpenWindowOptions): PeerHandle | null
  listen(listener: (message: IncomingWindowMessage) => void): () => void
  /** Called when the host page is going away (best effort). */
  onPageHide(listener: () => void): () => void
  /** Time source for timeouts, polling and heartbeats. Default: {@link systemClock}. */
  readonly clock?: Clock
}

export interface PopupEnvironment {
  /** The window that opened this one (`window.opener`), or `null` when opened directly. */
  readonly host: PeerHandle | null
  /** `location.hash`, where the host leaves the session id. */
  readonly hash: string
  listen(listener: (message: IncomingWindowMessage) => void): () => void
  onPageHide(listener: () => void): () => void
  /**
   * Called when the page is shown; `persisted` is true when it was restored from the back/forward
   * cache with its JavaScript state intact (the host has dropped its side by then).
   */
  onPageShow?(listener: (persisted: boolean) => void): () => void
  /** Time source for timeouts, polling and event windows. Default: {@link systemClock}. */
  readonly clock?: Clock
}

function peerFor(target: Window): PeerHandle {
  return {
    postMessage: (message, targetOrigin, transfer) => target.postMessage(message, { targetOrigin, transfer: transfer ?? [] }),
    isSource: source => source === target,
    get closed() {
      return target.closed
    },
    close: () => target.close(),
    focus: () => target.focus(),
  }
}

function listenOn(win: Window, listener: (message: IncomingWindowMessage) => void): () => void {
  const handler = (event: MessageEvent) =>
    listener({ data: event.data, origin: event.origin, source: event.source, ports: event.ports })
  win.addEventListener('message', handler)
  return () => win.removeEventListener('message', handler)
}

function pageShowOn(win: Window, listener: (persisted: boolean) => void): () => void {
  const handler = (event: PageTransitionEvent) => listener(event.persisted)
  win.addEventListener('pageshow', handler)
  return () => win.removeEventListener('pageshow', handler)
}

function pageHideOn(win: Window, listener: () => void): () => void {
  win.addEventListener('pagehide', listener)
  return () => win.removeEventListener('pagehide', listener)
}

export function browserHostEnvironment(win: Window = window): HostEnvironment {
  return {
    open(url, options) {
      const opened = win.open(url, options.name ?? '_blank', options.features)
      return opened === null ? null : peerFor(opened)
    },
    listen: listener => listenOn(win, listener),
    onPageHide: listener => pageHideOn(win, listener),
  }
}

export function browserPopupEnvironment(win: Window = window): PopupEnvironment {
  return {
    host: win.opener === null || win.opener === undefined ? null : peerFor(win.opener as Window),
    get hash() {
      return win.location.hash
    },
    listen: listener => listenOn(win, listener),
    onPageHide: listener => pageHideOn(win, listener),
    onPageShow: listener => pageShowOn(win, listener),
  }
}
