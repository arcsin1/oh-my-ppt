import { create } from 'zustand'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

export type ToastId = string | number

interface ToastOptions {
  id?: ToastId
  description?: ReactNode
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

interface ToastState {
  success: (message: ReactNode, options?: ToastOptions) => ToastId
  error: (message: ReactNode, options?: ToastOptions) => ToastId
  info: (message: ReactNode, options?: ToastOptions) => ToastId
  warning: (message: ReactNode, options?: ToastOptions) => ToastId
  loading: (message: ReactNode, options?: ToastOptions) => ToastId
  promise: <T>(
    input: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: Error) => string)
    }
  ) => Promise<T>
  dismiss: (toastId?: ToastId) => void
}

export const useToastStore = create<ToastState>(() => ({
  success: (message, options) => toast.success(message, options),
  error: (message, options) => toast.error(message, options),
  info: (message, options) => toast(message, options),
  warning: (message, options) => toast.warning(message, options),
  loading: (message, options) => toast.loading(message, options),
  promise: (input, messages) => {
    toast.promise(input, messages)
    return input
  },
  dismiss: (toastId) => {
    if (toastId) {
      toast.dismiss(toastId)
      return
    }
    toast.dismiss()
  }
}))
