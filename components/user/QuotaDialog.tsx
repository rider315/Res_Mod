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

  const canBuy = Boolean(billing && (billing.checkout.packs || billing.checkout.pro))
  const onPro = Boolean(billing?.subscription?.entitled)

  let title: string
  let detail = ''
  if (kind === 'run') {
    title = onPro ? "You've used this month's Pro tailorings" : "You've used your free tailorings"
    if (billing && onPro) {
      detail = billing.subscription?.currentEnd
        ? `They renew on ${formatDay(billing.subscription.currentEnd)}. A credit pack adds more right away.`
        : 'They renew with your next Pro payment. A credit pack adds more right away.'
    } else if (billing) {
      detail =
        `Every account gets ${billing.runs.free.limit} free tailorings. To keep tailoring, get Pro ` +
        `(${billing.pro.runsPerCycle} tailorings a month for ${formatPrice(billing.pro.pricePaise)}) or a credit pack.`
    }
  } else {
    title = "You've reached this month's import limit"
    if (billing) {
      detail = `Imports start again on ${formatDay(billing.imports.resetsAt)}.`
      if (!onPro && billing.runs.credits === 0) detail += ' Pro and credit packs raise the limit.'
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
        className="bg-[var(--color-surface)] w-full max-w-md rounded-2xl border border-[var(--color-border)] shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="quota-dialog-title" className="text-lg font-bold text-[var(--color-text)]">
          {title}
        </h2>
        {detail && <p className="text-sm text-[var(--color-text-muted)]">{detail}</p>}
        <div className="flex flex-col sm:flex-row gap-2">
          {canBuy && (
            <button onClick={onOpenBilling} className={primaryButton}>
              {kind === 'run' ? 'Get Pro or a credit pack' : 'See plans'}
            </button>
          )}
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
