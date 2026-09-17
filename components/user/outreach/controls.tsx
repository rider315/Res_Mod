'use client'
import { EmailStatus, STATUS_LABELS } from '@/lib/outreach/model'

/** Small pieces the Outreach screens share. */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: {
  options: Array<{ value: T; label: string; badge?: React.ReactNode }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 p-1 rounded-[8px] border-[1.6px] border-[var(--color-ink)] bg-[var(--color-surface)] text-sm"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          disabled={disabled}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] font-bold transition-all disabled:opacity-60 ${
            value === option.value
              ? 'bg-[var(--color-yellow)] text-[#0a0a0a] border-[1.6px] border-[var(--color-ink)] shadow-[2px_2px_0_0_var(--color-ink)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] border-[1.6px] border-transparent'
          }`}
        >
          {option.label}
          {option.badge}
        </button>
      ))}
    </div>
  )
}

const STATUS_FILL: Record<EmailStatus, string> = {
  draft: 'bg-[var(--color-surface)]',
  sending: 'bg-[var(--color-sky-soft)]',
  sent: 'bg-[var(--color-sky)]',
  opened: 'bg-[var(--color-yellow)]',
  replied: 'bg-[var(--color-periwinkle)] text-white',
  interview: 'bg-[var(--color-accent)]',
  offer: 'bg-[var(--color-accent-strong)]',
  rejected: 'bg-[var(--color-error-highlight)]',
}

export function StatusChip({ status, className = '' }: { status: EmailStatus; className?: string }) {
  return (
    <span className={`nb-chip whitespace-nowrap text-[11px] ${STATUS_FILL[status]} ${status === 'replied' ? '' : 'text-[#0a0a0a]'} ${className}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function Field({
  label,
  hint,
  optional = false,
  children,
}: {
  label: string
  hint?: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-sm font-bold mb-1.5">
        {label} {optional && <span className="font-normal text-[var(--color-text-muted)]">(optional)</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-[var(--color-text-muted)] mt-1.5">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 shrink-0 w-11 h-6 rounded-full border-[1.6px] border-[var(--color-ink)] transition-colors ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-offset)]'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white border-[1.6px] border-[var(--color-ink)] transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
      <span>
        <span className="block text-sm font-bold">{label}</span>
        {description && <span className="block text-xs text-[var(--color-text-muted)] mt-0.5">{description}</span>}
      </span>
    </label>
  )
}

export function relativeDay(date: string | null): string {
  if (!date) return ''
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
