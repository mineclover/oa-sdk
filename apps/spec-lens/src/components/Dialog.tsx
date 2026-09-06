import { useEffect } from 'react'

export interface DialogProps {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  variant?: 'danger' | 'primary' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function Dialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger,
  variant,
  onConfirm,
  onCancel,
}: DialogProps) {
  const isDanger = danger === true || variant === 'danger'

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-desc"
        className="dialog-box"
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          id="dialog-title"
          className="dialog-title"
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {isDanger && (
            <span
              style={{
                color: 'var(--red)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              ⚠
            </span>
          )}
          <span>{title}</span>
        </div>

        <div
          id="dialog-desc"
          className="dialog-desc"
          style={{
            fontSize: 'var(--text-md)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>

        <div
          className="dialog-actions"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 6,
          }}
        >
          <button
            type="button"
            className="btn dialog-btn-cancel"
            onClick={onCancel}
            autoFocus
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="btn dialog-btn-confirm"
            onClick={onConfirm}
            style={
              isDanger
                ? {
                    background: 'var(--red)',
                    borderColor: 'var(--red)',
                    color: '#ffffff',
                  }
                : {
                    background: 'var(--blue)',
                    borderColor: 'var(--blue)',
                    color: '#ffffff',
                  }
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
