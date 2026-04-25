import type { Translations } from './translations.js'

export function formatRelativeTimeFull(ts: number, t: Translations): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return t.relJustNow
  if (mins < 60) return t.relMinutesAgo(mins)
  if (hours < 24) return t.relHoursAgo(hours)
  if (days < 30) return t.relDaysAgo(days)
  return new Date(ts).toLocaleDateString()
}

export function formatRelativeTimeCompact(ts: number, t: Translations): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days < 1) return t.relToday
  if (days < 30) return t.relDaysAgo(days)
  return new Date(ts).toLocaleDateString()
}
