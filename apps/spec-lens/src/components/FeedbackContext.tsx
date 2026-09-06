import React, { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Dialog, type DialogProps } from './Dialog.js'
import { ToastContainer, type ToastMessage, type ToastType } from './Toast.js'

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  variant?: 'danger' | 'primary' | 'default'
}

export interface FeedbackContextValue {
  confirm(options: ConfirmOptions): Promise<boolean>
  toast(message: Omit<ToastMessage, 'id'> | string): void
  toastSuccess(text: string): void
  toastError(text: string): void
  toastWarning(text: string): void
  toastInfo(text: string): void
}

interface QueuedDialog extends ConfirmOptions {
  id: string
  resolve: (value: boolean) => void
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null)

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [activeDialog, setActiveDialog] = useState<QueuedDialog | null>(null)
  const activeDialogRef = useRef<QueuedDialog | null>(null)
  const dialogQueueRef = useRef<QueuedDialog[]>([])
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const counterRef = useRef<number>(0)

  const processNextDialog = useCallback(() => {
    const next = dialogQueueRef.current.shift() ?? null
    activeDialogRef.current = next
    setActiveDialog(next)
  }, [])

  const handleDialogConfirm = useCallback(() => {
    if (activeDialogRef.current) {
      activeDialogRef.current.resolve(true)
      processNextDialog()
    }
  }, [processNextDialog])

  const handleDialogCancel = useCallback(() => {
    if (activeDialogRef.current) {
      activeDialogRef.current.resolve(false)
      processNextDialog()
    }
  }, [processNextDialog])

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const queued: QueuedDialog = {
        ...options,
        id: `dialog-${++counterRef.current}`,
        resolve,
      }
      if (!activeDialogRef.current) {
        activeDialogRef.current = queued
        setActiveDialog(queued)
      } else {
        dialogQueueRef.current.push(queued)
      }
    })
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message: Omit<ToastMessage, 'id'> | string) => {
    const id = `toast-${++counterRef.current}-${Date.now()}`
    const item: ToastMessage =
      typeof message === 'string'
        ? { id, type: 'info', text: message }
        : { id, type: message.type, text: message.text, duration: message.duration }

    setToasts((prev) => [...prev, item])
  }, [])

  const toastSuccess = useCallback((text: string) => {
    toast({ type: 'success', text })
  }, [toast])

  const toastError = useCallback((text: string) => {
    toast({ type: 'error', text })
  }, [toast])

  const toastWarning = useCallback((text: string) => {
    toast({ type: 'warning', text })
  }, [toast])

  const toastInfo = useCallback((text: string) => {
    toast({ type: 'info', text })
  }, [toast])

  const contextValue: FeedbackContextValue = {
    confirm,
    toast,
    toastSuccess,
    toastError,
    toastWarning,
    toastInfo,
  }

  const dialogProps: DialogProps | null = activeDialog
    ? {
        open: true,
        title: activeDialog.title,
        message: activeDialog.message,
        confirmText: activeDialog.confirmText,
        cancelText: activeDialog.cancelText,
        danger: activeDialog.danger,
        variant: activeDialog.variant,
        onConfirm: handleDialogConfirm,
        onCancel: handleDialogCancel,
      }
    : null

  return (
    <FeedbackContext.Provider value={contextValue}>
      {children}
      {dialogProps && <Dialog {...dialogProps} />}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext)
  if (!ctx) {
    throw new Error('useFeedback must be used within a FeedbackProvider')
  }
  return ctx
}
