'use client'
import { AISettings, AiSource } from '@/lib/settings-storage'
import { getProvider } from '@/lib/providers'
import type { BillingStatus } from '@/lib/billing/types'
import { formatDay } from '@/components/user/billing-client'

/**
 * The choice every AI step offers a regular account: ResMod AI, paid for with
 * included runs, or the account's own AI settings (its own key, or Puter), which
 * are never counted.
 */

interface AiSourcePickerProps {
  /** A tailoring run spends a run; an import only counts toward the month's import limit. */
  kind: 'run' | 'import'
  source: AiSource
  onSourceChange: (source: AiSource) => void
  settings: AISettings
  /** undefined while loading; null when it couldn't be loaded. */
  billing: BillingStatus | null | undefined
  onOpenSettings: () => void
  onOpenBilling: () => void
  disabled: boolean
}

const linkButton = 'text-[var(--color-primary)] hover:underline disabled:opacity-50'

export default function AiSourcePicker({
  kind,
  source,
  onSourceChange,
  settings,
  billing,
  onOpenSettings,
  onOpenBilling,
  disabled,
}: AiSourcePickerProps) {
  const provider = getProvider(settings.provider)
  const model = settings.models[settings.provider]
  const needsKey = provider.needsKey && !settings.apiKeys[settings.provider]?.trim()
  const ownLabel = `${provider.emoji} ${provider.label}${model ? ` · ${model.split('/').pop()}` : ''}`

  if (billing === undefined && source === 'platform') {
    return <p className="text-xs text-[var(--color-text-muted)]">AI: checking your included runs…</p>
  }

  // Without ResMod AI, the account's own settings are the only way to run.
  if (!billing?.platformAi) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
          <span>AI: {ownLabel}</span>
          <button onClick={onOpenSettings} disabled={disabled} className={linkButton}>
            Change AI settings
          </button>
        </div>
        {needsKey && <NeedsKey label={provider.label} onOpenSettings={onOpenSettings} />}
      </div>
    )
  }

  const importsLeft = Math.max(0, billing.imports.limit - billing.imports.used)
  const platformEmpty = kind === 'run' ? billing.runs.left === 0 : importsLeft === 0
  const platformNote =
    kind === 'run'
      ? platformEmpty
        ? `No runs left · free runs come back ${formatDay(billing.runs.free.resetsAt)}`
        : `${billing.runs.left} run${billing.runs.left === 1 ? '' : 's'} left · this uses 1`
      : platformEmpty
        ? `Import limit reached · resets ${formatDay(billing.imports.resetsAt)}`
        : `Free · ${importsLeft} import${importsLeft === 1 ? '' : 's'} left this month`

  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold text-[var(--color-text)]">AI</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Which AI to use">
        <Option
          selected={source === 'platform'}
          onSelect={() => onSourceChange('platform')}
          disabled={disabled}
          title="ResMod AI"
          note={platformNote}
          warn={platformEmpty}
        />
        <Option
          selected={source === 'own'}
          onSelect={() => onSourceChange('own')}
          disabled={disabled}
          title="Your own AI"
          note={needsKey ? `${ownLabel} · needs your API key` : `${ownLabel} · never counted`}
          warn={false}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 text-xs">
        {source === 'platform' ? (
          <button onClick={onOpenBilling} disabled={disabled} className={linkButton}>
            {platformEmpty && kind === 'run' ? 'Get more runs' : 'Runs and billing'}
          </button>
        ) : (
          <button onClick={onOpenSettings} disabled={disabled} className={linkButton}>
            Change AI settings
          </button>
        )}
      </div>
      {source === 'own' && needsKey && <NeedsKey label={provider.label} onOpenSettings={onOpenSettings} />}
    </div>
  )
}

function Option({
  selected,
  onSelect,
  disabled,
  title,
  note,
  warn,
}: {
  selected: boolean
  onSelect: () => void
  disabled: boolean
  title: string
  note: string
  warn: boolean
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={`text-left p-3 rounded-xl border transition-all disabled:opacity-60 ${
        selected
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-highlight)] ring-1 ring-[var(--color-primary)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
      }`}
    >
      <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p>
      <p className={`text-[11px] leading-snug mt-0.5 ${warn ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}>
        {note}
      </p>
    </button>
  )
}

function NeedsKey({ label, onOpenSettings }: { label: string; onOpenSettings: () => void }) {
  return (
    <p className="text-xs text-[var(--color-warning)]">
      {label} needs your own API key.{' '}
      <button onClick={onOpenSettings} className="underline font-medium">
        Add it in AI settings
      </button>
      , or choose Puter, which needs no key.
    </p>
  )
}
