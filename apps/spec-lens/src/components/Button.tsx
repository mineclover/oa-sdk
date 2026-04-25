import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner.js'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean
  children: ReactNode
}

export function Button({ loading, disabled, children, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={loading || disabled}
      className={['btn', className].filter(Boolean).join(' ')}
    >
      {loading && <Spinner size={12} />}
      {children}
    </button>
  )
}
