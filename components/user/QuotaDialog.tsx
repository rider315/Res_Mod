'use client'
import { useEffect } from 'react'
import type { BillingStatus } from '@/lib/billing/types'
import { formatDay } from '@/components/user/billing-client'
import { primaryButton, secondaryButton } from '@/components/user/shared'

/** Shown when a run or an import on ResMod AI is refused because the allowance is used up. */

interface QuotaDialogProps {
  kind: 'run' | 'import'
  billing: BillingStatus | null | undefined
  onOpenBilling: () => void
  onUseOwnAi: () => void
  onClose: () => void
}

export default function QuotaDialog({ kind, billing, onOpenBilling, onUseOwnAi, onClose }: QuotaDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canBuy = Boolean(billing && (billing.checkout.packs || billing.checkout.pro))
  let detail = ''
  if (billing && kind === 'run') {
    const { limit, resetsAt } = billing.runs.free
    detail = limit > 0 ? `Your ${limit} free runs come back on ${formatDay(resetsAt)}.` : ''
    if (canBuy) detail += `${detail ? ' ' : ''}To keep going now, get a credit pack or Pro.`
  } else if (billing) {
    detail = `Imports on ResMod AI start again on ${formatDay(billing.imports.resetsAt)}.`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-dialog-title"
        className="bg-[var(--color-surface)] w-full max-w-md rounded-2xl border border-[var(--color-border)] shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="quota-dialog-title" className="text-lg font-bold text-[var(--color-text)]">
          {kind === 'run' ? "You've used all your included runs" : "You've reached this month's import limit"}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {detail} Runs with your own AI key, or with Puter, are never counted.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {kind === 'run' && canBuy && (
            <button onClick={onOpenBilling} className={primaryButton}>
              Get more runs
            </button>
          )}
          <button onClick={onUseOwnAi} className={secondaryButton}>
            Use my own AI
          </button>
          <button
            onClick={onClose}
            className="py-2 px-3.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
