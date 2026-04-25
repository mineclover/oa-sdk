type BadgeVariant = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'muted'

const STYLES: Record<BadgeVariant, React.CSSProperties> = {
  green:  { background: 'var(--green-bg)',  color: 'var(--green)'  },
  red:    { background: 'var(--red-bg)',    color: 'var(--red)'    },
  amber:  { background: 'var(--amber-bg)',  color: 'var(--amber)'  },
  blue:   { background: 'var(--blue-bg)',   color: 'var(--blue)'   },
  purple: { background: 'var(--purple-bg)', color: 'var(--purple)' },
  muted:  { background: 'var(--bg-elevated)', color: 'var(--text-muted)' },
}

export function Badge({
  children,
  variant = 'muted',
}: {
  children: React.ReactNode
  variant?: BadgeVariant
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 7px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'var(--font-mono)',
        whiteSpace: 'nowrap',
        ...STYLES[variant],
      }}
    >
      {children}
    </span>
  )
}

import { useLocale } from '../i18n/index.js'

export function DiffBadges({
  added,
  removed,
  changed,
  breaking,
}: {
  added: number
  removed: number
  changed: number
  breaking: number
}) {
  const { t } = useLocale()
  return (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {added > 0 && <Badge variant="green">+{added}</Badge>}
      {removed > 0 && <Badge variant="red">−{removed}</Badge>}
      {changed > 0 && <Badge variant="blue">~{changed}</Badge>}
      {breaking > 0 && <Badge variant="amber">⚡{breaking}</Badge>}
      {added === 0 && removed === 0 && changed === 0 && (
        <Badge variant="muted">{t.noChanges}</Badge>
      )}
    </span>
  )
}
