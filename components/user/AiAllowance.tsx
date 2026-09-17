'use client'
import { AISettings } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import type { BillingStatus } from '@/lib/billing/types'
import { formatDay, tailorings } from '@/components/user/billing-client'

/**
 * What an AI step runs on, shown above its button.
 *
 * A regular account always runs on Chills AI, the model the owner chose in AI
 * settings, so all it needs to see is what it has left: tailorings, or this
 * month's imports. The owner, visiting this workspace, runs on their own AI
 * settings instead, and is never counted.
 */

interface AiAllowanceProps {
  /** A tailoring spends one; an import counts toward the month's import limit. */
  kind: 'run' | 'import'
  isOwner: boolean
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded. */
  billing: BillingStatus | null | undefined
  onOpenSettings: () => void
  onOpenBilling: () => void
  disabled: boolean
}

const linkButton = 'text-[var(--color-primary)] hover:underline disabled:opacity-50'
const row = 'flex flex-wrap items-center justify-between gap-2 text-xs'

export default function AiAllowance({
  kind,
  isOwner,
  settings,
  billing,
  onOpenSettings,
  onOpenBilling,
  disabled,
}: AiAllowanceProps) {
  if (isOwner) {
    const provider = getProvider(settings.provider)
    const model = settings.models[settings.provider]
    const needsKey = provider.needsKey && !settings.apiKeys[settings.provider]?.trim()
    return (
      <div className="space-y-1">
        <div className={`${row} text-[var(--color-text-muted)]`}>
          <span>
            AI: {provider.emoji} {provider.label}
            {model ? ` · ${model.split('/').pop()}` : ''} · your own settings, never counted
          </span>
          <button onClick={onOpenSettings} disabled={disabled} className={linkButton}>
            Change AI settings
          </button>
        </div>
        {needsKey && (
          <p className="text-xs text-[var(--color-warning)]">
            {provider.label} needs an API key.{' '}
            <button onClick={onOpenSettings} className="underline font-medium">
              Add it in AI settings
            </button>
          </p>
        )}
      </div>
    )
  }

  if (billing === undefined) {
    return <p className="text-xs text-[var(--color-text-muted)]">Checking what you have left…</p>
  }
  if (billing === null) {
    return <p className="text-xs text-[var(--color-text-muted)]">What you have left couldn&apos;t be checked just now.</p>
  }
  if (!billing.platformAi) {
    return (
      <p className="text-xs text-[var(--color-warning)]">
        Importing and tailoring aren&apos;t available right now. Please check back soon.
      </p>
    )
  }

  if (kind === 'import') {
    const left = Math.max(0, billing.imports.limit - billing.imports.used)
    return (
      <div className={row}>
        <span className={left === 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}>
          {left === 0
            ? `You've reached this month's import limit · it starts again on ${formatDay(billing.imports.resetsAt)}`
            : `Importing is free · ${left} import${left === 1 ? '' : 's'} left this month`}
        </span>
        <button onClick={onOpenBilling} disabled={disabled} className={linkButton}>
          Plans
        </button>
      </div>
    )
  }

  const { runs } = billing
  const freeLeft = Math.max(0, runs.free.limit - runs.free.used)
  // Say where the next one comes from: Pro first, then the free ones, then credits.
  const note =
    runs.left === 0
      ? 'No tailorings left'
      : runs.subscription && runs.subscription.used < runs.subscription.limit
        ? `${tailorings(runs.left)} left · this uses 1 of your Pro tailorings`
        : freeLeft === runs.left
          ? `${freeLeft} free ${freeLeft === 1 ? 'tailoring' : 'tailorings'} left · this uses 1`
          : freeLeft > 0
            ? `${tailorings(runs.left)} left (${freeLeft} free, ${runs.credits} from credits) · this uses a free one`
            : `${tailorings(runs.left)} left from credits · this uses 1`

  return (
    <div className={row}>
      <span className={runs.left === 0 ? 'text-[var(--color-warning)] font-medium' : 'text-[var(--color-text-muted)]'}>
        {note}
      </span>
      <button onClick={onOpenBilling} disabled={disabled} className={linkButton}>
        {runs.left === 0 ? 'Get Pro or a credit pack' : runs.subscription ? 'Plans' : 'Get Pro'}
      </button>
    </div>
  )
}
