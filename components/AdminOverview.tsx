'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatPrice } from '@/lib/billing/plans'
import type { AdminOverview as Overview, CheckState } from '@/lib/admin/types'

/** The owner's view of the business: whether everything is set up, and who is paying. */

const MARK: Record<CheckState, { symbol: string; className: string }> = {
  ok: { symbol: '✓', className: 'text-[var(--color-success)]' },
  warn: { symbol: '!', className: 'text-[var(--color-warning)]' },
  missing: { symbol: '✕', className: 'text-[var(--color-error)]' },
}

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function account(email: string | null): string {
  if (!email) return 'Unknown account'
  return email.startsWith('deleted+') ? 'Deleted account' : email
}

function subscriptionState(sub: Overview['subscriptions'][number]): string {
  if (sub.status === 'active' && sub.cancelAtCycleEnd) return 'Active, cancelled'
  return sub.status.charAt(0).toUpperCase() + sub.status.slice(1)
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-3">
      <p className="text-[11px] text-[var(--color-text-muted)]">{label}</p>
      <p className="text-xl font-bold text-[var(--color-text)] tabular-nums">{value}</p>
      {note && <p className="text-[11px] text-[var(--color-text-muted)]">{note}</p>}
    </div>
  )
}

const th = 'text-left font-medium text-[var(--color-text-muted)] px-3 py-2 whitespace-nowrap'
const td = 'px-3 py-2 text-[var(--color-text)] whitespace-nowrap'

export default function AdminOverview({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/overview', { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'The overview could not be loaded.')
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const numbers = data?.numbers

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm anim-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-title"
        className="bg-[var(--color-surface)] w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--color-border)] shadow-2xl p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="business-title" className="text-xl font-bold text-[var(--color-text)]">Business</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Setup, subscriptions and payments across all accounts.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 transition-colors"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[var(--color-error)] bg-[var(--color-error-highlight)] p-3 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        {data && numbers && (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Setup</h3>
              <ul className="rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-divider)]">
                {data.checks.map((check) => (
                  <li key={check.label} className="flex items-start gap-3 p-3">
                    <span className={`w-4 text-center font-bold ${MARK[check.state].className}`} aria-label={check.state}>
                      {MARK[check.state].symbol}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">{check.label}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Accounts" value={numbers.users} note={`${numbers.newUsersThisMonth} new this month`} />
              <Stat label="Pro subscribers" value={numbers.activeSubscriptions} />
              <Stat
                label="Revenue this month"
                value={formatPrice(numbers.revenueThisMonthPaise)}
                note={`${formatPrice(numbers.revenueTotalPaise)} in total`}
              />
              <Stat label="Unused credits" value={numbers.creditsOutstanding} note={`${numbers.creditsSpentThisMonth} spent this month`} />
              <Stat
                label="Free tailorings used"
                value={numbers.freeTailoringsUsed}
                note={`${numbers.accountsOutOfFree} account${numbers.accountsOutOfFree === 1 ? '' : 's'} used all of theirs`}
              />
              <Stat label="Saved resumes" value={numbers.resumes} note={`${numbers.tailorings} tailored copies`} />
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Subscriptions</h3>
              {data.subscriptions.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">No subscriptions yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className={th}>Account</th>
                        <th className={th}>Status</th>
                        <th className={th}>Paid until</th>
                        <th className={th}>Started</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-divider)]">
                      {data.subscriptions.map((sub) => (
                        <tr key={sub.id}>
                          <td className={td}>{account(sub.email)}</td>
                          <td className={td}>{subscriptionState(sub)}</td>
                          <td className={td}>{day(sub.currentEnd)}</td>
                          <td className={td}>{day(sub.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Recent payments</h3>
              {data.payments.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">No payments yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className={th}>Date</th>
                        <th className={th}>Account</th>
                        <th className={th}>For</th>
                        <th className={`${th} text-right`}>Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-divider)]">
                      {data.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td className={td}>{day(payment.createdAt)}</td>
                          <td className={td}>{account(payment.email)}</td>
                          <td className={td}>{payment.kind === 'subscription' ? 'Pro' : 'Credit pack'}</td>
                          <td className={`${td} text-right tabular-nums`}>
                            {payment.currency === 'INR' ? formatPrice(payment.amount) : `${payment.amount / 100} ${payment.currency}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
