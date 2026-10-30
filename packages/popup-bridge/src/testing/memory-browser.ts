/**
 * In-memory stand-in for a browser with one root window and the popups it opens, which may open
 * popups of their own. It models what the bridge relies on: asynchronous `postMessage` with the
 * sender's origin and window as `event.origin` / `event.source`, `targetOrigin` filtering,
 * transferred ports, popup blocking, focus requests, reloads (new page, same window) and closing.
 */
import type { Clock, HostEnvironment, IncomingWindowMessage, PeerHandle, PopupEnvironment } from '../env.js'

type Listener = (message: IncomingWindowMessage) => void

class MemoryWindow {
  closed = false
  focusRequests = 0
  readonly listeners = new Set<Listener>()
  readonly pageHideListeners = new Set<() => void>()
  readonly pageShowListeners = new Set<(persisted: boolean) => void>()
  hash = ''

  constructor(
    readonly origin: string,
    readonly opener: MemoryWindow | undefined = undefined,
  ) {}

  receive(message: IncomingWindowMessage): void {
    queueMicrotask(() => {
      if (this.closed) return
      for (const listener of [...this.listeners]) listener(message)
    })
  }

  pageHide(): void {
    for (const listener of [...this.pageHideListeners]) listener()
  }

  pageShow(persisted: boolean): void {
    for (const listener of [...this.pageShowListeners]) listener(persisted)
  }

  /** Discards the current page: its listeners vanish, as when a document is replaced. */
  resetPage(): void {
    this.listeners.clear()
    this.pageHideListeners.clear()
    this.pageShowListeners.clear()
  }
}

/** A window message on its way: what it says and between which origins it travels. */
export type WindowMessageRoute = { from: string; to: string }

type DropRule = { match: (message: unknown, route: WindowMessageRoute) => boolean; remaining: number; dropped: number }

type FocusState = { focused: MemoryWindow; refuse: boolean; drops: Set<DropRule> }

/** True when a rule swallows the message; the rule retires itself once its count is used up. */
function dropped(focusState: FocusState, message: unknown, route: WindowMessageRoute): boolean {
  for (const rule of [...focusState.drops]) {
    if (!rule.match(message, route)) continue
    rule.dropped += 1
    rule.remaining -= 1
    if (rule.remaining <= 0) focusState.drops.delete(rule)
    return true
  }
  return false
}

function peerTo(sender: MemoryWindow, target: MemoryWindow, focusState: FocusState): PeerHandle {
  return {
    postMessage(message, targetOrigin, transfer) {
      // Browsers drop a message whose targetOrigin does not match the receiving document.
      if (target.closed || (targetOrigin !== '*' && targetOrigin !== target.origin)) return
      if (dropped(focusState, message, { from: sender.origin, to: target.origin })) return
      target.receive({
        // Ports are handed over as they are: structuredClone would detach them instead of re-creating them.
        data: structuredClone(message),
        origin: sender.origin,
        source: sender,
        ports: (transfer ?? []).filter((item): item is MessagePort => item instanceof MessagePort),
      })
    },
    isSource: source => source === target,
    get closed() {
      return target.closed
    },
    close() {
      target.closed = true
    },
    focus() {
      target.focusRequests += 1
      if (!target.closed && !focusState.refuse) focusState.focused = target
    },
  }
}

function popupEnvironmentOf(win: MemoryWindow, focusState: FocusState, clock: Clock | undefined): PopupEnvironment {
  return {
    ...(clock === undefined ? {} : { clock }),
    host: win.opener === undefined ? null : peerTo(win, win.opener, focusState),
    get hash() {
      return win.hash
    },
    listen(listener) {
      win.listeners.add(listener)
      return () => win.listeners.delete(listener)
    },
    onPageHide(listener) {
      win.pageHideListeners.add(listener)
      return () => win.pageHideListeners.delete(listener)
    },
    onPageShow(listener) {
      win.pageShowListeners.add(listener)
      return () => win.pageShowListeners.delete(listener)
    },
  }
}

export interface MemoryPopupPage {
  /** The page as a popup: talks to the window that opened it. */
  readonly env: PopupEnvironment
  /** The page as a host: opens popups of its own, whose opener is this window. */
  readonly hostEnv: HostEnvironment
  readonly url: string
  readonly origin: string
  readonly window: MemoryPopupWindow
}

export interface MemoryPopupWindow {
  readonly url: string
  readonly origin: string
  readonly closed: boolean
  /** The window that opened this one: `'host'` for the root window, otherwise the popup. */
  readonly opener: 'host' | MemoryPopupWindow
  /** The currently loaded page. */
  readonly page: MemoryPopupPage
  /** How many times a page has been loaded into this window. */
  readonly loads: number
  /** True while this window has the user's focus. */
  readonly focused: boolean
  /** How many times another window asked the browser to focus this one. */
  readonly focusRequests: number
  /** Replaces the page: `pagehide` fires, listeners are dropped, load listeners run again. */
  reload(): void
  /** The page enters the back/forward cache: `pagehide` fires, JavaScript state is kept. */
  freeze(): void
  /** The page is restored from the back/forward cache: `pageshow` fires with `persisted`. */
  restore(): void
  /** The user closes the window: `pagehide` fires and the window is gone. */
  close(): void
  /** The user clicks into this window. */
  focus(): void
}

export interface MemoryBrowser {
  readonly hostOrigin: string
  readonly hostEnv: HostEnvironment
  /** Every popup window opened so far, by the root window or by other popups. */
  readonly popups: readonly MemoryPopupWindow[]
  /** When true, `open` returns `null` like a browser blocking the popup. */
  blockPopups: boolean
  /** When true, focus requests are counted but never granted, like a browser refusing to raise a window. */
  refuseFocus: boolean
  /** The root window: whether it has focus and how often it was asked to take it. */
  readonly host: { readonly focused: boolean; readonly focusRequests: number; focus(): void }
  /** Called after every page load of every popup window; boot the popup application here. */
  onPopupLoad(listener: (page: MemoryPopupPage) => void): () => void
  /** Simulates the host page unloading. */
  hostPageHide(): void
  /**
   * Loses window messages (`postMessage`) for which `match` returns true, like a page that was not
   * listening yet. A message that the browser would drop anyway (wrong `targetOrigin`, closed
   * window) is not offered to `match` and is not counted. Messages over a transferred port are
   * not affected. With `count`, only that many are lost; without it, every match is until `stop()`.
   */
  dropWindowMessages(match: (message: unknown, route: WindowMessageRoute) => boolean, count?: number): DropHandle
}

export interface DropHandle {
  /** How many messages were lost so far. */
  readonly dropped: number
  /** Stops losing messages. */
  stop(): void
}

export type MemoryBrowserOptions = {
  hostOrigin?: string
  /** Time source handed to every host and popup environment, e.g. `createManualClock()`. Default: the system clock. */
  clock?: Clock
}

export function createMemoryBrowser(options: MemoryBrowserOptions = {}): MemoryBrowser {
  const hostOrigin = options.hostOrigin ?? 'https://app.example.com'
  const hostWindow = new MemoryWindow(hostOrigin)
  const focusState: FocusState = { focused: hostWindow, refuse: false, drops: new Set() }
  const popups: MemoryPopupWindow[] = []
  const windows = new Map<MemoryWindow, MemoryPopupWindow>()
  const loadListeners = new Set<(page: MemoryPopupPage) => void>()

  /** The host-side adapter of one window: `open` creates a popup whose opener is that window. */
  function hostEnvironmentOf(opener: MemoryWindow): HostEnvironment {
    return {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      open(url) {
        if (browser.blockPopups) return null
        const parsed = new URL(url)
        const win = new MemoryWindow(parsed.origin, opener)
        win.hash = parsed.hash
        let loads = 0
        let page!: MemoryPopupPage
        const popup: MemoryPopupWindow = {
          url,
          origin: parsed.origin,
          get closed() {
            return win.closed
          },
          get opener() {
            return windows.get(opener) ?? 'host'
          },
          get page() {
            return page
          },
          get loads() {
            return loads
          },
          get focused() {
            return focusState.focused === win
          },
          get focusRequests() {
            return win.focusRequests
          },
          reload() {
            win.pageHide()
            win.resetPage()
            load()
          },
          freeze() {
            win.pageHide()
          },
          restore() {
            win.pageShow(true)
          },
          close() {
            win.pageHide()
            win.resetPage()
            win.closed = true
          },
          focus() {
            if (!win.closed) focusState.focused = win
          },
        }
        const load = () => {
          loads += 1
          page = { env: popupEnvironmentOf(win, focusState, options.clock), hostEnv: hostEnvironmentOf(win), url, origin: parsed.origin, window: popup }
          queueMicrotask(() => {
            if (win.closed) return
            for (const listener of [...loadListeners]) listener(page)
          })
        }
        windows.set(win, popup)
        popups.push(popup)
        load()
        return peerTo(opener, win, focusState)
      },
      listen(listener) {
        opener.listeners.add(listener)
        return () => opener.listeners.delete(listener)
      },
      onPageHide(listener) {
        opener.pageHideListeners.add(listener)
        return () => opener.pageHideListeners.delete(listener)
      },
    }
  }

  const browser: MemoryBrowser = {
    hostOrigin,
    popups,
    blockPopups: false,
    get refuseFocus() {
      return focusState.refuse
    },
    set refuseFocus(value: boolean) {
      focusState.refuse = value
    },
    host: {
      get focused() {
        return focusState.focused === hostWindow
      },
      get focusRequests() {
        return hostWindow.focusRequests
      },
      focus() {
        focusState.focused = hostWindow
      },
    },
    onPopupLoad(listener) {
      loadListeners.add(listener)
      return () => loadListeners.delete(listener)
    },
    hostPageHide() {
      hostWindow.pageHide()
    },
    dropWindowMessages(match, count = Infinity) {
      const rule: DropRule = { match, remaining: count, dropped: 0 }
      if (count > 0) focusState.drops.add(rule)
      return {
        get dropped() {
          return rule.dropped
        },
        stop() {
          focusState.drops.delete(rule)
        },
      }
    },
    hostEnv: hostEnvironmentOf(hostWindow),
  }
  return browser
}
