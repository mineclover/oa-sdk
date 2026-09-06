import { useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastMessage {
  id: string
  type: ToastType
  text: string
  duration?: number
}

export interface ToastContainerProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

const TOAST_THEMES: Record<ToastType, { icon: string; border: string; text: string }> = {
  success: { icon: '✓', border: 'var(--green)', text: 'var(--green)' },
  error:   { icon: '✕', border: 'var(--red)',   text: 'var(--red)'   },
  warning: { icon: '⚠', border: 'var(--amber)', text: 'var(--amber)' },
  info:    { icon: 'ℹ', border: 'var(--blue)',  text: 'var(--blue)'  },
}

export function ToastItemComponent({
  toast,
  onDismiss,
}: {
  toast: ToastMessage
  onDismiss: (id: string) => void
}) {
  const duration = toast.duration ?? 3500

  useEffect(() => {
    if (duration <= 0) return
    const timer = setTimeout(() => {
      onDismiss(toast.id)
    }, duration)
    return () => clearTimeout(timer)
  }, [toast.id, duration, onDismiss])

  const theme = TOAST_THEMES[toast.type]

  return (
    <div
      role="status"
      className={`toast-item toast-${toast.type}`}
      style={{
        pointerEvents: 'auto',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${theme.border}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 260,
        maxWidth: 380,
        animation: 'toastIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <span
        style={{
          color: theme.text,
          fontWeight: 700,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {theme.icon}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 'var(--text-sm)',
          color: 'var(--text-primary)',
          lineHeight: 1.4,
        }}
      >
        {toast.text}
      </span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="toast-dismiss-btn"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 16,
          padding: '2px 4px',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="toast-container"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 380,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <ToastItemComponent key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
