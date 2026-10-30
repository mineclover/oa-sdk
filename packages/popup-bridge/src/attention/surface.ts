/**
 * What a page can do to attract attention, behind an interface so the policy in the manager is
 * testable and an extension page or desktop shell can supply its own (`@oa-sdk/popup-bridge/testing`
 * has an in-memory one).
 */
import type { AttentionVisibility } from './types.js'

export interface AttentionSurface {
  visibility(): AttentionVisibility
  /** Asks the browser to raise this window. It may be ignored; check `visibility()` afterwards. */
  focus(): void
  getTitle(): string
  setTitle(title: string): void
  /** Marks or unmarks the favicon. */
  setMark(on: boolean): void
  /** Shows a system notification; false when permission was not granted or the platform has none. */
  notify(notification: { title: string; body?: string; tag?: string }): boolean
  /** Fires when the page comes to the front (focused and visible). */
  onActivate(listener: () => void): () => void
}

const MARK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#e5484d"/></svg>')

export function browserAttentionSurface(win: Window = window): AttentionSurface {
  const doc = win.document
  let markedLink: HTMLLinkElement | undefined
  let restore: (() => void) | undefined

  const visibility = (): AttentionVisibility =>
    doc.visibilityState === 'hidden' ? 'hidden' : doc.hasFocus() ? 'focused' : 'visible'

  return {
    visibility,
    focus: () => win.focus(),
    getTitle: () => doc.title,
    setTitle: title => {
      doc.title = title
    },
    setMark(on) {
      if (!on) {
        restore?.()
        restore = undefined
        markedLink = undefined
        return
      }
      if (restore !== undefined) return
      const existing = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')
      if (existing !== null) {
        const original = existing.href
        existing.href = MARK_ICON
        markedLink = existing
        restore = () => {
          if (markedLink !== undefined) markedLink.href = original
        }
        return
      }
      const created = doc.createElement('link')
      created.rel = 'icon'
      created.href = MARK_ICON
      doc.head.append(created)
      restore = () => created.remove()
    },
    notify({ title, body, tag }) {
      const NotificationApi = (win as Window & typeof globalThis).Notification
      if (NotificationApi === undefined || NotificationApi.permission !== 'granted') return false
      try {
        new NotificationApi(title, { ...(body === undefined ? {} : { body }), ...(tag === undefined ? {} : { tag }) })
        return true
      } catch {
        return false
      }
    },
    onActivate(listener) {
      const check = () => {
        if (visibility() === 'focused') listener()
      }
      win.addEventListener('focus', check)
      doc.addEventListener('visibilitychange', check)
      return () => {
        win.removeEventListener('focus', check)
        doc.removeEventListener('visibilitychange', check)
      }
    },
  }
}
