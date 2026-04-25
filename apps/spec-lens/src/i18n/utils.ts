import type { TFunction } from 'i18next'

export function formatRelativeTimeFull(ts: number, t: TFunction): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return t('relJustNow')
  if (mins < 60) return t('relMinutesAgo', { count: mins })
  if (hours < 24) return t('relHoursAgo', { count: hours })
  if (days < 30) return t('relDaysAgo', { count: days })
  return new Date(ts).toLocaleDateString()
}

export function formatRelativeTimeCompact(ts: number, t: TFunction): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86400000)
  if (days < 1) return t('relToday')
  if (days < 30) return t('relDaysAgo', { count: days })
  return new Date(ts).toLocaleDateString()
}
