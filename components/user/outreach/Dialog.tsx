'use client'
import { useEffect, useId, useRef } from 'react'
import { Close } from '@/components/brand/Icons'

/**
 * A modal in ResMod's style: a blurred backdrop, a bold card, Escape or a click
 * outside to close (unless it is busy), and the page behind it held still.
 */

interface DialogProps {
  title: string
  subtitle?: string
  icon?: React.ReactNode
  /** Tailwind max-width class for the card. */
  width?: string
  /** While true, the dialog can't be dismissed: something is running. */
  busy?: boolean
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}

/** Open dialogs, innermost last: Escape closes only the one on top. */
const openDialogs: string[] = []

export default function Dialog({ title, subtitle, icon, width = 'max-w-lg', busy = false, onClose, children, footer }: DialogProps) {
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    openDialogs.push(titleId)
    return () => {
      const index = openDialogs.lastIndexOf(titleId)
      if (index >= 0) openDialogs.splice(index, 1)
    }
  }, [titleId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && openDialogs[openDialogs.length - 1] === titleId) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose, titleId])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    card.current?.focus()
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={() => !busy && onClose()}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`nb-card w-full ${width} rounded-t-[14px] sm:rounded-[12px] shadow-[8px_8px_0_0_var(--color-ink)] max-h-[92vh] flex flex-col outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b-[1.6px] border-[var(--color-ink)]">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <span className="nb-badge w-10 h-10 shrink-0 bg-[var(--color-yellow)]">{icon}</span>}
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-black leading-tight">
                {title}
              </h2>
              {subtitle && <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-[8px] border-[1.6px] border-transparent hover:border-[var(--color-ink)] disabled:opacity-40 transition-all"
          >
            <Close size={18} />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 sm:px-6 py-4 border-t-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface-offset)] rounded-b-[12px] flex flex-wrap items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
