import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export interface CopyButtonProps {
  text: string
  label?: string
  title?: string
  tooltipText?: string
  className?: string
  style?: React.CSSProperties
  onCopied?: () => void
}


export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    } else if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    }
  } catch {
    // Fallback gracefully if clipboard access is denied or unavailable
  }
  return false
}

export function CopyButton({
  text,
  label,
  title,
  tooltipText,
  className,
  style,
  onCopied,
}: CopyButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      e.preventDefault()

      await copyToClipboard(text)

      setCopied(true)
      onCopied?.()

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        setCopied(false)
      }, 1800)
    },
    [text, onCopied],
  )

  const buttonLabel = label ?? title ?? t('pathsCopyPath', 'Copy')
  const buttonTitle = title ?? label ?? buttonLabel
  const rawI18nTooltip = t('pathsCopied')
  const displayTooltip =
    tooltipText ??
    (rawI18nTooltip && rawI18nTooltip !== 'pathsCopied'
      ? rawI18nTooltip === 'Copied to clipboard!'
        ? 'Copied!'
        : rawI18nTooltip
      : 'Copied!')

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
      }}
    >
      <button
        type="button"
        className={['copy-btn', className].filter(Boolean).join(' ')}
        onClick={handleCopy}
        title={buttonTitle}
        aria-label={buttonLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          padding: 0,
          background: 'none',
          border: 'none',
          borderRadius: 'var(--radius-sm, 4px)',
          color: copied ? 'var(--green)' : 'var(--text-muted)',
          cursor: 'pointer',
          transition: 'background 0.1s, color 0.1s',
          ...style,
        }}
      >
        {copied ? (
          <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 11 }}>✓</span>
        ) : (
          <span style={{ fontSize: 11, opacity: 0.6 }}>📋</span>
        )}
      </button>
      {copied && (
        <span
          className="copy-tooltip"
          role="status"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--green)',
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 'var(--radius-sm, 4px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 50,
          }}
        >
          {displayTooltip}
        </span>
      )}
    </span>
  )
}
