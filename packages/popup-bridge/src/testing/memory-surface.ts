/**
 * An attention surface that records what was asked of it, with knobs to play the part of a page
 * that is in front, in the background or hidden, and of a browser that grants or refuses focus.
 */
import type { AttentionSurface } from '../attention/surface.js'
import type { AttentionVisibility } from '../attention/types.js'

export interface MemorySurface extends AttentionSurface {
  /** Settable; `activate()` and a granted `focus()` set it to `focused`. */
  state: AttentionVisibility
  title: string
  marked: boolean
  focusCalls: number
  notifications: { title: string; body?: string; tag?: string }[]
  /** Whether `notify` succeeds, like a granted Notification permission. */
  notificationsPermitted: boolean
  /** Whether `focus()` brings the page to the front. */
  grantFocus: boolean
  /** The user returns to the page: it comes to the front and activation listeners fire. */
  activate(): void
}

export function createMemorySurface(options: { state?: AttentionVisibility; title?: string; notificationsPermitted?: boolean; grantFocus?: boolean } = {}): MemorySurface {
  const listeners = new Set<() => void>()
  const surface: MemorySurface = {
    state: options.state ?? 'hidden',
    title: options.title ?? 'Page',
    marked: false,
    focusCalls: 0,
    notifications: [],
    notificationsPermitted: options.notificationsPermitted ?? false,
    grantFocus: options.grantFocus ?? true,
    visibility: () => surface.state,
    focus() {
      surface.focusCalls += 1
      if (surface.grantFocus) surface.activate()
    },
    getTitle: () => surface.title,
    setTitle(title) {
      surface.title = title
    },
    setMark(on) {
      surface.marked = on
    },
    notify(notification) {
      if (!surface.notificationsPermitted) return false
      surface.notifications.push(notification)
      return true
    },
    onActivate(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    activate() {
      surface.state = 'focused'
      for (const listener of [...listeners]) listener()
    },
  }
  return surface
}
