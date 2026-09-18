'use client'
import { useEffect } from 'react'
import { formatPrice } from '@/lib/billing/plans'
import type { BillingStatus } from '@/lib/billing/types'
import { formatDay } from '@/components/user/billing-client'
import { primaryButton } from '@/components/user/shared'

/** Shown when a tailoring or an import is refused because there is nothing left to spend. */

interface QuotaDialogProps {
  kind: 'run' | 'import'
  billing: BillingStatus | null | undefined
  onOpenBilling: () => void
  onClose: () => void
}

export default function QuotaDialog({ kind, billing, onOpenBilling, onClose }: QuotaDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const canBuy = Boolean(billing && (billing.checkout.packs || billing.checkout.tiers.length > 0))
  const subscribed = Boolean(billing?.subscription?.entitled)
  // Named by the plan they actually hold, so someone on Premium isn't told about Pro's month.
  const held = billing?.subscription?.tier ?? null
  const heldLabel = held && billing ? billing.tiers[held].label : 'your plan'
  const entry = billing?.tiers.pro

  let title: string
  let detail = ''
  if (kind === 'run') {
    title = subscribed ? `You've used this month's ${heldLabel} tailorings` : "You've used your free tailorings"
    if (billing && subscribed) {
      detail = billing.subscription?.currentEnd
        ? `They renew on ${formatDay(billing.subscription.currentEnd)}. A credit pack adds more right away.`
        : `They renew with your next ${heldLabel} payment. A credit pack adds more right away.`
    } else if (billing && entry) {
      detail =
        `Every account gets ${billing.runs.free.limit} free tailorings. To keep tailoring, get ${entry.label} ` +
        `(${entry.runsPerCycle} tailorings a month for ${formatPrice(entry.pricePaise)}) or a credit pack.`
    }
  } else {
    title = "You've reached this month's import limit"
    if (billing) {
      detail = `Imports start again on ${formatDay(billing.imports.resetsAt)}.`
      if (!subscribed && billing.runs.credits === 0) detail += ' A plan or a credit pack raises the limit.'
    }
  }
  if (!canBuy && kind === 'run') detail += `${detail ? ' ' : ''}Buying isn't available right now; please try again later.`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quota-dialog-title"
        className="nb-card w-full max-w-md rounded-[10px] shadow-[8px_8px_0_0_var(--color-ink)] p-7 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="nb-badge w-12 h-12 bg-[var(--color-yellow)] text-2xl" aria-hidden>
          !
        </span>
        <h2 id="quota-dialog-title" className="text-2xl font-black leading-tight">
          {title}
        </h2>
        {detail && <p className="text-[var(--color-text-muted)]">{detail}</p>}
        <div className="flex flex-col sm:flex-row gap-2">
          {canBuy && (
            <button onClick={onOpenBilling} className={primaryButton}>
              {kind === 'run' ? 'Get Pro or a credit pack' : 'See plans'}
            </button>
          )}
          <button onClick={onClose} className="nb-btn nb-btn-sm py-2.5 px-4 text-sm">
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
